import { OCR_LIMITS, OcrError, type OcrResult, type OcrProgress, type OcrRotation } from "./local-ocr-shared";
import { prepareOcrRaster } from "./ocr-raster";
export { OCR_LIMITS, OcrError, ocrCitation } from "./local-ocr-shared";
export type { OcrResult, OcrProgress, OcrRotation } from "./local-ocr-shared";
type Options = { signal?: AbortSignal; onProgress?: (progress: OcrProgress) => void; timeoutMs?: number; rotation?: OcrRotation;
  /** Package reader only: permit a selected physical page in a PDF of at most 1,000 pages. */
  packageMode?: boolean };

export async function recognizeDocumentPage(file: Blob, page: number, options: Options = {}): Promise<OcrResult> {
  if (options.signal?.aborted) throw new OcrError("cancelled", "OCR was cancelled.");
  const abort = new AbortController(); let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (reason: OcrError) => void = () => undefined;
  const stop = (reason: OcrError) => { abort.abort(); worker?.postMessage({ type: "cancel" }); rejectStop(reason); };
  const cancel = () => stop(new OcrError("cancelled", "OCR was cancelled."));
  try {
    const interrupted = new Promise<never>((_, reject) => { rejectStop = reject; });
    timer = setTimeout(() => stop(new OcrError("timeout", "OCR exceeded 90 seconds. Try a smaller or clearer page.")), Math.max(1, Math.min(options.timeoutMs || OCR_LIMITS.milliseconds, OCR_LIMITS.milliseconds)));
    options.signal?.addEventListener("abort", cancel, { once: true });
    const run = async (): Promise<OcrResult> => {
      options.onProgress?.({ phase: "Opening document", progress: 0 });
      const raster = await prepareOcrRaster(file, page, abort.signal, () => options.onProgress?.({ phase: "Rendering page", progress: 1 }), options.rotation, options.packageMode === true);
      if (abort.signal.aborted) throw new OcrError("cancelled", "OCR was cancelled.");
      const image = new Uint8Array(await raster.image.arrayBuffer());
      if (abort.signal.aborted) throw new OcrError("cancelled", "OCR was cancelled.");
      // Import the emitted URL explicitly: the framework also compiles this
      // module for SSR, where import.meta.url refers to the build filesystem.
      const workerAsset = await import("./local-ocr.worker.ts?worker&url");
      if (abort.signal.aborted) throw new OcrError("cancelled", "OCR was cancelled.");
      worker = new Worker(new URL(workerAsset.default, window.location.origin), { type: "module", name: "Title document OCR" });
      return await new Promise<OcrResult>((resolve, reject) => {
        worker!.onerror = () => reject(new OcrError("engine", "The local OCR engine could not start. Reload the app and try again."));
        worker!.onmessage = event => {
          if (abort.signal.aborted) return;
          const data = event.data;
          if (data.type === "progress") options.onProgress?.({ phase: data.phase, progress: data.progress });
          if (data.type === "error") reject(new OcrError("engine", "OCR could not read this page. Review the original or try a clearer scan."));
          if (data.type === "result") resolve({ text: data.text, confidence: data.confidence, words: data.words,
            page, width: raster.width, height: raster.height, rotation: raster.rotation, language: "English", engine: "Tesseract.js 7.0.0" });
        };
        worker!.postMessage({ type: "start", image }, [image.buffer]);
      });
    };
    return await Promise.race([run(), interrupted]);
  } finally {
    if (timer) clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); abort.abort();
    if (worker) {
      worker.postMessage({ type: "cancel" });
      // Allow the supervisor to terminate its child engine even during startup.
      const finished = worker; setTimeout(() => finished.terminate(), 100);
    }
  }
}
