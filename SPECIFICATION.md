# Feature: Scientific Markdown Preview and Validation

## Blueprint

### Context

Researchers author the Markdown syntax defined by [`SYNTAX.md`](./SYNTAX.md).
Kirjolab must render
that language quickly, validate its semantic links, and avoid inventing a
second Markdown dialect.

### Architecture

- A pinned unified/remark pipeline parses standard Markdown with GFM,
  footnotes, frontmatter, and directives enabled.
- `src/markdown.ts` supplies an asynchronous unified pipeline with mdast and hast transforms for
  citations, references, labels, heading numbering, table alignment,
  authored-HTML escaping, and final allowlist sanitization.
- The dependency-free parser covers the bounded citation key, author, title,
  and year BibTeX profile. Renderers also accept parsed CSL-JSON or a synchronous
  parser injection; full Citation.js parsing lives behind the optional
  `scholarmark/citation-js` adapter. Citation formatting is a text-only host
  boundary, and the renderer does not bundle a CSL processor, locale, or style
  files.
- Editor support reuses the same analysis through a language server. The VS Code
  client injects TextMate scopes into ordinary Markdown so comments and
  directives highlight immediately without replacing Markdown support.
- `src/native-figures.ts` validates versioned bounded figure directives
  and derives deterministic SVG geometry before final sanitization.
- The pure-JavaScript renderer executes in the browser under a
  content-fingerprinted `/markdown-module-{sha256}.js` URL. The Worker serves
  that immutable asset but does not parse canonical documents or proxy
  request-per-edit preview work.
- The runtime loads in parallel with workspace data. Preview renders discard
  stale asynchronous results and fall back to authored source when the runtime
  cannot load.
- Markdown preview no longer requires WebAssembly, a helper Web Worker, shared
  memory, or cross-origin isolation. Remote HTTP(S) images remain subject to the
  browser and source server's ordinary security policy.
- Markdown and BibTeX remain canonical; preview HTML is disposable.
- The reference implementation exposes equivalent asynchronous and synchronous
  rendering paths. The asynchronous path leaves room for asynchronous plugins
  and awaits asynchronous host citation formatters; neither path fetches remote
  resources implicitly.

### Supported Syntax

- Standard headings, paragraphs, emphasis, strong text, links, images, lists,
  block quotes, thematic breaks, and fenced code.
- Preview headings preserve a descending visual size hierarchy from manuscript
  title through lower-level sections.
- Level-one headings are supported as ordinary Markdown document titles.
- GFM tables, strikethrough, task lists, autolinks, and footnotes.
- `:::details[Title]` encloses supplementary Markdown in a closed native HTML
  disclosure. It requires a plain-text title, a nonempty body and an explicit
  closing fence. The renderer supplies the `details` and `summary` elements;
  authored attributes are not accepted. The body retains its normal document
  semantics and source positions for use by interactive and print hosts.
- A postfix `::caption[text]` on a GFM table renders as its numbered, sanitized
  HTML caption. An optional table label follows the caption and becomes the
  table element's `id`.
- YAML and TOML frontmatter is parsed but not rendered in the preview.
- A `%` as the first non-whitespace character comments out its physical source
  line without splitting a surrounding prose paragraph. `\%` escapes a literal
  leading percent. Commented lines do not render or contribute document
  semantics.
- Standalone `::: comment` … `:::` blocks remain canonical source but do not
  render or contribute headings, citations, references, or validation inside
  the block. Markers in frontmatter and fenced code remain literal. An unclosed
  block diagnoses and keeps the remaining source out of the preview.
- Level-two and level-three headings receive generated section numbers.
- Captioned tables and valid native figures receive independent source-ordered
  numbers. Hosts may replace numbers by source offset, and render results expose
  the final caption, number, label, kind, and source range as metadata.
- Level-four headings render as unnumbered paragraph labels.
- `::label[id]` follows the Markdown block it labels and creates its reference
  target.
- `:ref[id]` resolves labels and accepts optional custom `text`. Labelled
  captioned tables and figures default to `Table N` and `Figure N` respectively.
- Hosts may provide publication-wide reference targets when rendering or
  diagnosing separately stored documents. Host targets take precedence over
  same-named local labels without changing the local label's rendered attachment.
- Render results expose local labels with their final title, default fragment,
  and normalized declaration range for publication indexing.
- `:cite` accepts multiple ids, `parenthetical`, `textual`, and `full` modes,
  plus `locator`, `prefix`, and `suffix`. The familiar `:citet` and `:citep`
  shortcuts default to textual and parenthetical modes respectively; an explicit
  `mode` attribute remains authoritative.
- The default inline author labels show one family name for a single author, both family
  names joined by “and” for two authors, and the first family name followed by
  “et al.” for three or more authors. Bibliography entries retain the complete
  authored list.
- `::bibliography[]` places the cited-reference list at that exact manuscript
  location. Researchers author any surrounding heading as ordinary Markdown.
- Each rendered citation id is an accessible sanitized button keyed by its
  citation id and carrying the group's inert locator, so grouped citations
  can open one publication at a time and page navigation can remain derived.
- The authoring toolbar exposes insertion templates for citations, labels,
  cross-references, footnotes, links, and `::include[path]`. Insertion
  teaches and writes canonical Markdown syntax; it does not introduce an
  editor-only document model.
- Quoted and unquoted single-token directive attributes are accepted, matching
  the source project's examples.
- Experimental version 1 `:::figure{kind="boxplot" version=1}` containers
  accept bounded five-number `::box` summaries and one `::caption`. Valid
  figures render as accessible horizontal boxplots; invalid figures stay
  visible and receive source-positioned diagnostics. The complete contract is
  defined in `NATIVE_FIGURES.md`.

### Security Boundary

- Authored raw HTML renders as text rather than executable markup.
- Unsafe protocols such as `javascript:` and image `data:` URLs lose their
  target attributes.
- Rendered elements retain only reviewed properties. Labels can provide ids;
  event handlers, inline styles, and other arbitrary attributes are removed.
- Semantic HTML escapes bibliography, directive, and heading values.
- Custom citation formatter results are inserted as text and pass through the
  same final sanitizer as the built-in formatter.
- Native figures select no authored elements or attributes: their bounded text
  and finite values become escaped labels and fixed geometry only. The final
  sanitizer admits only the SVG vocabulary used by that renderer.
- Only the typed client inserts preview HTML into the DOM.
- HTML responses apply a restrictive Content Security Policy. Same-origin
  scripts and workers remain available for the typed client and renderer,
  without allowing WebAssembly evaluation; browser connections are limited to
  the workspace origin and loopback local-model endpoints.

### Anti-Patterns

- Do not add syntax through pre-render string replacement ahead of the parser.
- Do not treat preview HTML or a unified syntax tree as canonical state.
- Do not move live preview to request-per-edit edge rendering without measuring
  revision coordination, network cost, and Worker CPU on bounded manuscripts.
- Do not pass authored raw HTML through to `innerHTML`.

## Contract

### Definition of Done

- [x] The documented standard Markdown and GFM examples render through the
      pinned JavaScript pipeline.
- [x] Citation modes, multiple ids, locators, prefixes, and suffixes render.
- [x] Inline citations compact author lists after two authors without
      truncating bibliography entries.
- [x] `:citet` and `:citep` shortcuts retain citation identity across preview,
      navigation, validation, history rewrites, and every publication output.
- [x] Rendered citation buttons open stable publication context without
      mutating canonical Markdown or the bibliography.
- [x] Rendered citation buttons retain sanitized locator data for local PDF-page
      navigation without exposing project-only evidence identities.
- [x] Labels on headings and non-heading blocks resolve with custom reference text.
- [x] Captioned tables and valid native figures render independent numbers,
      direct semantic-element ids, numbered reference titles, and structured metadata.
- [x] An explicit bibliography marker renders cited references in preview and
      publication outputs without printing directive syntax.
- [x] Portable block comments remain visible in source and absent from preview
      and publication semantics.
- [x] Invalid ids, modes, directives, and duplicate targets diagnose.
- [x] Browser preview uses one versioned JavaScript runtime without WASM or a
      helper worker.
- [x] Raw HTML and unsafe URL protocols cannot execute in the preview.
- [x] Native version 1 boxplots render deterministic sanitized SVG, while
      malformed directives remain visible with bounded diagnostics.
- [x] HTML responses enforce the preview's browser security boundary with CSP.
- [x] Unit tests cover syntax semantics and a browser test proves runtime
      startup.
- [x] The VS Code extension highlights portable comments and custom directives,
      while the language server provides shared diagnostics, completion,
      navigation, symbols, folding, references, and label rename.

### Regression Guardrails

- Keep every parser and transform dependency pinned; upgrades require the full
  syntax and security parity suite.
- Browser startup must not require cross-origin isolation for Markdown preview.
- Source editing and export must remain usable independently of preview HTML.
- A parser exception must become a bounded diagnostic and escaped source
  fallback, never an application crash or source mutation.
- Standard Markdown should be delegated to unified/remark rather than
  reimplemented.
- The Markdown runtime route must remain same-origin, immutable, versioned, and
  content-typed.
- Citation activation may navigate local research context but must never cite,
  import, enrich, or link a resource as an implicit side effect.

### Scenarios

**Scenario: Researcher writes a structured chapter section**

- Given: headings, a table, a footnote, citations, and a reference
- When: the source changes
- Then: the JavaScript pipeline produces numbered semantic HTML and Kirjolab
  reports unresolved scholarly targets without changing Markdown

**Scenario: Reference uses a LaTeX-style label**

- Given: `::label[sec:legacy]` immediately follows a heading
- When: the researcher uses `:ref[sec:legacy]`
- Then: the link resolves to that exact fragment and uses the heading title

**Scenario: Reference crosses a document boundary**

- Given: a host-provided target maps a semantic label to another page
- When: a separately rendered chapter uses `:ref` with that label
- Then: rendering and diagnostics resolve the host URL and title without
  weakening local label or directive validation

**Scenario: Researcher places the bibliography**

- Given: the manuscript cites project references
- When: the researcher writes a heading followed by `::bibliography[]`
- Then: preview, direct PDF, and LaTeX place the cited-reference list there
  without inventing a heading or printing the marker

**Scenario: Collaborator enters unsafe HTML**

- Given: raw HTML or a `javascript:` link in
  shared Markdown
- When: the preview renders
- Then: raw markup is displayed as text and unsafe target or element attributes
  are absent

**Scenario: Researcher authors a native boxplot**

- Given: a version 1 figure contains labelled ordered five-number summaries and
  one caption
- When: the preview renders
- Then: it shows a deterministic accessible horizontal boxplot without loading
  a plotting runtime or storing generated SVG
