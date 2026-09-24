import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let createFinalSourceBundle, finalHandoffHtml, finalDownloadName;
before(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("../lib/title/final-preparation-export.ts", import.meta.url))], write: false, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ createFinalSourceBundle, finalHandoffHtml, finalDownloadName } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`));
});
const doc = (id, name = "Original.txt", overrides = {}) => ({ id, name, companyId: "cedar", orderId: "file-a", assetId: `asset-${id}`, version: 2, mime: "text/plain", ...overrides });
const options = overrides => ({ workspaceId: "workspace-a", orderId: "file-a", companyId: "cedar", worksheetVersion: 3, report: "Reviewed WFG preparation\nPolicy choices and sources", replyText: "LOCAL DRAFT — NOT SENT\nPlease review the prepared handoff.", documents: [doc("one")], readOriginal: async () => new Blob(["Unchanged original\n§"], { type: "text/plain" }), assertCurrent() {}, ...overrides });

function storedZipEntries(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0, "original is stored without recompression");
    assert.equal(buffer.readUInt16LE(offset + 6), 0x0800, "filenames are UTF-8");
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, buffer.subarray(start, start + size)); offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "central directory follows stored originals");
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50, "archive has an end-of-central-directory record");
  assert.equal(buffer.readUInt16LE(buffer.length - 12), files.size);
  return files;
}

test("source ZIP retains binary originals, unique safe paths, readable reports and independent SHA-256 matches", async () => {
  const bytes = Buffer.from([0, 1, 255, 12, 92, 200, 13, 10]);
  const selected = [doc("one", "../../same.txt", { mime: "application/octet-stream" }), doc("two", "../../same.txt", { mime: "application/octet-stream" })];
  const { archive, manifest } = await createFinalSourceBundle(options({ documents: selected, readOriginal: async () => new Blob([bytes], { type: "application/octet-stream" }) }));
  assert.equal(archive.type, "application/zip");
  const entries = storedZipEntries(Buffer.from(await archive.arrayBuffer()));
  assert.equal(entries.size, 6);
  assert.match(entries.get("handoff.html").toString(), /Reviewed WFG preparation/);
  assert.match(entries.get("local-reply.txt").toString(), /LOCAL DRAFT — NOT SENT/);
  const recorded = JSON.parse(entries.get("manifest.json").toString());
  assert.deepEqual(recorded, manifest);
  assert.equal(recorded.notAPolicy, true); assert.equal(recorded.worksheetVersion, 3);
  assert.equal(recorded.sourceBytes, bytes.length * 2);
  for (const source of recorded.sources) {
    assert.ok(source.path.startsWith("originals/"));
    assert.equal(source.path.split("/").length, 2); assert.ok(!source.path.includes("../"));
    assert.deepEqual(entries.get(source.path), bytes);
    assert.equal(source.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(source.originalName, "../../same.txt"); assert.equal(source.version, 2);
  }
  assert.notEqual(recorded.sources[0].path, recorded.sources[1].path);
});

test("the platform ZIP reader validates CRC records and extracts byte-identical originals", async () => {
  const bytes = Buffer.from("Fictional recorded deed\nUTF-8 original: § ☑\n");
  const { archive, manifest } = await createFinalSourceBundle(options({ readOriginal: async () => new Blob([bytes], { type: "text/plain" }) }));
  const directory = mkdtempSync(join(tmpdir(), "title-final-zip-")), path = join(directory, "handoff.zip");
  try {
    writeFileSync(path, Buffer.from(await archive.arrayBuffer()));
    const check = execFileSync("unzip", ["-t", path], { encoding: "utf8" });
    assert.match(check, /No errors detected/);
    assert.deepEqual(execFileSync("unzip", ["-p", path, manifest.sources[0].path]), bytes);
    assert.deepEqual(JSON.parse(execFileSync("unzip", ["-p", path, "manifest.json"], { encoding: "utf8" })), manifest);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("handoff HTML and filenames keep untrusted case text inert", () => {
  const html = finalHandoffHtml('<script>alert(1)</script>\n<img src="https://example.invalid/tracker">', '<a href="x">Title</a>');
  assert.doesNotMatch(html, /<script|<img|<a href/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(finalDownloadName("../folder\\CON: report.txt"), "-folder-CON- report.txt");
  assert.equal(finalDownloadName("CON.txt"), "document-CON.txt");
});

for (const bad of [doc("one", "Original.txt", { companyId: "other" }), doc("one", "Original.txt", { orderId: "other" }), doc("one", "Reference", { assetId: undefined })]) {
  test(`invalid selection ${JSON.stringify(bad)} is rejected before any original read`, async () => {
    let reads = 0;
    await assert.rejects(createFinalSourceBundle(options({ documents: [bad], readOriginal: async () => { reads++; return new Blob(["bytes"]); } })), /Every selected original must belong/);
    assert.equal(reads, 0);
  });
}

test("a changed source or account during an awaited read aborts the entire bundle", async () => {
  let current = true, reads = 0;
  await assert.rejects(createFinalSourceBundle(options({ documents: [doc("one"), doc("two")], assertCurrent() { if (!current) throw new Error("The reviewed file changed"); }, readOriginal: async () => { reads++; current = false; return new Blob(["bytes"]); } })), /reviewed file changed/);
  assert.equal(reads, 1);
});

test("missing originals and checksum conflicts fail without substituting text or partial bytes", async () => {
  await assert.rejects(createFinalSourceBundle(options({ readOriginal: async () => { throw new Error("Original not available"); } })), /Original not available/);
  await assert.rejects(createFinalSourceBundle(options({ documents: [doc("one", "Original.txt", { providerSource: { sha256: "0".repeat(64) } })] })), /recorded checksum/);
  await assert.rejects(createFinalSourceBundle(options({ readOriginal: async () => new Blob([]) })), /empty/);
});

test("recorded MIME, original MIME and original format must agree even without a provider checksum", async () => {
  await assert.rejects(createFinalSourceBundle(options({ readOriginal: async () => new Blob(["plain original"], { type: "application/pdf" }) })), /recorded file type/);
  await assert.rejects(createFinalSourceBundle(options({ documents: [doc("one", "broken.pdf", { mime: "application/pdf" })], readOriginal: async () => new Blob(["not a PDF"], { type: "application/pdf" }) })), /Contents do not match/);
  await assert.rejects(createFinalSourceBundle(options({ readOriginal: async () => new Blob([new Uint8Array([255, 254])], { type: "text/plain" }) })), /UTF-8/);
  await assert.rejects(createFinalSourceBundle(options({ documents: [doc("one", "unsafe.html", { mime: "text/html" })], readOriginal: async () => new Blob(["<script>bad()</script>"], { type: "text/html" }) })), /recorded file type/);
  const result = await createFinalSourceBundle(options({ documents: [doc("one", "Fictional.pdf", { mime: "application/pdf" })], readOriginal: async () => new Blob(["%PDF-1.7\nFictional test original\n%%EOF"], { type: "application/pdf" }) }));
  assert.equal(result.manifest.sources[0].mime, "application/pdf");
});

test("file and selection limits are enforced before unbounded byte reads", async () => {
  let materialized = false;
  await assert.rejects(createFinalSourceBundle(options({ readOriginal: async () => ({ size: 26 * 1024 * 1024, arrayBuffer() { materialized = true; throw new Error("Should not read"); } }) })), /25 MB per original/);
  assert.equal(materialized, false);
  await assert.rejects(createFinalSourceBundle(options({ documents: Array.from({ length: 51 }, (_, index) => doc(String(index))) })), /between 1 and 50/);
  await assert.rejects(createFinalSourceBundle(options({ documents: [doc("one"), doc("one")] })), /distinct/);
});
