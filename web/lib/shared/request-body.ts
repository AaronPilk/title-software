/** Byte limits apply while reading, including chunked bodies without Content-Length. */
export class RequestBodyError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "RequestBodyError";
  }
}

type BodyOptions = { maxBytes: number; timeoutMs?: number; tooLargeMessage?: string };
function requestBodyStream(request: Request, options: BodyOptions): ReadableStream<Uint8Array> | null {
  const { maxBytes, timeoutMs = 15_000, tooLargeMessage = "Request too large." } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid request body limits.");
  const cancel = (body: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array> | null) => {
    // A hostile/failed stream must not delay the error response during cancellation.
    try { void body?.cancel().catch(() => {}); } catch { /* Already closed or canceled. */ }
  };
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) {
    cancel(request.body);
    throw new RequestBodyError("Invalid request length.", 400);
  }
  if (declared !== null && Number(declared) > maxBytes) {
    cancel(request.body);
    throw new RequestBodyError(tooLargeMessage, 413);
  }
  if (request.signal.aborted) {
    cancel(request.body);
    throw new RequestBodyError("Request body was interrupted.", 408);
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let finished = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let length = 0;
  function finish(error?: RequestBodyError, consumerCanceled = false) {
    if (finished) return;
    finished = true;
    if (error || consumerCanceled) cancel(reader!);
    if (timer !== undefined) clearTimeout(timer);
    if (abort) request.signal.removeEventListener("abort", abort);
    reader!.releaseLock();
    if (!consumerCanceled) {
      if (error) controller.error(error);
      else controller.close();
    }
  }
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      timer = setTimeout(() => finish(new RequestBodyError("Request body timed out.", 408)), timeoutMs);
      abort = () => finish(new RequestBodyError("Request body was interrupted.", 408));
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
    },
    async pull() {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) { finish(); return; }
        length += value.byteLength;
        if (length > maxBytes) { finish(new RequestBodyError(tooLargeMessage, 413)); return; }
        controller.enqueue(value);
      } catch { finish(new RequestBodyError("Request body could not be read.", 400)); }
    },
    cancel() { finish(undefined, true); },
  }, { highWaterMark: 0 });
}

export async function readRequestBytes(request: Request, options: BodyOptions): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(requestBodyStream(request, options)).arrayBuffer());
}

export async function readRequestFormData(request: Request, options: BodyOptions): Promise<FormData> {
  const stream = requestBodyStream(request, options);
  try {
    // Bound multipart bytes before the parser consumes them, without an extra
    // full-file buffer/copy in addition to the parser's own file storage.
    return await new Response(stream, {
      headers: { "Content-Type": request.headers.get("Content-Type") || "" },
    }).formData();
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("Invalid upload form.", 400);
  } finally {
    // Some runtimes reject malformed multipart headers without consuming the body.
    if (stream && !stream.locked) void stream.cancel().catch(() => {});
  }
}

export async function readRequestText(request: Request, options: BodyOptions): Promise<string> {
  const bytes = await readRequestBytes(request, options);
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); }
  catch { throw new RequestBodyError("Request body must use UTF-8.", 400); }
}
