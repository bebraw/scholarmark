import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";

export interface CitationAuthor {
  readonly family?: string;
  readonly given?: string;
  readonly literal?: string;
}

export interface CitationDate {
  readonly "date-parts"?: readonly (readonly (number | string)[])[];
  readonly literal?: string;
  readonly raw?: string;
}

/** The CSL-JSON subset used by Scholarmark. Other CSL fields remain available by name. */
export interface CitationData {
  readonly id: string;
  readonly type?: string;
  readonly title?: string;
  readonly author?: readonly CitationAuthor[];
  readonly issued?: CitationDate;
  readonly [field: string]: unknown;
}

/** Parse BibTeX into CSL-JSON using Citation.js. Invalid input produces no records. */
export function parseBibTeX(source: string): CitationData[] {
  if (!source.trim()) return [];
  try {
    return new Cite(source).data.filter(isCitationData);
  } catch {
    return [];
  }
}

function isCitationData(value: unknown): value is CitationData {
  if (!value || typeof value !== "object") return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0;
}
