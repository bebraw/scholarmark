import { describe, expect, it } from "vitest";
import { analyzeScholarmark, isScholarmarkDocument, itemAtOffset } from "../src/language-service";
import { projectMarkdownSemantics } from "../src/markdown-comments";

const bibliography = `@article{doe2026,
  author={Doe, Jane},
  title={Methods},
  year={2026}
}`;

describe("Scholarmark language service", () => {
  it("collects editor features with exact source ranges", () => {
    const source = `# Study

## Methods
::label[sec:methods]

See :ref[sec:methods] and :cite[doe2026].

::: comment
Hidden :ref[missing].
:::

:::figure{kind="boxplot" version=1}
::box[A]{min=0 q1=1 median=2 q3=3 max=4}
::caption[Results]
:::
::label[fig:results]

::bibliography[]`;
    const analysis = analyzeScholarmark(source, bibliography);

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.comments).toEqual([{ from: source.indexOf("::: comment"), to: source.indexOf(":::\n\n:::figure") + 3 }]);
    expect(analysis.headings.map(({ depth, title }) => ({ depth, title }))).toEqual([
      { depth: 1, title: "Study" },
      { depth: 2, title: "Methods" },
    ]);
    expect(analysis.labels.map((label) => label.id)).toEqual(["sec:methods", "fig:results"]);
    expect(analysis.occurrences.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "reference", id: "sec:methods" },
      { kind: "citation", id: "doe2026" },
    ]);
    expect(analysis.figures).toHaveLength(1);
    expect(analysis.bibliography.get("doe2026")?.title).toBe("Methods");

    const referenceOffset = source.indexOf("sec:methods] and");
    expect(itemAtOffset(analysis, referenceOffset)).toMatchObject({ kind: "reference", id: "sec:methods" });
  });

  it("keeps frontmatter and fenced examples outside language semantics", () => {
    const source = `---
example: :ref[frontmatter]
---

\`\`\`markdown
::label[example]
:cite[missing]
\`\`\`

## Real
::label[real]

See :ref[real].`;
    const semantic = projectMarkdownSemantics(source);
    const analysis = analyzeScholarmark(source, bibliography);

    expect(semantic).not.toContain("frontmatter");
    expect(semantic).not.toContain("::label[example]");
    expect(analysis.labels.map((label) => label.id)).toEqual(["real"]);
    expect(analysis.occurrences.map((occurrence) => occurrence.id)).toEqual(["real"]);
    expect(analysis.diagnostics).toEqual([]);
  });

  it("returns diagnostics suitable for an editor", () => {
    const source = ":cite[missing] :ref[absent]";
    expect(analyzeScholarmark(source, bibliography).diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Missing citation: missing",
      "Missing label: absent",
    ]);
  });

  it("includes native figure diagnostics from the reference pipeline", () => {
    const source = `:::figure{kind="boxplot" version=1}
::box[Broken]{min=5 q1=4 median=3 q3=2 max=1}
::caption[Invalid]
:::`;
    expect(analyzeScholarmark(source).diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      "Box values must satisfy min <= q1 <= median <= q3 <= max",
    );
  });

  it("accepts a caption and label after a GFM table", () => {
    const source = `| Method | Result |
| --- | ---: |
| A | 42 |
::caption[Results by method.]
::label[table:results]

See :ref[table:results]{text="the results table"}.`;
    const analysis = analyzeScholarmark(source);

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.labels.map((label) => label.id)).toEqual(["table:results"]);
    expect(analysis.occurrences.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "reference", id: "table:results" },
    ]);
  });

  it("activates diagnostics only for documents using recognized syntax", () => {
    expect(isScholarmarkDocument("Ordinary Markdown with a value=assignment.")).toBe(false);
    expect(isScholarmarkDocument("```markdown\n:cite[example]\n```")).toBe(false);
    expect(isScholarmarkDocument("Evidence :cite[example].")).toBe(true);
    expect(isScholarmarkDocument("::: comment\nReview this.\n:::")).toBe(true);
  });
});
