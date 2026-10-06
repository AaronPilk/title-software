import { ApiError, type Access } from "./workspace";
import { feedbackSubmission } from "./feedback-validation";
import type { FeedbackItem } from "./feedback";
import { encodeFeedbackScreenshot, parseFeedbackScreenshot } from "./feedback-screenshot-validation";
export { MAX_FEEDBACK_SCREENSHOT_BODY } from "./feedback-screenshot-validation";
export const FEEDBACK_SCREENSHOT_BUCKET = "title-feedback-screenshots";
export type FeedbackScreenshotContext = {
  workspaceId: string; access: Access; email: string;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Upload once with upsert:false. On duplicate the helper verifies saved bytes. */
  upload: (path: string, bytes: Uint8Array, mime: string) => Promise<void>;
  download: (path: string) => Promise<Uint8Array>;
};
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(v => v.toString(16).padStart(2, "0")).join("");
function identity(ctx: FeedbackScreenshotContext) { return { p_workspace: ctx.workspaceId, p_actor: ctx.access.userId, p_actor_version: ctx.access.version }; }
async function invoke(ctx: FeedbackScreenshotContext, action: string, args: Record<string, unknown>) {
  try { return await ctx.rpc("title_feedback_screenshot", { ...identity(ctx), p_action: action, p_input: args }); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    const status = error && typeof error === "object" && "status" in error ? error.status : 0;
    if (code === "42501" || status === 403) throw new ApiError("Your feedback access changed. Refresh and try again.", 403);
    if (code === "PT404" || status === 404) throw new ApiError("This screenshot is unavailable.", 404);
    if (code === "PT409" || status === 409) throw new ApiError("This feedback or screenshot changed. Start a new report.", 409);
    if (code === "PT429" || status === 429) throw new ApiError("Please wait before sending another report.", 429);
    throw new ApiError("Screenshot could not be saved. Your report may be saved; retry with the same screenshot.", 503);
  }
}
export async function submitFeedbackScreenshot(raw: unknown, context: FeedbackScreenshotContext): Promise<FeedbackItem> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError("Choose a screenshot and enter feedback.");
  const { screenshot, ...fields } = raw as Record<string, unknown>;
  const input = feedbackSubmission(fields);
  if (input.workspaceId !== context.workspaceId) throw new ApiError("Workspace changed.", 403);
  let parsed: ReturnType<typeof parseFeedbackScreenshot>;
  try { parsed = parseFeedbackScreenshot(screenshot); } catch { throw new ApiError("Choose a valid PNG or JPEG screenshot up to 4 MB and 32 million pixels."); }
  const sha256 = await digest(parsed.bytes);
  const reserved = await invoke(context, "prepare", { ...input, email: context.email, fileName: parsed.fileName, mime: parsed.mime, byteSize: parsed.bytes.length, sha256, width: parsed.width, height: parsed.height }) as { path: string; ready: boolean };
  if (!reserved.ready) {
    try { await context.upload(reserved.path, parsed.bytes, parsed.mime); }
    catch {
      // A lost upload response or simultaneous same-ID retry must never overwrite
      // or delete a successfully stored original. Verify immutable bytes instead.
      try { if (await digest(await context.download(reserved.path)) !== sha256) throw new Error("Different bytes"); }
      catch { throw new ApiError("Screenshot upload did not finish. Retry with the same screenshot; your report may already be saved.", 503); }
    }
  }
  return await invoke(context, "complete", { id: input.id, sha256 }) as FeedbackItem;
}
export async function readFeedbackScreenshot(raw: unknown, context: FeedbackScreenshotContext) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, "workspaceId") || !Object.hasOwn(raw, "id")) throw new ApiError("Choose a feedback screenshot.");
  const input = raw as { workspaceId: string; id: string };
  if (input.workspaceId !== context.workspaceId || typeof input.id !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.id)) throw new ApiError("Choose a feedback screenshot.");
  const info = await invoke(context, "read", { id: input.id }) as { path: string; mime: string; fileName: string; sha256: string };
  let bytes: Uint8Array;
  try { bytes = await context.download(info.path); if (await digest(bytes) !== info.sha256) throw new Error("Bytes changed"); }
  catch { throw new ApiError("Screenshot could not be opened. Try again.", 503); }
  // Recheck lifecycle after storage I/O so a revoked user cannot receive bytes.
  await invoke(context, "read", { id: input.id });
  return { fileName: info.fileName, mime: info.mime, base64: encodeFeedbackScreenshot(bytes) };
}
