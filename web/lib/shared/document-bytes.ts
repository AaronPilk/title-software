/** Format-signature checks are not malware scanning or a claim of document validity. */
export function documentByteProblem(bytes: Uint8Array, mime: string): string | null {
  // Unknown binary files remain download-only. Callers separately allowlist MIME types.
  if (mime === "application/octet-stream") return null;
  const starts = (sequence: number[]) => sequence.every((b, i) => bytes[i] === b);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const valid = mime === "application/pdf" ? ascii(0, 5) === "%PDF-" :
    mime === "image/png" ? starts([137, 80, 78, 71, 13, 10, 26, 10]) :
    mime === "image/jpeg" ? starts([255, 216, 255]) :
    mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6)) :
    mime === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP" :
    mime.includes("openxmlformats") ? starts([80, 75, 3, 4]) :
    ["application/msword", "application/vnd.ms-excel"].includes(mime) ? starts([208, 207, 17, 224, 161, 177, 26, 225]) :
    mime.startsWith("text/") && !bytes.includes(0);
  if (!valid) return "Contents do not match the declared file type.";
  if (mime.startsWith("text/")) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return "Text files must use UTF-8 encoding."; }
  }
  return null;
}
