import { createWorker, OEM, PSM, type Worker as OcrWorker } from "tesseract.js";
import { OCR_ASSET_PATH, OCR_LIMITS, type OcrWord } from "./local-ocr-shared";

// This dedicated supervisor allows cancellation during model/engine startup as
// well as recognition. Capturing child workers is isolated to this worker scope;
// PDF.js and every other worker in the application are unaffected.
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void; close(): void; location: Location; Worker: typeof Worker };
const NativeWorker = scope.Worker;
const children = new Set<Worker>();
scope.Worker = class extends NativeWorker {
  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    const url = new URL(String(scriptURL), scope.location.origin);
    if (url.origin !== scope.location.origin) throw new Error("OCR workers must use the application origin.");
    super(scriptURL, options); children.add(this);
  }
};
let started = false, stopped = false, engine: OcrWorker | undefined;
function cleanup() { stopped = true; for (const child of children) child.terminate(); children.clear(); scope.close(); }
scope.onmessage = async event => {
  if (event.data?.type === "cancel") { cleanup(); return; }
  if (started || event.data?.type !== "start" || !(event.data.image instanceof Uint8Array)) return;
  started = true;
  try {
    const base = new URL(OCR_ASSET_PATH, scope.location.origin).href;
    engine = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: `${base}/worker.min.js`, corePath: base, langPath: base,
      workerBlobURL: false, gzip: true, cacheMethod: "none", legacyCore: false, legacyLang: false,
      logger: message => { if (!stopped) scope.postMessage({ type: "progress", phase: message.status === "recognizing text" ? "Reading scanned text" : "Loading OCR engine", progress: Number.isFinite(message.progress) ? Math.max(0, Math.min(1, message.progress)) : 0 }); },
      errorHandler: () => { if (!stopped) { scope.postMessage({ type: "error" }); cleanup(); } },
    });
    if (stopped) { await engine.terminate(); return; }
    await engine.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "200" });
    const { data } = await engine.recognize(event.data.image, {}, { text: true, blocks: true });
    if (data.text.length > OCR_LIMITS.characters) throw Error("OCR text limit exceeded.");
    const words: OcrWord[] = [];
    for (const block of data.blocks || []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) for (const word of line.words) {
      if (words.length >= OCR_LIMITS.words) throw Error("OCR word limit exceeded.");
      words.push({ text: word.text, confidence: Math.max(0, Math.min(100, Number.isFinite(word.confidence) ? word.confidence : 0)), box: { ...word.bbox } });
    }
    if (!stopped) scope.postMessage({ type: "result", text: data.text.trim(), confidence: Math.max(0, Math.min(100, Number.isFinite(data.confidence) ? data.confidence : 0)), words });
  } catch { if (!stopped) scope.postMessage({ type: "error" }); }
  finally { cleanup(); }
};
