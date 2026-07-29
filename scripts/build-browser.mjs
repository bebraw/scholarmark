import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/browser.ts"],
  outfile: "dist/browser.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["worker"],
  target: "es2022",
  sourcemap: true,
  metafile: true,
});

const output = result.metafile.outputs["dist/browser.js"];
if (!output) throw new Error("Browser bundle metadata is missing");
const source = await readFile("dist/browser.js");
if (source.includes("@citation-js") || Object.keys(result.metafile.inputs).some((path) => path.includes("@citation-js"))) {
  throw new Error("The Scholarmark browser bundle must not include Citation.js");
}
const raw = output.bytes;
const gzip = gzipSync(source).byteLength;
console.log(`Scholarmark browser bundle: ${formatBytes(raw)} raw, ${formatBytes(gzip)} gzip`);

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}
