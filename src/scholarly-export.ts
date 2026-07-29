import {
  isCitationData,
  parseBibTeX,
  type BibliographyInput,
  type BibliographyParser,
  type CitationAuthor,
  type CitationData,
} from "./bibliography.js";
import type { CitationStyle } from "./types.js";

export interface PublicationTextDirective {
  readonly kind: "cite" | "ref";
  readonly content: string;
  readonly attributes: ReadonlyMap<string, string>;
}

export interface PublicationCitationEntry {
  readonly id: string;
  readonly authors: readonly CitationAuthor[];
  readonly title: string;
  readonly year: string;
  readonly number: number;
  /** The CSL-JSON record, available to custom and CSL formatters. */
  readonly data: CitationData;
}

export interface CitationFormatContext {
  readonly locator?: string;
  readonly mode: string;
  readonly number: number;
  readonly style: CitationStyle;
}

export interface BibliographyFormatContext {
  readonly number: number;
  readonly style: CitationStyle;
}

/** A text-only formatting boundary. Hosts may implement it with a separately installed CSL processor. */
export interface CitationFormatter {
  formatCitation(entry: PublicationCitationEntry, context: CitationFormatContext): string | PromiseLike<string>;
  formatBibliography(entry: PublicationCitationEntry, context: BibliographyFormatContext): string | PromiseLike<string>;
}

export interface SyncCitationFormatter extends CitationFormatter {
  formatCitation(entry: PublicationCitationEntry, context: CitationFormatContext): string;
  formatBibliography(entry: PublicationCitationEntry, context: BibliographyFormatContext): string;
}

export type CitationDirectiveName = "cite" | "citet" | "citep";

const textDirective = /(?<!:):(?<kind>cite|citet|citep|ref)\[(?<content>[^\]\r\n]*)\](?:\{(?<attributes>[^}\r\n]*)\})?/giu;
const declaration = /^[ \t]*::label\[(?<id>[a-zA-Z0-9:_-]+)\][ \t]*$/u;
const bibliographyDirective = /^[ \t]*::bibliography\[\][ \t]*$/iu;
const attribute = /(?<name>[a-z][a-z-]*)=(?:"(?<quoted>[^"]*)"|(?<bare>[^\s}]+))/giu;
const heading = /^(?<marks>#{1,6})[ \t]+(?<title>.+?)[ \t]*$/u;

export function replacePublicationTextDirectives(value: string, replacement: (directive: PublicationTextDirective) => string): string {
  return value.replace(textDirective, (_match, ...values: unknown[]) => {
    const groups = values.at(-1);
    if (!isStringRecord(groups) || !groups.kind) return "";
    const name = groups.kind.toLocaleLowerCase();
    if (name !== "ref" && !isCitationDirectiveName(name)) return "";
    const attributes = new Map(directiveAttributes(groups.attributes ?? ""));
    if (name !== "ref" && name !== "cite" && !attributes.has("mode")) attributes.set("mode", citationModeForDirective(name));
    return replacement({
      kind: name === "ref" ? "ref" : "cite",
      content: (groups.content ?? "").trim(),
      attributes,
    });
  });
}

export function isCitationDirectiveName(value: string): value is CitationDirectiveName {
  return value === "cite" || value === "citet" || value === "citep";
}

export function citationModeForDirective(name: CitationDirectiveName, explicitMode?: string): string {
  return explicitMode ?? (name === "citet" ? "textual" : "parenthetical");
}

export function isPublicationReferenceDeclaration(line: string): boolean {
  return declaration.test(line);
}

export function isPublicationBibliographyDirective(line: string): boolean {
  return bibliographyDirective.test(line);
}

export function publicationReferenceLabels(markdown: string): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const lines = markdown.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const id = declaration.exec(line)?.groups?.id;
    if (!id) continue;
    let previousBlock: string | undefined;
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      if (!lines[previousIndex]?.trim()) continue;
      previousBlock = lines[previousIndex];
      break;
    }
    const headingTitle = previousBlock ? heading.exec(previousBlock)?.groups?.title : undefined;
    labels.set(id, headingTitle ? plainInlineText(headingTitle) : id);
  }
  return labels;
}

export function publicationReferenceLabel(directive: PublicationTextDirective, references: ReadonlyMap<string, string>): string {
  const target = directive.content;
  const customText = directive.attributes.get("text") ?? "";
  return plainInlineText(customText || references.get(target) || target);
}

export function publicationCitationEntries(
  bibliography: BibliographyInput,
  parseBibliography: BibliographyParser = parseBibTeX,
): ReadonlyMap<string, PublicationCitationEntry> {
  const records = typeof bibliography === "string" ? parseBibliography(bibliography) : bibliography.filter(isCitationData);
  return new Map(
    records.map((entry, index) => [
      entry.id,
      {
        id: entry.id,
        authors: entry.author ?? [],
        title: stringField(entry.title),
        year: citationYear(entry),
        number: index + 1,
        data: entry,
      },
    ]),
  );
}

export function publicationCitationText(
  directive: PublicationTextDirective,
  bibliography: ReadonlyMap<string, PublicationCitationEntry>,
  citationStyle: CitationStyle,
  formatter: SyncCitationFormatter = defaultCitationFormatter,
): string {
  const mode = directive.attributes.get("mode") ?? "parenthetical";
  const locator = directive.attributes.get("locator");
  const entries = directive.content
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => bibliography.get(id) ?? missingCitationEntry(id));
  const separator = citationStyle === "ieee" || mode === "textual" ? ", " : "; ";
  const value = entries
    .map((entry) =>
      formatter.formatCitation(entry, { mode, number: entry.number, style: citationStyle, ...(locator ? { locator } : {}) }),
    )
    .join(separator);
  const wrapped = mode === "parenthetical" ? (citationStyle === "ieee" ? `[${value}]` : `(${value})`) : value;
  return `${directive.attributes.get("prefix") ?? ""}${wrapped}${locator ? `, ${locator}` : ""}${directive.attributes.get("suffix") ?? ""}`;
}

export function publicationBibliographyText(
  entry: PublicationCitationEntry,
  citationStyle: CitationStyle,
  formatter: SyncCitationFormatter = defaultCitationFormatter,
): string {
  return formatter.formatBibliography(entry, { number: entry.number, style: citationStyle });
}

export function publicationCitationAuthorLabel(entry: Pick<PublicationCitationEntry, "authors" | "id">): string {
  const authors = entry.authors.map(citationFamilyName).filter(Boolean);
  const [first, second] = authors;
  if (!first) return entry.id;
  if (!second) return first;
  if (authors.length === 2) return `${first} and ${second}`;
  return `${first} et al.`;
}

function directiveAttributes(value: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of value.matchAll(attribute)) {
    const name = match.groups?.name?.toLocaleLowerCase();
    if (name) attributes.set(name, match.groups?.quoted ?? match.groups?.bare ?? "");
  }
  return attributes;
}

function plainInlineText(value: string): string {
  return value.replace(/[*_`~]/gu, "").trim();
}

export const defaultCitationFormatter: SyncCitationFormatter = {
  formatCitation(entry, { mode, number, style }) {
    const author = publicationCitationAuthorLabel(entry);
    if (style === "ieee") return mode === "textual" ? `${author} [${number || entry.id}]` : String(number || entry.id);
    if (mode === "full") return [author, entry.year, entry.title].filter(Boolean).join(". ");
    if (mode === "textual") return `${author} (${entry.year || "n.d."})`;
    return style === "chicago-author-date" ? `${author} ${entry.year || "n.d."}` : `${author}, ${entry.year || "n.d."}`;
  },
  formatBibliography(entry, { number, style }) {
    const author = entry.authors.map(citationAuthorName).filter(Boolean).join(" and ") || entry.id;
    const title = entry.title.trim() || entry.id;
    const year = entry.year.trim() || "n.d.";
    if (style === "ieee") return `[${number}] ${author}, “${title},” ${year}.`;
    if (style === "chicago-author-date") return `${author}. ${year}. ${title}.`;
    return `${author} (${year}). ${title}.`;
  },
};

function citationFamilyName(author: CitationAuthor): string {
  return author.family?.trim() || author.literal?.trim() || author.given?.trim() || "";
}

function citationAuthorName(author: CitationAuthor): string {
  if (author.literal) return author.literal.trim();
  const family = author.family?.trim() ?? "";
  const given = author.given?.trim() ?? "";
  return family && given ? `${family}, ${given}` : family || given;
}

function citationYear(entry: CitationData): string {
  const datePart = entry.issued?.["date-parts"]?.[0]?.[0];
  if (datePart !== undefined) return String(datePart);
  return entry.issued?.literal?.trim() || entry.issued?.raw?.trim() || "";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function missingCitationEntry(id: string): PublicationCitationEntry {
  return { id, authors: [{ literal: id }], title: id, year: "n.d.", number: 0, data: { id } };
}

function isStringRecord(value: unknown): value is Record<string, string | undefined> {
  return typeof value === "object" && value !== null;
}
