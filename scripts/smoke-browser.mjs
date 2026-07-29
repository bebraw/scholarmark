import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `
      import { renderSync, projectMarkdownComments, parseNativeFigure } from "scholarmark/browser";
      export { renderSync, projectMarkdownComments, parseNativeFigure };
    `,
    resolveDir: process.cwd(),
    sourcefile: "browser-consumer.js",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  logLevel: "error",
});

const bundled = result.outputFiles[0];
if (!bundled) throw new Error("Browser smoke bundle was not produced");
const source = bundled.text;
assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()["']node:/u);

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
  const urlBibliography = renderSync("See :cite[remote].", "https://example.test/references.bib");
  assert.match(urlBibliography.diagnostics[0]?.message ?? "", /Missing citation: remote/u);
  assert.equal(fetches, 0);
} finally {
  globalThis.fetch = previousFetch;
}

console.log(
  `Browser consumer smoke: ${(bundled.contents.byteLength / 1024).toFixed(1)} kB raw, ${(gzipSync(bundled.contents).byteLength / 1024).toFixed(1)} kB gzip`,
);
