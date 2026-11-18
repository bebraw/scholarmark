import { expect, it } from "vitest";
import { renderTreeSync, toHtml } from "../src/index";

it("lets a print host open a disclosure without reparsing its scholarly content", () => {
  const body = "Compare :ref[sec:method] with :cite[doe2026].";
  const source = [
    "## Method\n::label[sec:method]",
    `:::details[Supporting evidence]\n${body}\n:::`,
  ].join("\n\n");
  const { tree, diagnostics } = renderTreeSync(source, [
    { id: "doe2026", author: [{ family: "Doe" }], issued: { "date-parts": [[2026]] } },
  ]);

  expect(diagnostics).toEqual([]);
  const disclosure = tree.children.find((node) => node.type === "element" && node.tagName === "details");
  if (disclosure?.type !== "element") throw new Error("Missing disclosure in publication tree");
  const paragraph = disclosure.children.find((node) => node.type === "element" && node.tagName === "p");
  if (paragraph?.type !== "element") throw new Error("Missing disclosure body");
  expect(source.slice(Number(paragraph.properties.dataSourceFrom), Number(paragraph.properties.dataSourceTo))).toBe(body);

  // A static publication keeps the same title, link and formatted citation, opening only the native element.
  disclosure.properties.open = true;
  const html = toHtml({ type: "root", children: [disclosure] });
  expect(html).toMatch(/<details\b[^>]*\bopen\b[^>]*>/u);
  expect(html).toMatch(/<summary\b[^>]*>Supporting evidence<\/summary>/u);
  expect(html).toMatch(/href="#sec:method"[^>]*>1 Method<\/a>/u);
  expect(html).toContain(">Doe, 2026</button>");
});
