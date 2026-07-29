import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import { isCitationData, type BibliographyParser, type CitationData } from "./bibliography.js";

/** Full BibTeX parser adapter backed by the optional Citation.js peer dependencies. */
export const parseBibliography: BibliographyParser = (source: string): CitationData[] => {
  if (!source.trim()) return [];
  try {
    return new Cite(source).data.filter(isCitationData);
  } catch {
    return [];
  }
};
