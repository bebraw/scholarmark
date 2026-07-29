# Scholarmark

Scholarmark is a scientific Markdown dialect with citations, semantic
cross-references, numbered sections, bibliography placement, portable comment
blocks, and bounded native figures.

This repository contains the language [syntax specification](./SYNTAX.md), the
[Kirjolab implementation contract](./SPECIFICATION.md), and a TypeScript
reference implementation extracted from
[bebraw/kirjolab](https://github.com/bebraw/kirjolab) at commit
`3668de9e6285c90ef0c20f92ca4c4d3b62018588`.

## Syntax at a glance

Scholarmark keeps ordinary Markdown and GFM intact. You can continue using
links, images, emphasis, lists, tables, task lists, footnotes, and fenced code
blocks. The extensions add structure needed by scientific manuscripts.

### Numbered sections

Use the normal Markdown heading hierarchy, including a level-one heading for a
document title when appropriate. Scholarmark numbers level-two and level-three
headings automatically; level-four headings become unnumbered paragraph labels.

```markdown
# Study title

## Methods

### Participants

#### Exclusion criteria
```

### Labels and references

Use the same label syntax for every reference target. Like a LaTeX `\label`, it
follows the Markdown block it identifies, whether that block is a heading,
table, figure, or paragraph:

```markdown
## Statistical analysis
::label[sec:analysis]

See :ref[sec:analysis].
See :ref[sec:analysis]{text="the analysis section"}.
```

The label id is also the rendered fragment. A reference to a labelled heading
uses its numbered title by default. For other blocks, provide readable link
text when needed:

```markdown
| Sample | Value |
| ------ | ----: |
| A      |    42 |
::caption[Measurements collected during the trial.]
::label[table:measurements]

The measurements appear in
:ref[table:measurements]{text="the measurements table"}.
```

Place `::caption[...]` immediately after a GFM table. When the table also needs
a reference target, place its `::label[...]` after the caption as shown above.
The caption renders as the table's native HTML `<caption>`.

### Citations

Citation ids match entries in the accompanying BibTeX bibliography.

```markdown
The default is parenthetical :cite[merton1942].

As :citet[merton1942] explains, textual citations fit into a sentence.

Several sources can be grouped :citep[merton1942, doe2026].

:cite[merton1942]{mode=full}
:cite[merton1942]{locator="p. 42"}
:cite[merton1942]{prefix="See " suffix=" for details"}
```

The supported modes are `parenthetical`, `textual`, and `full`. `:citep` is a
shortcut for a parenthetical citation and `:citet` is a shortcut for a textual
citation. Bibliographies are normalized to CSL-JSON. The built-in text
formatter supports APA-like, Chicago author-date-like, and IEEE-like preview
output. The default parser covers citation keys, authors, titles, years, and
basic braced, quoted, or bare BibTeX values. Use the optional Citation.js
adapter for macros, TeX decoding, and extended fields.

Place the generated list of cited references exactly where it belongs:

```markdown
## References

::bibliography[]
```

### Portable comments

Comment blocks remain in the manuscript source but are omitted from rendered
output and validation. This is useful for notes between collaborators.

```markdown
::: comment
Verify this interpretation before submission.
:::
```

### Native boxplots

Version 1 figures describe a bounded horizontal boxplot directly in Markdown.
The renderer validates the five-number summaries and produces deterministic,
sanitized SVG.

```markdown
:::figure{kind="boxplot" version=1 x-label="Time (ms)" y-label="Method"}
::box[Baseline]{min=12 q1=15 median=18 q3=21 max=27}
::box[Proposed]{min=8 q1=10 median=11 q3=14 max=17}
::caption[Latency measured across five runs.]
:::
::label[fig:latency]
```

See [SYNTAX.md](./SYNTAX.md) for the core language and
[NATIVE_FIGURES.md](./NATIVE_FIGURES.md) for the complete figure contract.

## Install and verify

```sh
npm install
npm test
npm run build
```

## Render a document

```ts
import { render } from "scholarmark";

const markdown = `## Results

The result follows earlier work :cite[merton1942].

## References

::bibliography[]`;

const bibliography = `@article{merton1942,
  author = {Merton, Robert K.},
  title = {The Normative Structure of Science},
  year = {1942}
}`;

const rendered = await render(markdown, bibliography);

console.log(rendered.html);
console.log(rendered.diagnostics);
console.log(rendered.headings);
```

`render()` uses unified's asynchronous processing path. Citation formatter
methods may return strings or promises, allowing host-controlled remote data
resolution. Use `renderSync()` when every configured formatter and transform is
synchronous:

```ts
import { renderSync } from "scholarmark";

const rendered = renderSync(markdown, bibliography);
```

Neither function fetches remote resources implicitly. Resolve external data in
the host application and pass the resulting Markdown and bibliography to the
renderer.

### Render in a browser

Browser applications should use the dedicated browser entry. It exposes the
same synchronous renderer and integration helpers without importing Node.js
built-ins:

```ts
import { headingNumbersByOffset, renderSync } from "scholarmark/browser";

const headingNumbers = headingNumbersByOffset(markdown);
const rendered = renderSync(markdown, bibliography, "apa", {
  headingNumbers,
});
```

The browser entry is published as ordinary tree-shakeable ESM. It does not
include Citation.js and never loads bibliography URLs. Pass bounded BibTeX text
directly, or pass already parsed CSL-JSON:

```ts
const rendered = renderSync(markdown, [
  {
    id: "merton1942",
    author: [{ family: "Merton", given: "Robert K." }],
    title: "The Normative Structure of Science",
    issued: { "date-parts": [[1942]] },
  },
]);
```

Hosts can also inject any synchronous bibliography parser through the render
options. Authored Markdown still passes through the same final sanitizer as the
default entry.

`npm run test:browser` bundles a consumer fixture that imports this entry with
esbuild's `platform: "browser"`. This verifies the published ESM can be
tree-shaken, checks that no Node.js built-ins remain, checks that Citation.js
and its fetch dependencies remain absent, exercises synchronous rendering with
all three bibliography paths without a fetch, and reports raw and gzip bundle
sizes.

Each result includes metadata for the rendered level-two and level-three
headings. The values are collected after numbering and ID allocation, so they
can be used directly for navigation:

```ts
for (const heading of rendered.headings) {
  console.log(heading.depth, heading.id, heading.title, heading.number);
}
```

Each heading also includes `from` and `to`, its offsets in the normalized
Markdown source. Duplicate titles receive the same unique suffixes used by the
rendered HTML.

### Resolve references across documents

Pass publication-wide targets through `referenceTargets` when separately
rendered documents refer to one another:

```ts
const referenceTargets = new Map([
  [
    "ch:technology",
    {
      title: "11. Technology",
      href: "/book/technology/",
    },
  ],
  [
    "sec:citing-in-latex",
    {
      title: "A.5 Cite in LaTeX",
      href: "/book/latex/#cite-in-latex",
    },
  ],
]);

const rendered = await render(markdown, bibliography, "apa", {
  referenceTargets,
});
```

A host target takes precedence over a same-named local `::label`. Its complete
`href` is used unchanged unless the sanitizer rejects its URL protocol. Custom
`:ref[id]{text="..."}` text still takes precedence over the target title. Each
rendered link retains the authored id in `data-reference`.

`rendered.references` describes the labels declared by the current document.
Each entry contains the label, default local fragment, final display title, and
the normalized source range of its `::label` declaration. Heading targets use
the final heading number, including a `headingNumbers` override. This lets a
host build a publication index before a final render with `referenceTargets`.

The standalone validator accepts the same context:

```ts
const diagnostics = diagnose(markdown, bibliography, { referenceTargets });
```

### Extend the sanitized tree

Use `renderTree()` or `renderTreeSync()` when a host application needs to add
trusted behavior after Scholarmark parsing. The returned HAST has already passed
through Scholarmark's sanitizer:

```ts
import { renderTree, toHtml } from "scholarmark";

const rendered = await renderTree(markdown, bibliography);

rendered.tree.children.push({
  type: "element",
  tagName: "aside",
  properties: { className: ["interactive-demo"] },
  children: [{ type: "text", value: "Trusted host content" }],
});

const html = toHtml(rendered.tree);
```

`renderTree()` supports asynchronous citation formatters, while
`renderTreeSync()` requires every formatter and transform to be synchronous.
Every call returns a fresh tree that the host may mutate independently.

The sanitizer protects the tree at the point Scholarmark returns it. A host is
responsible for nodes it adds afterward, and `toHtml()` deliberately serializes
without sanitizing again. Keep untrusted authored HTML in the Markdown input so
Scholarmark can escape it; only add content that the host has independently
validated to the returned tree.

Both renderers accept an optional citation style (`apa`,
`chicago-author-date`, or `ieee`) and optional heading numbers. The exported
BibTeX, comment, and native-figure helpers are available for integrations that
need the individual language stages.

### Use a CSL formatter

Scholarmark deliberately does not bundle a CSL processor or style files. A host
application can add Citation.js's CSL plugin itself:

```sh
npm install @citation-js/core @citation-js/plugin-csl
```

Each formatter entry exposes its CSL-JSON as `entry.data`. This complete APA
formatter uses Citation.js for both inline citations and bibliography entries:

```js
import { Cite } from "@citation-js/core";
import "@citation-js/plugin-csl";
import { render } from "scholarmark";

const cslOptions = {
  format: "text",
  template: "apa",
  lang: "en-US",
};

const withoutParentheses = (value) =>
  value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;

const citationFormatter = {
  formatCitation(entry, { mode }) {
    const cite = new Cite([entry.data]);
    if (mode === "full") {
      return cite.format("bibliography", cslOptions).trim();
    }
    if (mode === "textual") {
      const author = cite.format("citation", {
        ...cslOptions,
        entry: [{ id: entry.id, "author-only": true }],
      });
      const date = cite.format("citation", {
        ...cslOptions,
        entry: [{ id: entry.id, "suppress-author": true }],
      });
      return `${author} ${date}`;
    }
    return withoutParentheses(cite.format("citation", cslOptions));
  },
  formatBibliography(entry) {
    return new Cite([entry.data]).format("bibliography", cslOptions).trim();
  },
};

const rendered = await render(markdown, bibliography, "apa", {
  citationFormatter,
});
```

Change `template` and `lang` to select another installed or registered CSL style
and locale. Formatter output is treated as text and still appears inside
Scholarmark's sanitized, interactive citation markup.

For complete BibTeX parsing, install the optional parser peers and inject the
adapter:

```sh
npm install @citation-js/core @citation-js/plugin-bibtex
```

```ts
import { renderSync } from "scholarmark/browser";
import { parseBibliography } from "scholarmark/citation-js";

const rendered = renderSync(markdown, bibliography, "apa", {
  parseBibliography,
});
```

The adapter is synchronous and returns CSL-JSON records, so the same function
can be used with `render`, `renderTree`, `renderTreeSync`, `diagnose`, or the
exported bibliography helpers.

## VS Code extension

The included extension adds Scholarmark support to ordinary Markdown files:

- Theme-aware highlighting and folding for `::: comment` blocks
- Highlighting for citations, references, labels, bibliography markers, and figures
- Live diagnostics, completion, hover information, and document symbols
- Go to definition for labels and BibTeX keys
- Find references and rename for labels
- Authoring snippets under the `sm-` prefix

Build and install it locally:

```sh
npm run package:vscode
code --install-extension editors/vscode/scholarmark-vscode-0.1.0.vsix
```

The language server reads `bibliography.bib` from the workspace root by
default. Set `scholarmark.bibliographyFile` to another workspace-relative path
when needed. It only reports Scholarmark diagnostics in Markdown files that use
at least one recognized Scholarmark construct.

## Origins

The syntax document was originally maintained in
[`survivejs/learnscientificwriting`](https://github.com/survivejs/learnscientificwriting)
and is copied here from commit
`3f2dc6783924e88cacdd5bdd875dc37612d94015`, the source named by Kirjolab's
contract.

## License

Scholarmark is available under the [MIT License](./LICENSE).
