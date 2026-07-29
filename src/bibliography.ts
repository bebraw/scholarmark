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

/** Bibliography input accepted by renderers: BibTeX text or already parsed CSL-JSON. */
export type BibliographyInput = string | readonly CitationData[];

/** A synchronous host-provided parser, such as the `scholarmark/citation-js` adapter. */
export type BibliographyParser = (source: string) => readonly CitationData[];

const cslTypes: Readonly<Record<string, string>> = {
  article: "article-journal",
  book: "book",
  inbook: "chapter",
  incollection: "chapter",
  inproceedings: "paper-conference",
  manual: "book",
  mastersthesis: "thesis",
  misc: "article",
  phdthesis: "thesis",
  proceedings: "book",
  techreport: "report",
  unpublished: "manuscript",
};

/**
 * Parse the bounded BibTeX profile used by the browser renderer.
 *
 * It supports citation keys plus author, title, and year fields with braced,
 * quoted, or bare values. Install `scholarmark/citation-js` for full BibTeX.
 */
export function parseBibTeX(source: string): CitationData[] {
  const entries: CitationData[] = [];
  let cursor = 0;
  try {
    while (cursor < source.length) {
      const at = source.indexOf("@", cursor);
      if (at < 0) break;
      cursor = at + 1;
      const typeMatch = /^[a-z]+/iu.exec(source.slice(cursor));
      if (!typeMatch) continue;
      const bibType = typeMatch[0].toLocaleLowerCase();
      cursor += typeMatch[0].length;
      cursor = skipWhitespace(source, cursor);
      const opening = source[cursor];
      if (opening !== "{" && opening !== "(") continue;
      const closing = opening === "{" ? "}" : ")";
      const body = readDelimited(source, cursor, opening, closing);
      cursor = body.next;
      if (bibType === "string" || bibType === "comment" || bibType === "preamble") continue;
      const comma = findTopLevelComma(body.value);
      if (comma < 0) continue;
      const id = body.value.slice(0, comma).trim();
      if (!id) continue;
      const fields = parseFields(body.value.slice(comma + 1));
      const title = cleanBibTeXText(fields.get("title") ?? "");
      const year = cleanBibTeXText(fields.get("year") ?? "");
      const author = parseAuthors(fields.get("author") ?? "");
      entries.push({
        id,
        type: cslTypes[bibType] ?? bibType,
        ...(title ? { title } : {}),
        ...(author.length > 0 ? { author } : {}),
        ...(year ? { issued: { "date-parts": [[/^\d+$/u.test(year) ? Number(year) : year]] } } : {}),
      });
    }
    return entries;
  } catch {
    return [];
  }
}

export function isCitationData(value: unknown): value is CitationData {
  if (!value || typeof value !== "object") return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0;
}

function parseFields(source: string): Map<string, string> {
  const fields = new Map<string, string>();
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipSeparators(source, cursor);
    if (cursor >= source.length) break;
    const nameMatch = /^[a-z][a-z0-9_-]*/iu.exec(source.slice(cursor));
    if (!nameMatch) throw new Error("Invalid BibTeX field");
    const name = nameMatch[0].toLocaleLowerCase();
    cursor = skipWhitespace(source, cursor + nameMatch[0].length);
    if (source[cursor] !== "=") throw new Error("Invalid BibTeX assignment");
    cursor = skipWhitespace(source, cursor + 1);
    const value = readValue(source, cursor);
    fields.set(name, value.value);
    cursor = value.next;
  }
  return fields;
}

function readValue(source: string, cursor: number): { value: string; next: number } {
  const opening = source[cursor];
  if (opening === "{") return readDelimited(source, cursor, "{", "}");
  if (opening === '"') return readQuoted(source, cursor);
  let end = cursor;
  while (end < source.length && source[end] !== ",") end += 1;
  const value = source.slice(cursor, end).trim();
  if (!value) throw new Error("Empty BibTeX value");
  return { value, next: end };
}

function readDelimited(source: string, cursor: number, opening: string, closing: string): { value: string; next: number } {
  let depth = 0;
  for (let index = cursor; index < source.length; index += 1) {
    const character = source[index];
    if (character === opening) depth += 1;
    if (character !== closing) continue;
    depth -= 1;
    if (depth === 0) return { value: source.slice(cursor + 1, index), next: index + 1 };
  }
  throw new Error("Unclosed BibTeX value");
}

function readQuoted(source: string, cursor: number): { value: string; next: number } {
  for (let index = cursor + 1; index < source.length; index += 1) {
    if (source[index] === '"' && source[index - 1] !== "\\") {
      return { value: source.slice(cursor + 1, index), next: index + 1 };
    }
  }
  throw new Error("Unclosed BibTeX value");
}

function findTopLevelComma(source: string): number {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && source[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "," && depth === 0) return index;
  }
  return -1;
}

function parseAuthors(value: string): CitationAuthor[] {
  return splitAuthors(value).map((rawAuthor) => {
    const author = rawAuthor.trim();
    if (author.startsWith("{") && author.endsWith("}")) return { literal: cleanBibTeXText(author) };
    const comma = author.indexOf(",");
    if (comma >= 0) {
      const family = cleanBibTeXText(author.slice(0, comma));
      const given = cleanBibTeXText(author.slice(comma + 1));
      return { ...(family ? { family } : {}), ...(given ? { given } : {}) };
    }
    const parts = cleanBibTeXText(author).split(/\s+/u).filter(Boolean);
    const family = parts.pop() ?? "";
    const given = parts.join(" ");
    return { ...(family ? { family } : {}), ...(given ? { given } : {}) };
  });
}

function splitAuthors(value: string): string[] {
  const authors: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    if (depth === 0 && value.slice(index, index + 5).toLocaleLowerCase() === " and ") {
      authors.push(value.slice(start, index));
      start = index + 5;
      index += 4;
    } else if (index === value.length) {
      authors.push(value.slice(start));
    }
  }
  return authors.map((author) => author.trim()).filter(Boolean);
}

function cleanBibTeXText(value: string): string {
  let cleaned = value.trim();
  while (cleaned.startsWith("{") && cleaned.endsWith("}") && enclosesWholeValue(cleaned)) cleaned = cleaned.slice(1, -1).trim();
  return cleaned.replaceAll(/[{}]/gu, "").replaceAll(/\\([{}%&#_$])/gu, "$1").trim();
}

function enclosesWholeValue(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    else if (value[index] === "}") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function skipWhitespace(source: string, cursor: number): number {
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function skipSeparators(source: string, cursor: number): number {
  while (source[cursor] === "," || /\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}
