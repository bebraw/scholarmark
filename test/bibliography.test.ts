import { describe, expect, it } from "vitest";
import { parseBibTeX } from "../src/bibliography";

describe("lightweight BibTeX parser", () => {
  it("parses the bounded browser fields into CSL-JSON records", () => {
    const [entry] = parseBibTeX(`@article{Merton1942,
      author = {Merton, Robert K. and Doe, Jane},
      title = {The {Normative} Structure of Science},
      year = 1942,
      journal = {Journal of Science}
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
    });
  });

  it("supports quoted, braced, and bare values across multiple entries", () => {
    const entries = parseBibTeX(`@misc{display,
        title="HTML First",
        author={Research Collective},
        year=2025
      }
      @book{organization, title={{A} {Braced} Title}, author={{Open Research Group}}, year={forthcoming}}`);

    expect(entries[0]).toMatchObject({
      id: "display",
      title: "HTML First",
      author: [{ family: "Collective", given: "Research" }],
      issued: { "date-parts": [[2025]] },
    });
    expect(entries[1]).toMatchObject({
      id: "organization",
      title: "A Braced Title",
      author: [{ literal: "Open Research Group" }],
      issued: { "date-parts": [["forthcoming"]] },
    });
  });

  it("returns an empty list for empty or malformed input", () => {
    expect(parseBibTeX("")).toEqual([]);
    expect(parseBibTeX("@article{open, title={Never closes}")).toEqual([]);
  });
});
