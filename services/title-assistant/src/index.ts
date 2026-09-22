import { Agent, getAgentByName } from "agents";
import { readRequestText, RequestBodyError } from "../../../web/lib/shared/request-body";
import { MODEL, modelMessages, responseFormat, parseResult, validateInput, advance, type AssistantState } from "./core";
import type { AssistantContext, AssistantInput, AssistantResponse, AssistantThread, AssistantTurn } from "../../../web/lib/assistant/protocol";
type State = AssistantState;
const json = (value: unknown, status=200) => Response.json(value,{status,headers:{"Cache-Control":"no-store"}});

export class PersonalAssistant extends Agent<Env, State> {
  initialState: State = {threads:[], day:"", runs:0};
  // No public Agent routes or WebSockets are exposed. Only the authenticated
  // service entrypoint calls this RPC with context verified by title-api.
  async handle(context: AssistantContext, input: AssistantInput): Promise<AssistantResponse> {
    const next=advance(this.state, context, input);
    this.setState(next.state);
    if(next.job)this.ctx.waitUntil(this.complete(context,next.job.threadId,next.job.turn));
    return next.response;
  }

  async complete(context: AssistantContext, threadId: string, turn: AssistantTurn) {
    const thread = this.state.threads.find(t=>t.id===threadId);
    const conversation = thread ? {thread, turnId:turn.id} : undefined;
    await Promise.allSettled(turn.forks.map(async fork=>{
      let finished: typeof fork;
      let stage = "provider";
      let responseShape = "not returned";
      try {
        const result = await this.env.AI.run(MODEL, {messages:modelMessages(context,turn.question,fork.specialist,conversation), max_tokens:1500, temperature:0.2, response_format:responseFormat(context)});
        stage = "response";
        responseShape = typeof result === "object" && result ? JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,typeof v]))) : typeof result;
        if (typeof result!=="object" || result===null || !("response" in result)) throw Error("No response");
        finished={...fork,status:"Complete",result:parseResult(result.response,context)};
      } catch (e) { console.warn("assistant_run_failed", {stage,responseShape,errorType:e instanceof Error?e.name:"unknown", code: typeof e === "object" && e && "code" in e ? String(e.code).slice(0,80) : "none"}); finished={...fork,status:"Failed",error:"The specialist could not finish a sourced answer. Try a shorter question or select one file."}; }
      const next=structuredClone(this.state);
      const target=next.threads.find(t=>t.id===threadId)?.turns.find(t=>t.id===turn.id);
      const index=target?.forks.findIndex(f=>f.id===fork.id) ?? -1;
      if (target && index>=0 && target.forks[index].status==="Running") {target.forks[index]=finished;this.setState(next);}
    }));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method!=="POST" || new URL(request.url).pathname!=="/assistant") return json({error:"Not found"},404);
    try {
      const authorization=request.headers.get("Authorization") || "";
      const apikey=request.headers.get("apikey") || "";
      if (!authorization.startsWith("Bearer ") || !apikey) return json({error:"Sign in to use your assistant."},401);
      const raw=await readRequestText(request, {maxBytes:12000,tooLargeMessage:"Request is too large."});
      const body=JSON.parse(raw);
      validateInput(body);
      const verification=await fetch(`${env.TITLE_API_URL}/assistant/context`,{method:"POST",headers:{Authorization:authorization,apikey,"Content-Type":"application/json"},
        body:JSON.stringify({workspaceId:body.workspaceId,companyId:body.companyId,orderId:body.orderId}),signal:AbortSignal.timeout(15000)});
      if(!verification.ok) return json({error:(await verification.json() as {error?:string}).error || "Access could not be verified."},verification.status);
      const context=await verification.json() as AssistantContext;
      // Identity never comes from a browser-provided name, URL or user id.
      const agent=await getAgentByName<Env,PersonalAssistant>(env.PERSONAL_ASSISTANT,`${context.workspaceId}:${context.userId}`);
      return json(await agent.handle(context,body));
    } catch(e) {return json({error:e instanceof SyntaxError ? "Invalid request." : e instanceof Error ? e.message : "Assistant unavailable."},e instanceof RequestBodyError ? e.status : 400);}
  }
} satisfies ExportedHandler<Env>;
