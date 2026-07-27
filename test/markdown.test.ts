import { describe, expect, it } from "vitest";
import {
  diagnose,
  headingNumbersByOffset,
  parseBibliography,
  render as renderAsync,
  renderSync as render,
  renderTree,
  renderTreeSync,
  slugify,
  toHtml,
} from "../src/markdown";

const bibliography = `@article{merton1942,
  author = {Merton, Robert K.},
  title = {The Normative Structure of Science},
  year = {1942}
}
`;

function withoutSourcePositions(html: string): string {
  return html.replaceAll(/ data-source-(?:from|to)="\d+"/gu, "");
}

describe("render", () => {
  it("keeps asynchronous and synchronous rendering equivalent", async () => {
    const source = "## Evidence\n\nSee :cite[merton1942].\n\n::bibliography[]";

    expect(await renderAsync(source, bibliography)).toEqual(render(source, bibliography));
  });

  it("returns equivalent sanitized trees on asynchronous and synchronous paths", async () => {
    const source = "## Evidence\n\nSee :cite[merton1942].";

    expect(await renderTree(source, bibliography)).toEqual(renderTreeSync(source, bibliography));
    expect(toHtml(renderTreeSync(source, bibliography).tree)).toBe(render(source, bibliography).html);
  });

  it("lets a host extend a fresh sanitized tree with trusted nodes", () => {
    const source = "## Safe\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))";
    const first = renderTreeSync(source, "");

    expect(toHtml(first.tree)).not.toContain("<script>");
    expect(toHtml(first.tree)).not.toContain('href="javascript:');
    first.tree.children.push({
      type: "element",
      tagName: "aside",
      properties: { className: ["trusted-demo"] },
      children: [{ type: "text", value: "Added by the host" }],
    });

    expect(toHtml(first.tree)).toContain('<aside class="trusted-demo">Added by the host</aside>');
    expect(toHtml(renderTreeSync(source, "").tree)).not.toContain("trusted-demo");
  });

  it("represents transform failures as safe trees", async () => {
    const source = "See :cite[missing].\n\n<script>alert(1)</script>";
    const citationFormatter = {
      formatCitation: async () => {
        throw new Error("remote citation failed");
      },
      formatBibliography: async () => "unused",
    };
    const rendered = await renderTree(source, "", "apa", { citationFormatter });
    const html = toHtml(rendered.tree);

    expect(rendered.headings).toEqual([]);
    expect(rendered.diagnostics.at(-1)?.message).toBe("remote citation failed");
    expect(html).toContain("See :cite[missing].");
    expect(html).not.toContain("<script>");
  });

  it("awaits asynchronous citation formatters only on the asynchronous path", async () => {
    const source = "See :cite[merton1942].\n\n::bibliography[]";
    const citationFormatter = {
      formatCitation: async () => "citation from remote data",
      formatBibliography: async () => "bibliography from remote data",
    };

    const asynchronous = await renderAsync(source, bibliography, "apa", { citationFormatter });
    expect(asynchronous.html).toContain(">citation from remote data</button>");
    expect(asynchronous.html).toContain("<li>bibliography from remote data</li>");

    const synchronous = render(source, bibliography, "apa", { citationFormatter });
    expect(synchronous.diagnostics.at(-1)?.message).toMatch(/async/iu);
  });

  it("resolves host-provided references with host-first precedence on both render paths", async () => {
    const source = `## Local technology
::label[ch:technology]

See :ref[ch:technology] and :ref[sec:citing]{text="the LaTeX section"}.`;
    const referenceTargets = new Map([
      ["ch:technology", { title: "11. Technology", href: "/book/technology/" }],
      ["sec:citing", { title: "A.5 Cite in LaTeX", href: "/book/latex/#cite-in-latex" }],
    ]);
    const asynchronous = await renderAsync(source, "", "apa", { referenceTargets });
    const synchronous = render(source, "", "apa", { referenceTargets });
    const html = withoutSourcePositions(asynchronous.html);

    expect(asynchronous).toEqual(synchronous);
    expect(asynchronous.diagnostics).toEqual([]);
    expect(html).toContain(
      '<a class="semantic-reference" data-reference="ch:technology" href="/book/technology/">11. Technology</a>',
    );
    expect(html).toContain(
      '<a class="semantic-reference" data-reference="sec:citing" href="/book/latex/#cite-in-latex">the LaTeX section</a>',
    );
    expect(diagnose(":ref[sec:citing]", "", { referenceTargets })).toEqual([]);
  });

  it("keeps unresolved references invalid and sanitizes unsafe host destinations", () => {
    const source = ":ref[missing] :ref[unsafe]";
    const rendered = render(source, "", "apa", {
      referenceTargets: new Map([["unsafe", { title: "Unsafe", href: "javascript:alert(1)" }]]),
    });

    expect(rendered.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", message: "Missing label: missing" }),
    );
    expect(withoutSourcePositions(rendered.html)).toContain('<a class="semantic-reference" data-reference="unsafe">Unsafe</a>');
    expect(rendered.html).not.toContain("javascript:");
  });

  it("renders an accessible deterministic native boxplot", () => {
    const source = `:::figure{kind="boxplot" version=1 x-label="Time (ms)" y-label="Variant"}
::box[SSR & FCP]{min=1613 q1=1627 median=1628 q3=1632 max=1641}
::box[Islands]{min=838 q1=838 median=838 q3=846 max=858}
::caption[First Contentful Paint across five benchmark runs.]
:::
::label[fig:fcp-summary]`;

    const rendered = render(source, "");
    const html = withoutSourcePositions(rendered.html);
    const figureFrom = source.indexOf(":::figure");

    expect(rendered.diagnostics).toEqual([]);
    expect(html).toContain('<span class="semantic-label" id="fig:fcp-summary"></span>');
    expect(html).toContain('<figure class="native-figure native-figure-boxplot">');
    expect(html).toContain(`<svg viewBox="0 0 720 168" role="img" aria-labelledby="native-figure-title-${figureFrom}"`);
    expect(html).toContain(
      `<title id="native-figure-title-${figureFrom}">First Contentful Paint across five benchmark runs.</title>`,
    );
    expect(html).toContain('class="native-figure-box"');
    expect(html).toContain("SSR &#x26; FCP");
    expect(html).toContain("<figcaption>First Contentful Paint across five benchmark runs.</figcaption>");
    expect(html).not.toMatch(/(?:NaN|Infinity)/u);
  });

  it("keeps invalid native figure syntax visible and reports its source range", () => {
    const source = `:::figure{kind="boxplot" version=1}
::box[Broken]{min=5 q1=4 median=3 q3=2 max=1}
::caption[Needs correction]
:::`;
    const rendered = render(source, "");

    expect(rendered.diagnostics).toContainEqual({
      severity: "error",
      message: "Box values must satisfy min <= q1 <= median <= q3 <= max",
      from: source.indexOf("::box"),
      to: source.indexOf("\n::caption"),
    });
    expect(rendered.html).toContain('class="native-figure-error"');
    expect(rendered.html).toContain(":::figure");
    expect(rendered.html).not.toContain("<svg");
  });

  it("rejects native figure children outside their container", () => {
    const rendered = render("::box[Loose]{min=1 q1=2 median=3 q3=4 max=5}", "");

    expect(rendered.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["::box must be inside a :::figure container"]);
    expect(rendered.html).toContain("::box[Loose]");
  });

  it("retains sanitized source offsets on rendered elements", () => {
    const rendered = render("## Evidence\n\nMapped paragraph.", "");

    expect(rendered.html).toContain('data-source-from="0" data-source-to="11"');
    expect(rendered.html).toContain('data-source-from="13" data-source-to="30"');
  });

  it("renders project citation profiles without changing citation identity", () => {
    const source = "Evidence :cite[merton1942, doe2026].";
    const sources = `${bibliography}\n@article{doe2026, author={Doe, Jane}, year={2026}, title={Methods}}`;
    const text = (style: "apa" | "chicago-author-date" | "ieee") =>
      render(source, sources, style).html.replaceAll(/<[^>]+>/gu, "");
    expect(text("apa")).toContain("(Merton, 1942; Doe, 2026)");
    expect(text("chicago-author-date")).toContain("(Merton 1942; Doe 2026)");
    expect(text("ieee")).toContain("[1, 2]");
  });
  it("uses a host citation formatter while preserving interactive citation markup", () => {
    const source = "Evidence :cite[merton1942].\n\n::bibliography[]";
    const rendered = render(source, bibliography, "apa", {
      citationFormatter: {
        formatCitation: (entry, context) => `custom ${entry.data.type} ${context.mode}`,
        formatBibliography: (entry) => `custom bibliography ${entry.id}`,
      },
    });

    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.html).toContain('data-citation="merton1942"');
    expect(rendered.html).toContain(">custom article-journal parenthetical</button>");
    expect(rendered.html).toContain("<li>custom bibliography merton1942</li>");
  });
  it("renders natbib-style textual and parenthetical citation shortcuts", () => {
    const rendered = render("As :citet[merton1942] argues; compare :citep[merton1942].", bibliography);
    expect(rendered.diagnostics).toEqual([]);
    const text = rendered.html.replaceAll(/<[^>]+>/gu, "");
    expect(text).toContain("As Merton (1942) argues; compare (Merton, 1942).");
    expect(rendered.html.match(/data-citation="merton1942"/gu)).toHaveLength(2);
  });
  it("compacts preview citations with more than two authors", () => {
    const sources = `@article{conilh2023,
      author={Louise Conilh and Lenka Sadílková and Warren Viricel and Charles Dumontet},
      title={A collaborative study},
      year={2023}
    }`;
    const rendered = render("As :citet[conilh2023] reports; compare :citep[conilh2023].", sources);
    const text = rendered.html.replaceAll(/<[^>]+>/gu, "");

    expect(rendered.diagnostics).toEqual([]);
    expect(text).toContain("As Conilh et al. (2023) reports; compare (Conilh et al., 2023).");
    expect(text).not.toContain("Sadílková");
  });
  it("renders meaningful Markdown and extended scholarly directives", () => {
    const source = `## Evidence
::label[sec-legacy]

Text with **weight**, *emphasis*, \`code\`, [source](https://example.com), :cite[merton1942]{mode=textual locator="p. 4"}, and :ref[sec-legacy]{text="Evidence"}.

- one
- two
::label[table:one]

\`\`\`ts
const answer = 42;
\`\`\`
`;
    const rendered = render(source, bibliography);
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics).toEqual([]);
    expect(html).toContain('<span class="semantic-label" id="sec-legacy"></span>');
    expect(html).toContain('<h2 id="evidence"><span class="section-number">1 </span>Evidence</h2>');
    expect(html).toContain(
      '<button type="button" class="semantic-citation" data-citation="merton1942" data-locator="p. 4" aria-label="Open reference The Normative Structure of Science">Merton (1942)</button>, p. 4',
    );
    expect(html).toContain('<a class="semantic-reference"');
    expect(html).toContain("<strong>weight</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("const answer = 42;");
    expect(html).toContain('<span class="semantic-label" id="table:one"></span>');
    expect(html).toContain('<a class="semantic-reference" data-reference="sec-legacy" href="#sec-legacy">Evidence</a>');
    expect(html).toContain('<code class="language-ts">const answer = 42;');
  });

  it("reports missing, duplicate, empty, and unsupported directives", () => {
    const source = `## One
::label[same]
## Two
::label[same]

:cite[missing]{mode="unknown"} :cite[] :ref[absent] :ref[]
`;
    const messages = render(source, bibliography).diagnostics.map((diagnostic) => diagnostic.message);

    expect(messages).toContain("Missing citation: missing");
    expect(messages).toContain("Unsupported citation mode: unknown");
    expect(messages).toContain("Citation requires an id");
    expect(messages).toContain("Missing label: absent");
    expect(messages).toContain("Reference requires a label id");
    expect(messages).toContain("Duplicate label: same");
    expect(messages).toEqual([
      "Duplicate label: same",
      "Unsupported citation mode: unknown",
      "Missing citation: missing",
      "Citation requires an id",
      "Missing label: absent",
      "Reference requires a label id",
    ]);
  });

  it("renders full and parenthetical citations and closes an open code fence", () => {
    const source = `## Notes

:cite[merton1942]{mode="full" prefix="See " suffix="."}

:cite[merton1942]

\`\`\`
unfinished`;
    const rendered = render(source, bibliography);
    const html = withoutSourcePositions(rendered.html);

    expect(html).toContain("See <button");
    expect(html).toContain(">Merton. 1942. The Normative Structure of Science</button>.");
    expect(html).toContain(
      '(<button type="button" class="semantic-citation" data-citation="merton1942" aria-label="Open reference The Normative Structure of Science">Merton, 1942</button>)',
    );
    expect(html).toContain("unfinished\n</code></pre>");
    expect(html).toContain('<h2 id="notes"><span class="section-number">1 </span>Notes</h2>');
  });

  it("renders cited references at an explicit bibliography marker", () => {
    const sources = `${bibliography}\n@article{unused, author={Unused, Una}, year={2025}, title={Unused work}}`;
    const rendered = render("Evidence :cite[merton1942].\n\n## References\n\n::bibliography[]", sources);
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics).toEqual([]);
    expect(html).toContain('<ol class="semantic-bibliography"><li>Merton, Robert K. (1942). The Normative Structure of Science.</li></ol>');
    expect(html).not.toContain("Unused work");
  });

  it("diagnoses malformed and duplicate bibliography markers", () => {
    const source = "::bibliography[all]\n::bibliography[]{scope=project}\n::bibliography[]\n::bibliography[]";
    const malformed = "::bibliography[all]";
    const scoped = "::bibliography[]{scope=project}";
    const firstDuplicate = source.indexOf("\n::bibliography[]\n") + 1;
    const secondDuplicate = source.lastIndexOf("::bibliography[]");

    expect(render(source, bibliography).diagnostics).toEqual([
      {
        severity: "error",
        message: "Bibliography marker must be exactly ::bibliography[]",
        from: source.indexOf(malformed),
        to: source.indexOf(malformed) + malformed.length,
      },
      {
        severity: "error",
        message: "Bibliography marker must be exactly ::bibliography[]",
        from: source.indexOf(scoped),
        to: source.indexOf(scoped) + scoped.length,
      },
      {
        severity: "error",
        message: "Duplicate bibliography marker",
        from: firstDuplicate,
        to: firstDuplicate + "::bibliography[]".length,
      },
      {
        severity: "error",
        message: "Duplicate bibliography marker",
        from: secondDuplicate,
        to: secondDuplicate + "::bibliography[]".length,
      },
    ]);
  });

  it("normalizes CRLF, joins paragraph lines, and renders heading levels", () => {
    const html = withoutSourcePositions(render("### Three\r\n\r\nline one\r\nline two\r\n\r\n#### Four", "").html);
    expect(html).toContain('<h3 id="three"><span class="section-number">0.1 </span>Three</h3>');
    expect(html).toContain("<p>line one\nline two</p>");
    expect(html).toContain("<b>Four</b>");
    expect(render("", "")).toEqual({ html: "", diagnostics: [], headings: [], references: [] });
  });

  it("returns final numbered heading metadata without ID collisions", () => {
    const source = `## A

### *Detail* \`code\` &amp;

## A-2

::: comment
## Hidden
:::

## A

#### Paragraph label`;
    const detailFrom = source.indexOf("### *Detail*");
    const lastFrom = source.lastIndexOf("## A");
    const rendered = render(source, "", "apa", { headingNumbers: { [detailFrom]: "7.3" } });

    expect(rendered.headings).toEqual([
      { depth: 2, id: "a", title: "A", number: "1", from: 0, to: "## A".length },
      {
        depth: 3,
        id: "detail-code",
        title: "Detail code &",
        number: "7.3",
        from: detailFrom,
        to: detailFrom + "### *Detail* `code` &amp;".length,
      },
      {
        depth: 2,
        id: "a-2",
        title: "A-2",
        number: "2",
        from: source.indexOf("## A-2"),
        to: source.indexOf("## A-2") + "## A-2".length,
      },
      { depth: 2, id: "a-3", title: "A", number: "3", from: lastFrom, to: lastFrom + "## A".length },
    ]);
    expect(withoutSourcePositions(rendered.html)).toContain('<h2 id="a-3"');
  });

  it("returns local reference targets with final heading titles and declaration ranges", () => {
    const source = `## *Methods* &amp; materials
::label[sec:methods]

| Value |
| ---: |
| 42 |
::label[table:data]

An ordinary block.
::label[paragraph:note]`;
    const headingFrom = source.indexOf("## *Methods*");
    const rendered = render(source, "", "apa", { headingNumbers: { [headingFrom]: "3.2" } });
    const range = (declaration: string) => ({
      from: source.indexOf(declaration),
      to: source.indexOf(declaration) + declaration.length,
    });

    expect(rendered.references).toEqual([
      {
        label: "sec:methods",
        title: "3.2 Methods & materials",
        fragment: "sec:methods",
        ...range("::label[sec:methods]"),
      },
      {
        label: "table:data",
        title: "table:data",
        fragment: "table:data",
        ...range("::label[table:data]"),
      },
      {
        label: "paragraph:note",
        title: "paragraph:note",
        fragment: "paragraph:note",
        ...range("::label[paragraph:note]"),
      },
    ]);
    expect(withoutSourcePositions(rendered.html)).toContain(
      '<h2 id="methods-materials"><span class="section-number">3.2 </span><em>Methods</em> &#x26; materials</h2>',
    );
  });

  it("derives composed heading numbers and applies source-positioned overrides", () => {
    const source = "## Introduction\n\n::: comment\n## Hidden\n:::\n\n```md\n## Literal\n```\n\n## Method\n\n### Detail\n";
    const methodOffset = source.indexOf("## Method");
    const detailOffset = source.indexOf("### Detail");

    expect(headingNumbersByOffset(source)).toEqual({ 0: "1", [methodOffset]: "2", [detailOffset]: "2.1" });

    const isolated = "## Method\n\n### Detail\n";
    const html = withoutSourcePositions(
      render(isolated, "", "apa", {
        headingNumbers: { 0: "2", [isolated.indexOf("### Detail")]: "2.1" },
      }).html,
    );
    expect(html).toContain('<h2 id="method"><span class="section-number">2 </span>Method</h2>');
    expect(html).toContain('<h3 id="detail"><span class="section-number">2.1 </span>Detail</h3>');
  });

  it("renders the documented GFM surface through the JavaScript pipeline", () => {
    const source = `---
title: Hidden frontmatter
---

## Syntax

![diagram](https://example.com/diagram.png)

| Method | Result |
| --- | --- |
| A | ~~41~~ **42** |

1. first
2. second

A statement with detail.[^detail]

[^detail]: Supporting *detail*.
`;
    const rendered = render(source, "");
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics).toEqual([]);
    expect(html).not.toContain("Hidden frontmatter");
    expect(html).toContain('<img src="https://example.com/diagram.png" alt="diagram">');
    expect(html).toContain("<table>");
    expect(html).toContain("<del>41</del> <strong>42</strong>");
    expect(html).toContain("<ol>");
    expect(html).toContain("data-footnote-ref");
    expect(html).toContain('data-footnotes class="footnotes"');
  });

  it("omits comment blocks and ignores their Markdown semantics", () => {
    const rendered = render(
      `## Visible

::: comment
## Hidden {#hidden}
Unpublished :cite[missing] and :unknown[value].
:::

After the comment.`,
      "",
    );

    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.html).toContain("Visible");
    expect(rendered.html).toContain("After the comment.");
    expect(rendered.html).not.toContain("Hidden");
    expect(rendered.html).not.toContain("Unpublished");
    expect(rendered.html).not.toContain('id="hidden"');
  });

  it("diagnoses an unclosed comment without rendering its contents", () => {
    const rendered = render("Before\n\n::: comment\nHidden", "");
    expect(rendered.diagnostics).toEqual([{ severity: "error", message: "Comment block is not closed", from: 8, to: 19 }]);
    expect(rendered.html).toContain("Before");
    expect(rendered.html).not.toContain("Hidden");
  });

  it("validates unsupported directives", () => {
    const source = `::unknown[value]
:::unknown
content
:::

::alias[Missing]{target="sec:missing" slug="missing"}
::anchor[Missing]{target="table:missing"}

## Present

:unknown[value]
# Chapter title
`;
    const exact = (message: string, fragment: string, from = source.indexOf(fragment)) => ({
      severity: "error",
      message,
      from,
      to: from + fragment.length,
    });
    const rendered = render(source, "");
    expect(rendered.diagnostics).toEqual([
      exact("Unsupported leaf directive: ::unknown", "::unknown[value]"),
      exact("Unsupported container directive: :::unknown", ":::unknown"),
      exact("Unsupported leaf directive: ::alias", '::alias[Missing]{target="sec:missing" slug="missing"}'),
      exact("Unsupported leaf directive: ::anchor", '::anchor[Missing]{target="table:missing"}'),
      exact("Unsupported text directive: :unknown", ":unknown[value]", source.lastIndexOf(":unknown[value]")),
    ]);
    expect(withoutSourcePositions(rendered.html)).toContain("<h1>Chapter title</h1>");
  });

  it("uses one label syntax for a level-one title reference", () => {
    const rendered = render("# Study\n::label[study]\n\nSee :ref[study].", "");

    expect(rendered.diagnostics).toEqual([]);
    const html = withoutSourcePositions(rendered.html);
    expect(html).toContain('<span class="semantic-label" id="study"></span>');
    expect(html).toContain("<h1>Study</h1>");
    expect(html).toContain('<a class="semantic-reference" data-reference="study" href="#study">Study</a>');
  });

  it("renders authored HTML as text and removes unsafe link targets", () => {
    const rendered = render(
      '<img src=x onerror="alert(1)"> <button type="button" onclick="alert(1)">authored</button>\n\n[unsafe](javascript:alert(1)) ![unsafe](data:image/svg+xml,evil) [safe](mailto:test@example.org)',
      "",
    );

    expect(rendered.html).toContain('&#x3C;img src=x onerror="alert(1)">');
    expect(rendered.html).not.toContain("<img src=x onerror");
    expect(rendered.html).toContain('&#x3C;button type="button" onclick="alert(1)">authored&#x3C;/button>');
    expect(rendered.html).not.toContain('<button type="button" onclick=');
    expect(rendered.html).not.toContain("javascript:");
    expect(rendered.html).not.toContain("data:image");
    expect(rendered.html).toContain('href="mailto:test@example.org"');
  });

  it("rejects heading ids in favor of labels", () => {
    const source = "## Safe heading {#safe}";
    const rendered = render(source, "");
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics).toEqual([
      { severity: "error", message: "Heading ids are not supported; use ::label[id]", from: 0, to: source.length },
    ]);
    expect(html).toContain("Safe heading {#safe}");
  });

  it("preserves the complete reviewed Markdown element and property vocabulary", () => {
    const rendered = render(
      `# One

## Two

### Three

#### Four

##### Five

###### Six

> quote with *emphasis* and **strong**

---

[link](https://example.com "title")  
next with \`inline\`

\`\`\`ts
const x = 1
\`\`\`

- [x] task
- item

3. third
4. fourth

| Left | Right |
| :--- | ---: |
| ~~old~~ | new |

![diagram](https://example.com/a.png "diagram")

Footnote.[^a]

[^a]: Note.
`,
      "",
    );
    const html = withoutSourcePositions(rendered.html);

    for (const fragment of [
      "<h1>One</h1>",
      '<h2 id="two"><span class="section-number">',
      '<h3 id="three"><span class="section-number">',
      "<b>Four</b>",
      "<h5>Five</h5>",
      "<h6>Six</h6>",
      "<blockquote>",
      "<p>quote with <em>emphasis</em> and <strong>strong</strong></p>",
      "<hr>",
      '<a href="https://example.com" title="title">',
      "<br>",
      "<code>inline</code>",
      '<pre><code class="language-ts">',
      '<ul class="contains-task-list">',
      '<li class="task-list-item"><input type="checkbox" checked disabled>',
      '<ol start="3">',
      "<table>",
      "<thead>",
      "<tbody>",
      "<tr>",
      '<th style="text-align: left">',
      '<td style="text-align: right">',
      "<del>old</del>",
      '<img src="https://example.com/a.png" alt="diagram" title="diagram">',
      '<sup><a href="#user-content-fn-a" id="user-content-fnref-a" data-footnote-ref aria-describedby="footnote-label">',
      '<section data-footnotes class="footnotes">',
      'data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref"',
    ]) {
      expect(html).toContain(fragment);
    }
  });

  it("resolves labels on headings and other blocks with multiple citations", () => {
    const extendedBibliography = `${bibliography}
@article{doe2026,
  author = {Doe, Jane},
  title = {Inspectable Results},
  year = {2026}
}
`;
    const rendered = render(
      `## Repeated
::label[sec:legacy]

## Repeated

| Value |
| ---: |
| 42 |
::label[table:one]

:ref[sec:legacy] :ref[table:one]{text="custom table"}

:cite[merton1942, doe2026]{mode=textual prefix="See " suffix=" for context" locator="p. 4"}
`,
      extendedBibliography,
    );
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics).toEqual([]);
    expect(html).toContain('<span class="semantic-label" id="sec:legacy"></span>');
    expect(html).toContain('<h2 id="repeated"><span class="section-number">1 </span>Repeated</h2>');
    expect(html).toContain('<h2 id="repeated-2"><span class="section-number">2 </span>Repeated</h2>');
    expect(html).toContain('<a class="semantic-reference" data-reference="sec:legacy" href="#sec:legacy">1 Repeated</a>');
    expect(html).toContain('<a class="semantic-reference" data-reference="table:one" href="#table:one">custom table</a>');
    expect(html).toContain("See <button");
    expect(html).toContain(">Merton (1942)</button>, <button");
    expect(html).toContain(">Doe (2026)</button>, p. 4 for context");
  });

  it("diagnoses incomplete label declarations", () => {
    const source = "Paragraph\n::label[]";
    const from = source.indexOf("::label[]");
    expect(render(source, "").diagnostics).toEqual([
      { severity: "error", message: "Label requires an id", from, to: from + "::label[]".length },
    ]);
  });

  it("diagnoses invalid and unattached labels", () => {
    const source = "Paragraph\n::label[bad id]\n\n::label[orphan]";
    const invalidFrom = source.indexOf("::label[bad id]");
    const orphanFrom = source.indexOf("::label[orphan]");

    expect(render(source, "").diagnostics).toEqual([
      {
        severity: "error",
        message: "Invalid label id: bad id",
        from: invalidFrom,
        to: invalidFrom + "::label[bad id]".length,
      },
      {
        severity: "error",
        message: "Label must follow a block",
        from: orphanFrom,
        to: orphanFrom + "::label[orphan]".length,
      },
    ]);
  });

  it("rejects the former prefix label placement", () => {
    const source = "::label[legacy]\n## Heading";

    expect(render(source, "").diagnostics).toEqual([
      {
        severity: "error",
        message: "Label must follow a block",
        from: 0,
        to: "::label[legacy]".length,
      },
    ]);
    expect(render(source, "").references).toEqual([]);
  });

  it("accepts trailing whitespace on a label", () => {
    const rendered = render("## **Bold** tail\n::label[long-id]   ", "");
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics).toEqual([]);
    expect(html).toContain('<span class="semantic-label" id="long-id"></span>');
    expect(html).toContain('<h2 id="bold-tail"><span class="section-number">1 </span><strong>Bold</strong> tail</h2>');
  });

  it("reports an unclosed first-line comment through the exact end of input", () => {
    const source = "::: comment";
    const rendered = render(source, "");

    expect(rendered).toEqual({
      html: "",
      diagnostics: [{ severity: "error", message: "Comment block is not closed", from: 0, to: source.length }],
      headings: [],
      references: [],
    });
  });

  it("anchors label validation to complete multi-character lines", () => {
    const source = `prefix ::bibliography[]
::bibliography[all-long]{scope=project-long}${"  "}
prefix :::unknown-container
:::unknown-container extra words
Paragraph
::label[target-long]${"  "}
Paragraph
::label[target-long]  `;
    const diagnostics = render(source, "").diagnostics;

    expect(diagnostics.map(({ message }) => message)).toEqual([
      "Bibliography marker must be exactly ::bibliography[]",
      "Unsupported container directive: :::unknown-container",
      "Duplicate label: target-long",
    ]);
    expect(diagnostics.map(({ from, to }) => source.slice(from, to))).toEqual([
      "::bibliography[all-long]{scope=project-long}  ",
      ":::unknown-container extra words",
      "::label[target-long]  ",
    ]);
  });

  it("renders exact fallback citation punctuation for several missing entries", () => {
    const rendered = render(':cite[missing-a, missing-b]{mode=full prefix="Prefix " suffix=" suffix" locator="p. 9"}', "");
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics.map(({ message }) => message)).toEqual(["Missing citation: missing-a", "Missing citation: missing-b"]);
    expect(html).toBe(
      '<p><span class="semantic-citation-group">Prefix <button type="button" class="semantic-citation" data-citation="missing-a" data-locator="p. 9" aria-label="Open reference missing-a">missing-a. n.d.. missing-a</button>; <button type="button" class="semantic-citation" data-citation="missing-b" data-locator="p. 9" aria-label="Open reference missing-b">missing-b. n.d.. missing-b</button>, p. 9 suffix</span></p>',
    );
  });

  it("accepts a level-one title before an unclosed comment", () => {
    const source = "# Document title\n\n::: comment";
    const rendered = render(source, "");

    expect(rendered.diagnostics).toEqual([
      { severity: "error", message: "Comment block is not closed", from: 18, to: source.length },
    ]);
    expect(withoutSourcePositions(rendered.html)).toContain("<h1>Document title</h1>");
  });

  it("renders a label on a non-heading block and rejects loose captions", () => {
    const source = `## Section
| Value |
| ---: |
| 42 |
::label[table:value]

:ref[table:value]{text="Custom label"}
::caption[Loose caption]`;
    const rendered = render(source, "");
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics.map(({ message }) => message)).toEqual(["::caption must be inside a :::figure container"]);
    expect(html).toContain('<span class="semantic-label" id="table:value"></span>');
    expect(html).toContain('<a class="semantic-reference" data-reference="table:value" href="#table:value">Custom label</a>');
    expect(html).toContain('<code class="native-figure-error">::caption[Loose caption]</code>');
  });

  it("normalizes uppercase semantic names and preserves unknown directive content", () => {
    const rendered = render(":CITEP[merton1942] and :UNKNOWN[Visible fallback]", bibliography);
    const html = withoutSourcePositions(rendered.html);

    expect(rendered.diagnostics.map(({ message }) => message)).toEqual(["Unsupported text directive: :unknown"]);
    expect(html.replaceAll(/<[^>]+>/gu, "")).toContain("(Merton, 1942)");
    expect(html).toContain("Visible fallback");
    expect(html).not.toContain("UNKNOWN");
  });
});

describe("bibliography helpers", () => {
  it("parses entries and produces stable slugs", () => {
    expect(parseBibliography(bibliography).get("merton1942")).toMatchObject({ year: "1942" });
    expect(slugify("  A Meaningful: Heading! ")).toBe("a-meaningful-heading");
    expect(slugify("  `Mixed`___ punctuation / and spaces  ")).toBe("mixed-punctuation-and-spaces");
    expect(slugify("`!`")).toBe("");
  });
});
