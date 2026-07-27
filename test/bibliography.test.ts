import { describe, expect, it } from "vitest";
import { parseBibTeX } from "../src/bibliography";

describe("Citation.js BibTeX integration", () => {
  it("parses BibTeX into CSL-JSON records", () => {
    const [entry] = parseBibTeX(`@article{Merton1942,
      author = {Merton, Robert K. and Doe, Jane},
      title = {The {Normative} Structure of Science},
      year = 1942,
      journal = {Journal of Science},
      doi = {10.1000/example}
    }`);

    expect(entry).toMatchObject({
      id: "Merton1942",
      type: "article-journal",
      title: "The Normative Structure of Science",
      author: [
        { family: "Merton", given: "Robert K." },
        { family: "Doe", given: "Jane" },
      ],
      issued: { "date-parts": [[1942]] },
      "container-title": "Journal of Science",
      DOI: "10.1000/example",
    });
  });

  it("delegates BibTeX macros and TeX text decoding to Citation.js", () => {
    const [entry] = parseBibTeX(String.raw`@string{venue = "Journal"}
      @misc{display,
        title={{H}{T}{M}{L} {F}irst},
        author={Veps{\"a}l{\"a}inen},
        journal=venue
      }`);

    expect(entry).toMatchObject({
      id: "display",
      title: "HTML First",
      author: [{ family: "Vepsäläinen" }],
      "container-title": "Journal",
    });
  });

  it("preserves CSL fields for host formatters", () => {
    const [entry] = parseBibTeX(`@book{book2026,
      editor={Researcher, Rita},
      publisher={Evidence Press},
      address={Helsinki},
      title={Inspectable Evidence},
      year={2026}
    }`);

    expect(entry).toMatchObject({
      id: "book2026",
      editor: [{ family: "Researcher", given: "Rita" }],
      publisher: "Evidence Press",
      "publisher-place": "Helsinki",
      title: "Inspectable Evidence",
    });
  });

  it("returns an empty list for empty or malformed input", () => {
    expect(parseBibTeX("")).toEqual([]);
    expect(parseBibTeX("@article{open, title={Never closes}")).toEqual([]);
  });
});
