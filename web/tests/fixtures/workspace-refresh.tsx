import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceProvider, useWorkspace } from "../../lib/title/store";
import { createSeed } from "../../lib/title/model";
import { emptyWorkspace, executeCommands } from "../../lib/backend/workspace";
import { backendRequest, type RemoteState } from "../../lib/backend/client";

type Failure = { message: string; status: number };
type Call = { path: string; data?: unknown };
type Fixture = {
  initial: RemoteState; remote: RemoteState; readFailures: Failure[]; writeFailures: Failure[];
  calls: Call[]; signOuts: number; signOutFailure: boolean;
};
declare global { interface Window {
  refreshFixture: Fixture;
  refreshTransport: (path: string, data?: unknown) => Promise<unknown>;
} }
const email = "refresh-reviewer@example.test";
const remote: RemoteState = {
  workspaceId: "11111111-1111-4111-8111-111111111111", name: "Synthetic refresh workspace", revision: 1,
  state: { ...emptyWorkspace(email), ...createSeed(), user: email },
  access: { userId: "22222222-2222-4222-8222-222222222222", email, role: "owner", allCompanies: true, companyIds: [], restricted: true, version: 1, partnerMembers: [] },
};
window.refreshFixture = { initial: structuredClone(remote), remote, readFailures: [], writeFailures: [], calls: [], signOuts: 0, signOutFailure: false };
window.refreshTransport = async (path, data) => {
  const fixture = window.refreshFixture;
  fixture.calls.push({ path, data: data === undefined ? undefined : structuredClone(data) });
  if (path === "/state") {
    const failure = fixture.readFailures.shift();
    if (failure) throw Object.assign(new Error(failure.message), { status: failure.status });
    return structuredClone(fixture.remote);
  }
  if (path === "/commands") {
    const failure = fixture.writeFailures.shift();
    if (failure) throw Object.assign(new Error(failure.message), { status: failure.status });
    const request = data as { workspaceId: string; expectedRevision: number; commands: Parameters<typeof executeCommands>[1] };
    if (request.workspaceId !== fixture.remote.workspaceId || request.expectedRevision !== fixture.remote.revision)
      throw Object.assign(new Error("Synthetic revision conflict"), { status: 409 });
    fixture.remote = { ...fixture.remote, revision: fixture.remote.revision + 1,
      state: executeCommands(fixture.remote.state, request.commands, fixture.remote.access) };
    return structuredClone(fixture.remote);
  }
  if (path === "/fixture-import") {
    fixture.remote = structuredClone(fixture.remote); fixture.remote.revision++;
    fixture.remote.state.companies[0].contact = "Imported contact";
    return { saved: true };
  }
  throw new Error(`Unexpected synthetic transport path: ${path}`);
};
function Probe() {
  const { s, update, connection } = useWorkspace();
  const [refreshResult, setRefreshResult] = useState("not called"), [writeResult, setWriteResult] = useState("not called"), [importResult, setImportResult] = useState("not called");
  return <main>
    <h1>Connected workspace refresh verification</h1>
    <output aria-label="Workspace revision">{connection!.revision}</output>
    <output aria-label="Current contact">{s.companies[0].contact}</output>
    <output aria-label="Refresh return">{refreshResult}</output>
    <output aria-label="Write return">{writeResult}</output>
    <output aria-label="Import outcome">{importResult}</output>
    <button onClick={async () => setRefreshResult(String(await connection!.refresh()))}>Read latest records</button>
    <button onClick={async () => setWriteResult(String(await update(draft => { draft.companies[0].contact = "Saved contact"; }, "Contact saved")))}>Save contact</button>
    <button onClick={async () => {
      const result = await backendRequest<{ saved: boolean }>("/fixture-import", {});
      const refreshed = await connection!.refresh();
      setImportResult(result.saved ? refreshed ? "Imported and refreshed" : "Imported; refresh pending" : "Import failed");
      setRefreshResult(String(refreshed));
    }}>Import then refresh</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
