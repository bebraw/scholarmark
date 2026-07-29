import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const browserEntry = await readFile(new URL("../dist/browser.js", import.meta.url), "utf8");
assert.match(browserEntry, /export \* from "\.\/markdown\.js";/u);
assert.doesNotMatch(browserEntry, /@citation-js|node_modules|__commonJS/u);

const result = await build({
  entryPoints: ["scripts/fixtures/browser-consumer.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  logLevel: "error",
  metafile: true,
});

const bundled = result.outputFiles[0];
if (!bundled) throw new Error("Browser smoke bundle was not produced");
const source = bundled.text;
assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()["']node:/u);
assert.doesNotMatch(source, /@citation-js|node-fetch|sync-fetch/u);
assert.equal(
  Object.keys(result.metafile.inputs).some((path) => path.includes("citation-js")),
  false,
  "Browser consumer graph must not contain Citation.js",
);

let fetches = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => {
  fetches += 1;
  throw new Error("Unexpected network request");
};

try {
  const { renderSync } = await import(`../dist/browser.js?smoke=${Date.now()}`);
  const rendered = renderSync(
    "## Evidence\n\n::: comment\nHidden note\n:::\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\nSee :cite[doe2026]{locator=\"p. 4\"}.\n\n::bibliography[]",
    "@article{doe2026, author={Doe, Jane}, title={Evidence}, year={2026}}",
  );
  assert.equal(rendered.diagnostics.length, 0);
  assert.match(rendered.html, /data-citation="doe2026"/u);
  assert.match(rendered.html, /data-locator="p\. 4"/u);
  assert.match(rendered.html, /data-source-from="/u);
  assert.match(rendered.html, /&#x3C;script>alert\(1\)&#x3C;\/script>/u);
  assert.doesNotMatch(rendered.html, /javascript:|Hidden note/u);
  const parsedBibliography = renderSync("See :cite[parsed].", [
    { id: "parsed", author: [{ family: "Reader", given: "Rita" }], title: "Parsed input", issued: { "date-parts": [[2025]] } },
  ]);
  assert.match(parsedBibliography.html, /Reader, 2025/u);
  const injectedBibliography = renderSync("See :cite[injected].", "custom input", "apa", {
    parseBibliography: () => [
      { id: "injected", author: [{ family: "Parser" }], title: "Injected parser", issued: { "date-parts": [[2024]] } },
    ],
  });
  assert.match(injectedBibliography.html, /Parser, 2024/u);
  const urlBibliography = renderSync("See :cite[remote].", "https://example.test/references.bib");
  assert.match(urlBibliography.diagnostics[0]?.message ?? "", /Missing citation: remote/u);
  assert.equal(fetches, 0);
} finally {
  globalThis.fetch = previousFetch;
}

console.log(
  `Browser consumer smoke: ${(bundled.contents.byteLength / 1024).toFixed(1)} kB raw, ${(gzipSync(bundled.contents).byteLength / 1024).toFixed(1)} kB gzip`,
);
