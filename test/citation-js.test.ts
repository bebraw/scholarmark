import { describe, expect, it } from "vitest";
import { parseBibliography } from "../src/citation-js";

describe("optional Citation.js adapter", () => {
  it("parses macros, TeX text, and extended CSL fields", () => {
    const [entry] = parseBibliography(String.raw`@string{venue = "Journal"}
      @book{display,
        title={{H}{T}{M}{L} {F}irst},
        author={Veps{\"a}l{\"a}inen},
        editor={Researcher, Rita},
        journal=venue,
        publisher={Evidence Press},
        address={Helsinki}
      }`);

    expect(entry).toMatchObject({
      id: "display",
      title: "HTML First",
      author: [{ family: "Vepsäläinen" }],
      editor: [{ family: "Researcher", given: "Rita" }],
      "container-title": "Journal",
      publisher: "Evidence Press",
      "publisher-place": "Helsinki",
    });
  });

  it("returns no records for empty or malformed input", () => {
    expect(parseBibliography("")).toEqual([]);
    expect(parseBibliography("@article{open, title={Never closes}")).toEqual([]);
  });
});
