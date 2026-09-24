import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AssistantContext } from "../../../web/lib/assistant/protocol.ts";

const require=createRequire(import.meta.url), {build}=require("esbuild");
const directory=await mkdtemp(join(tmpdir(),"title-help-http-")), output=join(directory,"service.mjs");
await build({entryPoints:[fileURLToPath(new URL("../src/index.ts",import.meta.url))],outfile:output,bundle:true,platform:"node",format:"esm",plugins:[{
  name:"private-agent-test-runtime",
  setup(builder:any){
    builder.onResolve({filter:/^agents$/},()=>({path:"agents",namespace:"test-agent"}));
    builder.onLoad({filter:/.*/,namespace:"test-agent"},()=>({contents:`export class Agent {
      constructor(ctx,env){this.ctx=ctx;this.env=env;}
      get state(){return this.saved || this.initialState;}
      setState(state){this.saved=state;}
    }
    export async function getAgentByName(binding,name){return binding.forTest(name);}`,loader:"js"}));
  }
}]});
const {default:service,PersonalAssistant}=await import(pathToFileURL(output).href);
await rm(directory,{recursive:true,force:true});

const screen={page:"Documents",view:"agency",surface:"page"};
const input=()=>({action:"send",purpose:"help",screen,companyId:"",orderId:"",workspaceId:"workspace-a",requestId:crypto.randomUUID(),question:"How do I upload?",specialists:["Product guide"]});
const verified=():AssistantContext=>({workspaceId:"workspace-a",userId:"verified-user",companyId:"",orderId:"",purpose:"help",screen:{page:"Documents",view:"agency",surface:"page"},companyName:"Product help",role:"operations",revision:1,accessVersion:1,sources:[{id:"help:documents",label:"Documents",page:"Documents",facts:{steps:["Open Documents."]}}],readableSourceIds:["help:documents"],truncated:false});
const request=(body:unknown,headers:Record<string,string>={})=>new Request("https://assistant.internal/assistant",{method:"POST",headers:{Authorization:"Bearer fictional-session",apikey:"fictional-public-key","Content-Type":"application/json",...headers},body:JSON.stringify(body)});

function environment(provider:(...args:unknown[])=>Promise<unknown>){
  const jobs:Promise<unknown>[]=[],instances=new Map<string,any>(), names:string[]=[];
  const env:any={TITLE_API_URL:"https://synthetic.example.test/title-api",AI:{run:provider},PERSONAL_ASSISTANT:{forTest(name:string){
    names.push(name);
    if(!instances.has(name))instances.set(name,new PersonalAssistant({waitUntil(job:Promise<unknown>){jobs.push(job);}},env));
    return instances.get(name);
  }}};
  return {env,jobs,names,instances};
}

test("actual service forwards only verified help scope and derives private instance from authenticated identity",async()=>{
  const original=globalThis.fetch, calls:{url:string;body:any}[]=[], providerCalls:any[]=[];
  const runtime=environment(async(...args)=>{providerCalls.push(args);return {response:{summary:"Open Documents.",findings:[{text:"Open Documents.",sourceIds:["help:documents"]}],nextStep:"Open Documents."}};});
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(String(options?.body))});return Response.json(verified());};
  try{
    const response=await service.fetch(request({...input(),userId:"victim",role:"owner",sources:[{id:"order:secret"}]}),runtime.env);
    assert.equal(response.status,200);
    assert.deepEqual(calls,[{url:"https://synthetic.example.test/title-api/assistant/context",body:{workspaceId:"workspace-a",companyId:"",orderId:"",purpose:"help",screen}}]);
    assert.deepEqual(runtime.names,["workspace-a:verified-user"]);
    await Promise.all(runtime.jobs);
    assert.equal(providerCalls.length,1);
    const payload=JSON.parse(providerCalls[0][1].messages[1].content);
    assert.deepEqual(payload.context.guides,verified().sources);assert(!JSON.stringify(payload).includes("order:secret"));
    const result=await response.json();assert.equal(result.context.userId,"verified-user");assert.equal(result.threads[0].purpose,"help");
  } finally {globalThis.fetch=original;}
});

test("actual service rejects invalid help scopes and screens before backend or provider calls",async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error("No network call expected");};
  const runtime=environment(async()=>{throw Error("No model call expected");});
  try{
    for(const overrides of [{companyId:"private-company"},{orderId:"private-file"},{purpose:"owner"},{screen:{...screen,token:"private"}},{screen:{page:"Unknown",view:"agency"}},{specialists:["Month-end reviewer"]}]){
      const response=await service.fetch(request({...input(),...overrides}),runtime.env);
      assert.equal(response.status,400);
    }
    assert.equal((await service.fetch(request(input(),{Authorization:""}),runtime.env)).status,401);
    assert.equal(calls,0);assert.deepEqual(runtime.names,[]);
  } finally {globalThis.fetch=original;}
});

test("backend access denial is returned without opening any private assistant or model call",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({error:"Company access changed."},{status:403});
  const runtime=environment(async()=>{throw Error("No model call expected");});
  try{
    const response=await service.fetch(request(input()),runtime.env);
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:"Company access changed."});assert.deepEqual(runtime.names,[]);
  } finally {globalThis.fetch=original;}
});

test("a provider failure preserves a failed help turn without fabricating guidance or leaking provider text",async()=>{
  const originalFetch=globalThis.fetch, originalWarn=console.warn, warnings:unknown[][]=[];
  globalThis.fetch=async()=>Response.json(verified());console.warn=(...args)=>{warnings.push(args);};
  const runtime=environment(async()=>{throw Error("PRIVATE PROVIDER FAILURE DETAIL");});
  try{
    const response=await service.fetch(request(input()),runtime.env);assert.equal(response.status,200);
    await Promise.all(runtime.jobs);
    const history=await service.fetch(request({...input(),action:"list"}),runtime.env);
    const body=await history.json(), fork=body.threads[0].turns[0].forks[0];
    assert.equal(fork.status,"Failed");assert.equal(fork.result,undefined);assert.equal(body.remaining,29);
    assert(!JSON.stringify(body).includes("PRIVATE PROVIDER"));assert(!JSON.stringify(warnings).includes("PRIVATE PROVIDER"));
  } finally {globalThis.fetch=originalFetch;console.warn=originalWarn;}
});
