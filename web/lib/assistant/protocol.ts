export type Specialist = "Coordinator" | "Finals reviewer" | "Company coordinator" | "Month-end reviewer";
export type AssistantSource = {id: string; label: string; page: string; facts: Record<string, unknown>};
export type AssistantContext = {
  userId: string; workspaceId: string; companyId: string; orderId: string;
  accessVersion: number; revision: number; companyName: string; role: string;
  sources: AssistantSource[]; readableSourceIds: string[]; truncated: boolean;
};
export type AssistantResult = {summary: string; findings: {text: string; sourceIds: string[]}[]; nextStep: string};
export type AssistantFork = {id: string; specialist: Specialist; status: "Running" | "Complete" | "Failed"; result?: AssistantResult; error?: string};
export type AssistantTurn = {id: string; question: string; createdAt: string; revision: number; forks: AssistantFork[]};
export type AssistantThread = {id: string; title: string; companyId: string; orderId: string; accessVersion: number; sourceIds: string[]; turns: AssistantTurn[]};
export type AssistantInput = {action: "list" | "send" | "delete"; threadId?: string; requestId?: string; question?: string; specialists?: Specialist[]};
export type AssistantResponse = {threads: AssistantThread[]; context: AssistantContext; model: string; remaining: number};
