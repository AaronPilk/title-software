import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Versioned assets are generated from lockfile-pinned packages, never fetched by
// the document reader from a third-party CDN. Run for every build and dev start.
const root = new URL("../", import.meta.url);
const destination = new URL("public/ocr/v7-eng1/", root);
const packages = { "tesseract.js": "7.0.0", "tesseract.js-core": "7.0.0", "@tesseract.js-data/eng": "1.0.0" };
for (const [name, version] of Object.entries(packages)) {
  const info = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), "utf8"));
  if (info.version !== version) throw Error(`OCR package ${name} must be ${version}; use the committed lockfile.`);
}
await mkdir(destination, { recursive: true });
const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ...["", "-simd", "-relaxedsimd", "-lstm", "-simd-lstm", "-relaxedsimd-lstm"].map(variant => [`tesseract.js-core/tesseract-core${variant}.wasm.js`, `tesseract-core${variant}.wasm.js`]),
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
  ["tesseract.js/LICENSE.md", "TESSERACT-LICENSE.txt"],
  ["tesseract.js-core/LICENSE", "CORE-LICENSE.txt"],
];
const manifest = { packages, files: {} };
for (const [source, name] of files) {
  const input = new URL(`node_modules/${source}`, root);
  await copyFile(input, new URL(name, destination));
  manifest.files[name] = createHash("sha256").update(await readFile(input)).digest("hex");
}
await writeFile(new URL("manifest.json", destination), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(new URL("LANGUAGE-NOTICE.txt", destination), "English language data: @tesseract.js-data/eng 1.0.0, MIT package license. Source: https://github.com/naptha/tessdata . The trained Tesseract models are distributed by the Tesseract project under Apache-2.0: https://github.com/tesseract-ocr/tessdata .\n");
console.log(`Prepared ${files.length} local OCR assets in ${fileURLToPath(destination)}.`);
