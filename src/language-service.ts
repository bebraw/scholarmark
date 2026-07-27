import { parseBibTeX, type CitationData } from "./bibliography.js";
import { projectMarkdownComments, projectMarkdownSemantics } from "./markdown-comments.js";
import { diagnose, type Diagnostic } from "./markdown.js";

export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface ScholarmarkHeading {
  readonly depth: number;
  readonly title: string;
  readonly range: SourceRange;
  readonly selectionRange: SourceRange;
}

export interface ScholarmarkLabel {
  readonly id: string;
  readonly range: SourceRange;
  readonly selectionRange: SourceRange;
}

export interface ScholarmarkOccurrence {
  readonly id: string;
  readonly kind: "citation" | "reference";
  readonly range: SourceRange;
  readonly selectionRange: SourceRange;
}

export interface ScholarmarkFigure {
  readonly range: SourceRange;
  readonly selectionRange: SourceRange;
}

export interface ScholarmarkAnalysis {
  readonly diagnostics: readonly Diagnostic[];
  readonly comments: readonly SourceRange[];
  readonly headings: readonly ScholarmarkHeading[];
  readonly labels: readonly ScholarmarkLabel[];
  readonly occurrences: readonly ScholarmarkOccurrence[];
  readonly figures: readonly ScholarmarkFigure[];
  readonly bibliography: ReadonlyMap<string, CitationData>;
}

const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gmu;
const labelPattern = /^::label\[([^\]\r\n]*)\][ \t]*$/gmu;
const textDirectivePattern = /(?<!:):(cite|citet|citep|ref)\[([^\]\r\n]*)\]/giu;
const figureOpeningPattern = /^[ \t]*:::figure\b[^\r\n]*(?:\r?\n|$)/gimu;
const containerClosingPattern = /^[ \t]*:::[ \t]*$/gmu;

export function isScholarmarkDocument(source: string): boolean {
  if (projectMarkdownComments(source).ranges.length > 0) return true;
  return /(?:^|\n)[ \t]*::(?:label|bibliography|box|caption)\[|(?:^|\n)[ \t]*:::[ \t]*figure\b|(?<!:):(?:cite|citet|citep|ref)\[/imu.test(
    projectMarkdownSemantics(source),
  );
}

export function analyzeScholarmark(source: string, bibliographySource = ""): ScholarmarkAnalysis {
  const semanticSource = projectMarkdownSemantics(source);
  const comments = projectMarkdownComments(source).ranges;
  const headings = [...semanticSource.matchAll(headingPattern)].map((match) => {
    const from = match.index ?? 0;
    const marks = match[1] ?? "#";
    const title = match[2] ?? "";
    const titleFrom = from + match[0].indexOf(title);
    return {
      depth: marks.length,
      title,
      range: { from, to: from + match[0].length },
      selectionRange: { from: titleFrom, to: titleFrom + title.length },
    };
  });
  const labels = [...semanticSource.matchAll(labelPattern)].map((match) => {
    const from = match.index ?? 0;
    const id = match[1]?.trim() ?? "";
    const idFrom = from + match[0].indexOf(match[1] ?? "");
    return {
      id,
      range: { from, to: from + match[0].length },
      selectionRange: { from: idFrom, to: idFrom + (match[1]?.length ?? 0) },
    };
  });
  const occurrences: ScholarmarkOccurrence[] = [];
  for (const match of semanticSource.matchAll(textDirectivePattern)) {
    const kind = match[1]?.toLowerCase() === "ref" ? "reference" : "citation";
    const content = match[2] ?? "";
    const contentFrom = (match.index ?? 0) + match[0].indexOf(content);
    for (const item of commaSeparatedItems(content, contentFrom)) {
      occurrences.push({ id: item.value, kind, range: item.range, selectionRange: item.range });
    }
  }
  return {
    diagnostics: diagnose(source, bibliographySource),
    comments,
    headings,
    labels,
    occurrences,
    figures: collectFigures(semanticSource),
    bibliography: new Map(parseBibTeX(bibliographySource).map((entry) => [entry.id, entry])),
  };
}

export function itemAtOffset(analysis: ScholarmarkAnalysis, offset: number): ScholarmarkLabel | ScholarmarkOccurrence | undefined {
  return [...analysis.labels, ...analysis.occurrences].find(
    (item) => offset >= item.selectionRange.from && offset <= item.selectionRange.to,
  );
}

function commaSeparatedItems(value: string, baseOffset: number): Array<{ value: string; range: SourceRange }> {
  const items: Array<{ value: string; range: SourceRange }> = [];
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index !== value.length && value[index] !== ",") continue;
    const raw = value.slice(start, index);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) {
      const from = baseOffset + start + leading;
      items.push({ value: trimmed, range: { from, to: from + trimmed.length } });
    }
    start = index + 1;
  }
  return items;
}

function collectFigures(source: string): ScholarmarkFigure[] {
  const figures: ScholarmarkFigure[] = [];
  for (const opening of source.matchAll(figureOpeningPattern)) {
    const from = opening.index ?? 0;
    containerClosingPattern.lastIndex = from + opening[0].length;
    const closing = containerClosingPattern.exec(source);
    const to = closing ? (closing.index ?? from) + closing[0].length : from + opening[0].length;
    figures.push({
      range: { from, to },
      selectionRange: { from, to: from + opening[0].trimEnd().length },
    });
  }
  return figures;
}
