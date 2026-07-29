import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const noNetworkModule = `
class DisabledHeaders {}
function networkDisabled() {
  throw new Error("Scholarmark browser rendering does not load bibliography URLs");
}
networkDisabled.Headers = DisabledHeaders;
export { DisabledHeaders as Headers };
export default networkDisabled;
`;

const noNetworkPlugin = {
  name: "scholarmark-no-network",
  setup(build) {
    build.onResolve({ filter: /^(?:node-fetch|sync-fetch)$/ }, ({ path }) => ({
      path,
      namespace: "scholarmark-no-network",
    }));
    build.onLoad({ filter: /.*/, namespace: "scholarmark-no-network" }, () => ({
      contents: noNetworkModule,
      loader: "js",
    }));
  },
};

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
  plugins: [noNetworkPlugin],
});

const output = result.metafile.outputs["dist/browser.js"];
if (!output) throw new Error("Browser bundle metadata is missing");
const source = await readFile("dist/browser.js");
const raw = output.bytes;
const gzip = gzipSync(source).byteLength;
console.log(`Scholarmark browser bundle: ${formatBytes(raw)} raw, ${formatBytes(gzip)} gzip`);

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}
