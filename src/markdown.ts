import type { Element as HastElement, ElementContent as HastElementContent, Root as HastRoot, RootContent as HastRootContent } from "hast";
import type { Schema } from "hast-util-sanitize";
import type { Directives } from "mdast-util-directive";
import type { Heading, Html, Root as MdastRoot, RootContent as MdastRootContent } from "mdast";
import type { Node, Parent } from "unist";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import {
  citationModeForDirective,
  defaultCitationFormatter,
  isCitationDirectiveName,
  publicationCitationEntries,
  type CitationFormatter,
  type PublicationCitationEntry,
  type SyncCitationFormatter,
} from "./scholarly-export.js";
import type { CitationStyle } from "./types.js";
import { projectMarkdownComments, projectMarkdownSemantics, type MarkdownCommentRange } from "./markdown-comments.js";
import { parseNativeFigure, renderNativeFigure } from "./native-figures.js";

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  from: number;
  to: number;
}

type BibliographyEntry = PublicationCitationEntry;

interface ReferenceEntry {
  title: string;
  href: string;
}

interface Citation {
  ids: string[];
  mode: string;
  locator?: string;
  prefix?: string;
  suffix?: string;
}

export interface RenderedDocument {
  html: string;
  diagnostics: Diagnostic[];
  headings: RenderedHeading[];
  references: RenderedReferenceTarget[];
}

export interface RenderedTreeDocument {
  tree: HastRoot;
  diagnostics: Diagnostic[];
  headings: RenderedHeading[];
  references: RenderedReferenceTarget[];
}

export interface RenderedHeading {
  depth: 2 | 3;
  id: string;
  title: string;
  number: string;
  from: number;
  to: number;
}

export interface RenderedReferenceTarget {
  readonly label: string;
  readonly title: string;
  readonly fragment: string;
  readonly from: number;
  readonly to: number;
}

export type HeadingNumbers = Readonly<Record<number, string>>;

export interface ReferenceTarget {
  /** Default visible text when a reference does not provide custom text. */
  readonly title: string;
  /** Complete destination, including an optional path and fragment. */
  readonly href: string;
}

export interface DiagnoseOptions {
  readonly referenceTargets?: ReadonlyMap<string, ReferenceTarget>;
}

export interface MarkdownRenderOptions {
  readonly headingNumbers?: HeadingNumbers;
  /** Override citation and bibliography text formatting, for example with a host-installed CSL processor. */
  readonly citationFormatter?: CitationFormatter;
  /** Publication-wide reference targets. These take precedence over labels declared in the current document. */
  readonly referenceTargets?: ReadonlyMap<string, ReferenceTarget>;
}

export interface SyncMarkdownRenderOptions extends Omit<MarkdownRenderOptions, "citationFormatter"> {
  readonly citationFormatter?: SyncCitationFormatter;
}

/** Validate a document using the same syntax and native-figure rules as rendering. */
export function diagnose(source: string, bibliographySource = "", options: DiagnoseOptions = {}): Diagnostic[] {
  const prepared = prepareRender(source, bibliographySource, options.referenceTargets);
  return [...prepared.diagnostics, ...validateNativeFigureSyntax(projectMarkdownSemantics(prepared.normalized))].sort(
    (left, right) => left.from - right.from,
  );
}

// Stryker disable Regex: unified owns Markdown parsing; these expressions only locate the small semantic-directive validation surface.
const directivePattern = /(?<!:):([a-z][a-z-]*)\[([^\]]*)\](?:\{([^}]*)\})?/giu;
const attributePattern = /([a-z][a-z-]*)=(?:"([^"]*)"|([^\s}]+))/giu;
const labelPattern = /^::label\[([^\]\r\n]*)\][ \t]*$/gmu;
const safeTableAlignmentPattern = /^text-align: (?:center|left|right)$/u;

// Stryker disable all: The static sanitizer vocabulary is covered by the complete rendered-output test; static mutants cannot isolate its module initialization reliably.
const safeElements = [
  "a",
  "b",
  "blockquote",
  "br",
  "button",
  "caption",
  "code",
  "del",
  "em",
  "figcaption",
  "figure",
  "g",
  "h1",
  "h2",
  "h3",
  "h5",
  "h6",
  "hr",
  "img",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "svg",
  "span",
  "strong",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "title",
  "ul",
  "line",
  "rect",
  "text",
];

const previewSchema: Schema = {
  tagNames: safeElements,
  attributes: {
    "*": ["dataSourceFrom", "dataSourceTo"],
    a: [
      "ariaDescribedBy",
      "ariaLabel",
      "className",
      "dataFootnoteBackref",
      "dataFootnoteRef",
      "dataReference",
      "href",
      "id",
      "title",
    ],
    button: ["ariaLabel", "className", "dataCitation", "dataLocator", ["type", "button"]],
    caption: ["className"],
    code: ["className"],
    figure: ["className", "id"],
    figcaption: ["className"],
    h1: ["className", "id"],
    h2: ["className", "id"],
    h3: ["className", "id"],
    h5: ["className", "id"],
    h6: ["className", "id"],
    img: ["alt", "src", "title"],
    input: ["checked", "disabled", ["type", "checkbox"]],
    li: ["className", "id"],
    ol: ["className", "start"],
    pre: ["className"],
    section: ["className", "dataFootnotes"],
    svg: ["ariaLabelledBy", "className", "role", "viewBox"],
    line: ["className", "x1", "x2", "y1", "y2"],
    rect: ["className", "height", "width", "x", "y"],
    text: ["className", "id", "x", "y"],
    title: ["id"],
    span: ["ariaLabel", "className", "dataCitation", "id"],
    td: [["style", safeTableAlignmentPattern]],
    th: [["style", safeTableAlignmentPattern]],
    ul: ["className"],
  },
  clobber: [],
  clobberPrefix: "",
  protocols: { href: ["http", "https", "mailto"], src: ["http", "https"] },
  required: { input: { disabled: true, type: "checkbox" } },
};
// Stryker restore all

export async function render(
  source: string,
  bibliographySource: string,
  citationStyle: CitationStyle = "apa",
  options: MarkdownRenderOptions = {},
): Promise<RenderedDocument> {
  const rendered = await renderTree(source, bibliographySource, citationStyle, options);
  return {
    html: toHtml(rendered.tree),
    diagnostics: rendered.diagnostics,
    headings: rendered.headings,
    references: rendered.references,
  };
}

/** Render synchronously when every configured formatter and transform is synchronous. */
export function renderSync(
  source: string,
  bibliographySource: string,
  citationStyle: CitationStyle = "apa",
  options: SyncMarkdownRenderOptions = {},
): RenderedDocument {
  const rendered = renderTreeSync(source, bibliographySource, citationStyle, options);
  return {
    html: toHtml(rendered.tree),
    diagnostics: rendered.diagnostics,
    headings: rendered.headings,
    references: rendered.references,
  };
}

/** Return sanitized HAST for trusted host-side transformations. */
export async function renderTree(
  source: string,
  bibliographySource: string,
  citationStyle: CitationStyle = "apa",
  options: MarkdownRenderOptions = {},
): Promise<RenderedTreeDocument> {
  const prepared = prepareRender(source, bibliographySource, options.referenceTargets, options.headingNumbers);
  const headings: RenderedHeading[] = [];
  try {
    const processor = markdownProcessor(prepared, citationStyle, options, headings);
    const tree = (await processor.run(processor.parse(prepared.normalized), prepared.normalized)) as HastRoot;
    return completeTreeRender(prepared, tree, headings);
  } catch (error) {
    return failedTreeRender(prepared, error);
  }
}

/** Return sanitized HAST synchronously when every configured transform is synchronous. */
export function renderTreeSync(
  source: string,
  bibliographySource: string,
  citationStyle: CitationStyle = "apa",
  options: SyncMarkdownRenderOptions = {},
): RenderedTreeDocument {
  const prepared = prepareRender(source, bibliographySource, options.referenceTargets, options.headingNumbers);
  const headings: RenderedHeading[] = [];
  try {
    const processor = markdownProcessor(prepared, citationStyle, options, headings);
    const tree = processor.runSync(processor.parse(prepared.normalized), prepared.normalized) as HastRoot;
    return completeTreeRender(prepared, tree, headings);
  } catch (error) {
    return failedTreeRender(prepared, error);
  }
}

/** Serialize a HAST tree, including trusted nodes added by a host after rendering. */
export function toHtml(tree: HastRoot): string {
  return String(unified().use(rehypeStringify).stringify(tree));
}

interface PreparedRender {
  readonly normalized: string;
  readonly bibliography: Map<string, BibliographyEntry>;
  readonly citedIds: ReadonlySet<string>;
  readonly references: Map<string, ReferenceEntry>;
  readonly localReferences: LocalReferenceEntry[];
  readonly diagnostics: Diagnostic[];
}

interface LocalReferenceEntry extends ReferenceEntry {
  readonly label: string;
  readonly fragment: string;
  readonly from: number;
  readonly to: number;
  readonly attachedFrom: number;
}

function prepareRender(
  source: string,
  bibliographySource: string,
  referenceTargets: ReadonlyMap<string, ReferenceTarget> = new Map(),
  headingNumbers: HeadingNumbers = {},
): PreparedRender {
  const normalized = source.replaceAll("\r\n", "\n");
  const comments = projectMarkdownComments(normalized);
  const semanticSource = projectMarkdownSemantics(normalized);
  const bibliography = parseBibliography(bibliographySource);
  const citedIds = collectCitationIds(semanticSource);
  const { references, localReferences } = collectReferences(semanticSource, headingNumbers);
  for (const [label, target] of referenceTargets) references.set(label, target);
  const diagnostics = [
    ...(comments.unclosedFrom === null
      ? []
      : [
          {
            severity: "error" as const,
            message: "Comment block is not closed",
            from: comments.unclosedFrom,
            to: normalized.indexOf("\n", comments.unclosedFrom) < 0 ? normalized.length : normalized.indexOf("\n", comments.unclosedFrom),
          },
        ]),
    ...validateSyntax(semanticSource, bibliography, references),
  ];
  return { normalized, bibliography, citedIds, references, localReferences, diagnostics };
}

function markdownProcessor(
  prepared: PreparedRender,
  citationStyle: CitationStyle,
  options: MarkdownRenderOptions,
  headings: RenderedHeading[],
) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkDirective)
    .use(removeMarkdownComments)
    .use(escapeAuthoredHtml)
    .use(renderSemanticDirectives, {
      bibliography: prepared.bibliography,
      citedIds: prepared.citedIds,
      references: prepared.references,
      citationStyle,
      citationFormatter: options.citationFormatter ?? defaultCitationFormatter,
      diagnostics: prepared.diagnostics,
    })
    .use(remarkRehype)
    .use(attachTableCaptions)
    .use(annotatePreviewSourcePositions)
    .use(renderNumberedHeadings, { headingNumbers: options.headingNumbers, headings })
    .use(normalizeTableAlignment)
    .use(rehypeSanitize, previewSchema);
}

function completeTreeRender(prepared: PreparedRender, tree: HastRoot, headings: RenderedHeading[]): RenderedTreeDocument {
  return {
    tree,
    diagnostics: prepared.diagnostics.sort((left, right) => left.from - right.from),
    headings,
    references: renderedReferenceTargets(prepared.localReferences, headings),
  };
}

function failedTreeRender(prepared: PreparedRender, error: unknown): RenderedTreeDocument {
  return {
    tree: {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: {},
              children: [{ type: "text", value: prepared.normalized }],
            },
          ],
        },
      ],
    },
    diagnostics: [
      ...prepared.diagnostics,
      {
        severity: "error",
        message: error instanceof Error ? error.message : "The Markdown renderer could not parse this document",
        from: 0,
        to: prepared.normalized.length,
      },
    ],
    headings: [],
    references: [],
  };
}

export function headingNumbersByOffset(source: string): HeadingNumbers {
  const normalized = source.replaceAll("\r\n", "\n");
  const masked = projectMarkdownComments(normalized).masked;
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml", "toml"]).use(remarkDirective).parse(masked);
  const counters = { h2: 0, h3: 0 };
  const numbers: Record<number, string> = {};
  visit(tree, "heading", (node: Heading) => {
    if (node.depth !== 2 && node.depth !== 3) return;
    const offset = node.position?.start.offset;
    if (offset === undefined) return;
    numbers[offset] = getHeadingNumber(`h${node.depth}`, counters);
  });
  return numbers;
}

function annotatePreviewSourcePositions() {
  return (tree: HastRoot): void => {
    visit(tree, "element", (node: HastElement) => {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from === undefined || to === undefined || to <= from) return;
      node.properties.dataSourceFrom = String(from);
      node.properties.dataSourceTo = String(to);
    });
  };
}

function removeMarkdownComments() {
  return (tree: MdastRoot, file: { value: unknown }): void => {
    const source = String(file.value);
    pruneCommentChildren(tree, projectMarkdownComments(source).ranges, source);
  };
}

function pruneCommentChildren(parent: Parent, ranges: readonly MarkdownCommentRange[], source: string): void {
  parent.children = parent.children.flatMap((child) => pruneCommentNode(child, ranges, source));
}

function pruneCommentNode(node: Node, ranges: readonly MarkdownCommentRange[], source: string): Node[] {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from === undefined || to === undefined) return [node];
  if (ranges.some((range) => from >= range.from && to <= range.to)) return [];
  const overlapping = ranges.filter((range) => range.from < to && range.to > from);
  if (overlapping.length === 0) return [node];
  if (isParent(node)) {
    pruneCommentChildren(node, overlapping, source);
    return node.children.length > 0 ? [node] : [];
  }
  if (!isValueNode(node) || source.slice(from, to) !== node.value) return [];
  let cursor = from;
  const visible: string[] = [];
  for (const range of overlapping) {
    if (range.from > cursor) visible.push(source.slice(cursor, Math.min(range.from, to)));
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < to) visible.push(source.slice(cursor, to));
  node.value = visible.join("");
  return node.value ? [node] : [];
}

function isParent(node: Node): node is Parent {
  return "children" in node && Array.isArray(node.children);
}

function isValueNode(node: Node): node is Node & { value: string } {
  return "value" in node && typeof node.value === "string";
}

export function parseBibliography(source: string): Map<string, BibliographyEntry> {
  return new Map(publicationCitationEntries(source));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("`", "")
    .trim()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

function escapeAuthoredHtml() {
  return (tree: MdastRoot): void => {
    visit(tree, "html", (node: Html, index, parent) => {
      if (index === undefined || !parent) return;
      parent.children[index] = { type: "text", value: node.value };
    });
  };
}

interface SemanticOptions {
  bibliography: Map<string, BibliographyEntry>;
  citedIds: ReadonlySet<string>;
  references: Map<string, ReferenceEntry>;
  citationStyle: CitationStyle;
  citationFormatter: CitationFormatter;
  diagnostics: Diagnostic[];
}

function renderSemanticDirectives(options: SemanticOptions) {
  return (tree: MdastRoot, file: { value: unknown }): void | Promise<void> => {
    const source = String(file.value);
    const pending: Promise<void>[] = [];
    visit(tree, (node, index, parent) => {
      if (node.type !== "textDirective" && node.type !== "leafDirective" && node.type !== "containerDirective") return;
      if (index === undefined || !parent) return;
      const directive: Directives = node;
      const content = directiveContent(directive, source);
      const directiveName = directive.name.toLocaleLowerCase();
      if (directive.type === "containerDirective" && directiveName === "figure") {
        const parsed = parseNativeFigure(directive);
        if (parsed.figure) {
          const rendered = renderNativeFigure(parsed.figure, directive.position?.start.offset ?? 0);
          directive.children = [];
          directive.data = {
            ...directive.data,
            hName: rendered.tagName,
            hProperties: rendered.properties,
            hChildren: rendered.children,
          };
        } else {
          options.diagnostics.push(
            ...parsed.issues.map((issue) => ({ severity: "error" as const, message: issue.message, from: issue.from, to: issue.to })),
          );
          const from = directive.position?.start.offset ?? 0;
          const to = directive.position?.end.offset ?? from;
          directive.children = [];
          directive.data = {
            ...directive.data,
            hName: "pre",
            hProperties: { className: ["native-figure-error"] },
            hChildren: [
              {
                type: "element",
                tagName: "code",
                properties: {},
                children: [{ type: "text", value: source.slice(from, to) }],
              },
            ],
          };
        }
        return [SKIP];
      }
      if (directiveName === "caption" && directive.type === "leafDirective" && isTableCaption(index, parent)) {
        directive.children = [];
        directive.data = {
          ...directive.data,
          hName: "caption",
          hProperties: { className: ["semantic-table-caption"] },
          hChildren: [{ type: "text", value: content }],
        };
        return;
      }
      if ((directiveName === "box" || directiveName === "caption") && directive.type === "leafDirective") {
        const from = directive.position?.start.offset ?? 0;
        const to = directive.position?.end.offset ?? from;
        options.diagnostics.push({
          severity: "error",
          message:
            directiveName === "caption"
              ? "::caption must follow a table or be inside a :::figure container"
              : "::box must be inside a :::figure container",
          from,
          to,
        });
        directive.children = [];
        directive.data = {
          ...directive.data,
          hName: "code",
          hProperties: { className: ["native-figure-error"] },
          hChildren: [{ type: "text", value: source.slice(from, to) }],
        };
        return;
      }
      if (directive.type === "textDirective" && isCitationDirectiveName(directiveName)) {
        const locator = attributeValue(directive.attributes?.locator);
        const prefix = attributeValue(directive.attributes?.prefix);
        const suffix = attributeValue(directive.attributes?.suffix);
        const citation = {
          ids: splitIds(content),
          mode: citationModeForDirective(directiveName, attributeValue(directive.attributes?.mode)),
          ...(locator ? { locator } : {}),
          ...(prefix ? { prefix } : {}),
          ...(suffix ? { suffix } : {}),
        } satisfies Citation;
        directive.children = [];
        const children = citationChildren(citation, options.bibliography, options.citationStyle, options.citationFormatter);
        const applyChildren = (hChildren: HastElementContent[]): void => {
          directive.data = {
            ...directive.data,
            hName: "span",
            hProperties: { className: ["semantic-citation-group"] },
            hChildren,
          };
        };
        if (isPromiseLike(children)) pending.push(Promise.resolve(children).then(applyChildren));
        else applyChildren(children);
        return;
      }
      if (directive.type === "textDirective" && directive.name === "ref") {
        const target = content;
        const reference = options.references.get(target);
        const customText = attributeValue(directive.attributes?.text);
        const label = customText || reference?.title || target;
        directive.children = [];
        directive.data = {
          ...directive.data,
          hName: "a",
          hProperties: {
            className: ["semantic-reference"],
            dataReference: target,
            href: reference?.href ?? `#${slugify(target)}`,
          },
          hChildren: [{ type: "text", value: label }],
        };
        return;
      }
      if (directive.type === "leafDirective" && directive.name === "label") {
        const target = content;
        directive.children = [];
        directive.data = {
          ...directive.data,
          hName: "span",
          hProperties: { className: ["semantic-label"], id: target },
          hChildren: [],
        };
        return;
      }
      if (directive.type === "leafDirective" && directive.name === "bibliography") {
        const entries = [...options.bibliography.values()].filter((entry) => options.citedIds.has(entry.id));
        directive.children = [];
        const formatted = entries.map((entry) =>
          options.citationFormatter.formatBibliography(entry, { number: entry.number, style: options.citationStyle }),
        );
        const applyBibliography = (values: readonly string[]): void => {
          directive.data = {
            ...directive.data,
            hName: "ol",
            hProperties: { className: ["semantic-bibliography"] },
            hChildren: values.map((value) => ({
              type: "element",
              tagName: "li",
              properties: {},
              children: [{ type: "text", value }],
            })),
          };
        };
        if (formatted.some(isPromiseLike)) pending.push(Promise.all(formatted).then(applyBibliography));
        else applyBibliography(formatted as string[]);
        return;
      }
      parent.children[index] = { type: "text", value: content };
    });
    return pending.length > 0 ? Promise.all(pending).then(() => undefined) : undefined;
  };
}

function validateNativeFigureSyntax(source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml", "toml"]).use(remarkDirective).parse(source);
  visit(tree, (node, index, parent) => {
    if (node.type !== "leafDirective" && node.type !== "containerDirective") return;
    const directive: Directives = node;
    const name = directive.name.toLocaleLowerCase();
    if (directive.type === "containerDirective" && name === "figure") {
      const parsed = parseNativeFigure(directive);
      diagnostics.push(
        ...parsed.issues.map((issue) => ({ severity: "error" as const, message: issue.message, from: issue.from, to: issue.to })),
      );
      return [SKIP];
    }
    if (directive.type === "leafDirective" && name === "caption" && index !== undefined && parent && isTableCaption(index, parent)) return;
    if (directive.type === "leafDirective" && (name === "box" || name === "caption")) {
      const from = directive.position?.start.offset ?? 0;
      const to = directive.position?.end.offset ?? from;
      diagnostics.push({
        severity: "error",
        message:
          name === "caption"
            ? "::caption must follow a table or be inside a :::figure container"
            : "::box must be inside a :::figure container",
        from,
        to,
      });
    }
  });
  return diagnostics;
}

function isTableCaption(index: number, parent: Parent): boolean {
  return parent.children[index - 1]?.type === "table";
}

function attachTableCaptions() {
  return (tree: HastRoot): void => moveTableCaptions(tree);
}

function moveTableCaptions(parent: HastRoot | HastElement): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const node = parent.children[index];
    if (node?.type === "element" && node.tagName === "caption") {
      let tableIndex = index - 1;
      while (tableIndex >= 0) {
        const candidate = parent.children[tableIndex];
        if (candidate?.type !== "text" || candidate.value.trim()) break;
        tableIndex -= 1;
      }
      const table = parent.children[tableIndex];
      if (table?.type === "element" && table.tagName === "table") {
        table.children.unshift(node);
        parent.children.splice(index, 1);
        index -= 1;
        continue;
      }
    }
    if (node?.type === "element") moveTableCaptions(node);
  }
}

interface NumberedHeadingOptions {
  headingNumbers?: HeadingNumbers;
  headings: RenderedHeading[];
}

function renderNumberedHeadings({ headingNumbers = {}, headings }: NumberedHeadingOptions) {
  return (tree: HastRoot): void => {
    const counters = { h2: 0, h3: 0 };
    const foundIds = new Set<string>();
    visit(tree, "element", (node: HastElement, index, parent) => {
      if (node.tagName !== "h2" && node.tagName !== "h3" && node.tagName !== "h4") return;
      if (node.tagName === "h4") {
        if (index !== undefined && parent) parent.children[index] = { ...node, tagName: "b", properties: {} };
        return;
      }
      const title = hastText(node).trim();
      const explicitId = typeof node.properties.id === "string" ? node.properties.id : undefined;
      const id = getUniqueId(explicitId ?? slugify(title), foundIds);
      const generatedNumber = getHeadingNumber(node.tagName, counters);
      const number =
        node.position?.start.offset === undefined ? generatedNumber : (headingNumbers[node.position.start.offset] ?? generatedNumber);
      node.properties.id = id;
      node.children.unshift({
        type: "element",
        tagName: "span",
        properties: { className: ["section-number"] },
        children: [{ type: "text", value: `${number} ` }],
      });
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) {
        headings.push({ depth: node.tagName === "h2" ? 2 : 3, id, title, number, from, to });
      }
    });
  };
}

function normalizeTableAlignment() {
  return (tree: HastRoot): void => {
    visit(tree, "element", (node: HastElement) => {
      if (node.tagName !== "th" && node.tagName !== "td") return;
      const alignment = node.properties.align;
      delete node.properties.align;
      if (alignment === "center" || alignment === "left" || alignment === "right") {
        node.properties.style = `text-align: ${alignment}`;
      }
    });
  };
}

function citationChildren(
  citation: Citation,
  bibliography: Map<string, BibliographyEntry>,
  citationStyle: CitationStyle,
  formatter: CitationFormatter,
): HastElementContent[] | Promise<HastElementContent[]> {
  const entries = citation.ids.map((id) =>
    bibliography.get(id) ?? { id, authors: [{ literal: id }], title: id, year: "n.d.", number: 0, data: { id } },
  );
  const formatted = entries.map((entry) =>
    formatter.formatCitation(entry, {
      ...(citation.locator ? { locator: citation.locator } : {}),
      mode: citation.mode,
      number: [...bibliography.keys()].indexOf(entry.id) + 1,
      style: citationStyle,
    }),
  );
  if (formatted.some(isPromiseLike)) {
    return Promise.all(formatted).then((values) => citationChildrenFromText(citation, citationStyle, entries, values));
  }
  return citationChildrenFromText(citation, citationStyle, entries, formatted as string[]);
}

function citationChildrenFromText(
  citation: Citation,
  citationStyle: CitationStyle,
  entries: readonly BibliographyEntry[],
  formatted: readonly string[],
): HastElementContent[] {
  const separator = citationStyle === "ieee" || citation.mode === "textual" ? ", " : "; ";
  const children: HastElementContent[] = [];
  if (citation.prefix) children.push({ type: "text", value: citation.prefix });
  if (citation.mode === "parenthetical") children.push({ type: "text", value: citationStyle === "ieee" ? "[" : "(" });
  for (const [index, entry] of entries.entries()) {
    if (index > 0) children.push({ type: "text", value: separator });
    children.push({
      type: "element",
      tagName: "button",
      properties: {
        type: "button",
        className: ["semantic-citation"],
        dataCitation: entry.id,
        ...(citation.locator ? { dataLocator: citation.locator } : {}),
        ariaLabel: `Open reference ${entry.title || entry.id}`,
      },
      children: [
        {
          type: "text",
          value: formatted[index] ?? entry.id,
        },
      ],
    });
  }
  if (citation.mode === "parenthetical") children.push({ type: "text", value: citationStyle === "ieee" ? "]" : ")" });
  if (citation.locator) children.push({ type: "text", value: `, ${citation.locator}` });
  if (citation.suffix) children.push({ type: "text", value: citation.suffix });
  return children;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function mdastText(node: MdastRoot | MdastRootContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return "children" in node ? node.children.map((child) => mdastText(child)).join("") : "";
}

function directiveContent(directive: Directives, source: string): string {
  const from = directive.position?.start.offset;
  const to = directive.position?.end.offset;
  if (from !== undefined && to !== undefined) {
    const authored = /^[^\[]+\[([^\]]*)\]/u.exec(source.slice(from, to))?.[1];
    if (authored !== undefined) return authored.trim();
  }
  return mdastText(directive).trim();
}

function hastText(node: HastRoot | HastRootContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return "children" in node ? node.children.map((child) => hastText(child)).join("") : "";
}

function collectReferences(
  source: string,
  headingNumbers: HeadingNumbers,
): { references: Map<string, ReferenceEntry>; localReferences: LocalReferenceEntry[] } {
  const references = new Map<string, ReferenceEntry>();
  const localReferences: LocalReferenceEntry[] = [];
  const counters = { h2: 0, h3: 0 };
  const headingsByOffset = new Map<number, string>();
  const tree = parseMarkdown(source);
  const attachments = labelAttachments(tree);
  visit(tree, "heading", (heading: Heading) => {
    const offset = heading.position?.start.offset;
    if (offset === undefined) return;
    const level = `h${heading.depth}`;
    const generatedNumber = level === "h2" || level === "h3" ? getHeadingNumber(level, counters) : "";
    const number = headingNumbers[offset] ?? generatedNumber;
    headingsByOffset.set(offset, [number, mdastText(heading).trim()].filter(Boolean).join(" "));
  });
  for (const label of source.matchAll(labelPattern)) {
    const target = label[1]?.trim() ?? "";
    const from = label.index ?? 0;
    const to = from + label[0].length;
    const attachedBlock = attachments.get(from);
    const attachedFrom = attachedBlock?.position?.start.offset;
    if (target && attachedFrom !== undefined && !references.has(target)) {
      const reference = {
        label: target,
        title: headingsByOffset.get(attachedFrom) ?? target,
        href: `#${target}`,
        fragment: target,
        from,
        to,
        attachedFrom,
      } satisfies LocalReferenceEntry;
      references.set(target, reference);
      localReferences.push(reference);
    }
  }
  return { references, localReferences };
}

function parseMarkdown(source: string): MdastRoot {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkDirective)
    .parse(source) as MdastRoot;
}

function labelAttachments(tree: MdastRoot): ReadonlyMap<number, MdastRootContent> {
  const attachments = new Map<number, MdastRootContent>();
  for (const [index, node] of tree.children.entries()) {
    if (!isLabelDirective(node)) continue;
    const from = node.position?.start.offset;
    const previous = tree.children[index - 1];
    const target = previous && isCaptionDirective(previous) && isTableCaption(index - 1, tree) ? tree.children[index - 2] : previous;
    if (from !== undefined && target && isLabelTarget(target)) attachments.set(from, target);
  }
  return attachments;
}

function isLabelDirective(node: MdastRootContent): boolean {
  return node.type === "leafDirective" && node.name.toLocaleLowerCase() === "label";
}

function isCaptionDirective(node: MdastRootContent): boolean {
  return node.type === "leafDirective" && node.name.toLocaleLowerCase() === "caption";
}

function isLabelTarget(node: MdastRootContent): boolean {
  const type = String(node.type);
  return type !== "definition" && type !== "yaml" && type !== "toml" && !isLabelDirective(node);
}

function renderedReferenceTargets(
  localReferences: readonly LocalReferenceEntry[],
  headings: readonly RenderedHeading[],
): RenderedReferenceTarget[] {
  const headingsByOffset = new Map(headings.map((heading) => [heading.from, heading]));
  return localReferences.map((reference) => {
    const heading = headingsByOffset.get(reference.attachedFrom);
    return {
      label: reference.label,
      title: heading ? `${heading.number} ${heading.title}` : reference.title,
      fragment: reference.fragment,
      from: reference.from,
      to: reference.to,
    };
  });
}

function collectCitationIds(source: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const match of source.matchAll(directivePattern)) {
    if (!isCitationDirectiveName(match[1]?.toLocaleLowerCase() ?? "")) continue;
    for (const id of splitIds(match[2] ?? "")) ids.add(id);
  }
  return ids;
}

function validateSyntax(
  source: string,
  bibliography: Map<string, BibliographyEntry>,
  references: Map<string, ReferenceEntry>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const match of source.matchAll(directivePattern)) {
    const kind = match[1]?.toLowerCase() ?? "";
    const content = match[2]?.trim() ?? "";
    const attributes = parseAttributes(match[3] ?? "");
    if (isCitationDirectiveName(kind)) {
      const mode = citationModeForDirective(kind, attributes.get("mode"));
      if (!new Set(["parenthetical", "textual", "full"]).has(mode))
        diagnostics.push(toDiagnostic(`Unsupported citation mode: ${mode}`, match));
      const ids = splitIds(content);
      if (ids.length === 0) diagnostics.push(toDiagnostic("Citation requires an id", match));
      for (const id of ids) if (!bibliography.has(id)) diagnostics.push(toDiagnostic(`Missing citation: ${id}`, match));
    } else if (kind === "ref") {
      const target = content;
      for (const name of attributes.keys())
        if (name !== "text") diagnostics.push(toDiagnostic(`Unsupported reference attribute: ${name}`, match));
      if (!target) diagnostics.push(toDiagnostic("Reference requires a label id", match));
      else if (!references.has(target)) diagnostics.push(toDiagnostic(`Missing label: ${target}`, match));
    } else diagnostics.push(toDiagnostic(`Unsupported text directive: :${kind}`, match));
  }
  diagnostics.push(...validateReferenceDeclarations(source));
  return diagnostics.sort((left, right) => left.from - right.from);
}

function validateReferenceDeclarations(source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const declarations: Array<{ target: string; match: RegExpMatchArray }> = [];
  const attachments = labelAttachments(parseMarkdown(source));
  let bibliographyMarkers = 0;
  for (const match of source.matchAll(/^::([a-z][a-z-]*)\[([^\]]*)\](?:\{([^}]*)\})?[ \t]*$/gimu)) {
    const kind = match[1]?.toLowerCase() ?? "";
    if (kind === "bibliography") {
      bibliographyMarkers += 1;
      if ((match[2]?.trim() ?? "") || (match[3]?.trim() ?? "")) {
        diagnostics.push(toDiagnostic("Bibliography marker must be exactly ::bibliography[]", match));
      } else if (bibliographyMarkers > 1) diagnostics.push(toDiagnostic("Duplicate bibliography marker", match));
    } else if (kind === "label") {
      const id = match[2]?.trim() ?? "";
      if ((match[3]?.trim() ?? "") || match[2] !== id) diagnostics.push(toDiagnostic("Label must be exactly ::label[id]", match));
      if (!id) diagnostics.push(toDiagnostic("Label requires an id", match));
      else if (!/^[a-zA-Z0-9:_-]+$/u.test(id)) diagnostics.push(toDiagnostic(`Invalid label id: ${id}`, match));
      if (!attachments.has(match.index ?? 0)) diagnostics.push(toDiagnostic("Label must follow a block", match));
      if (id) declarations.push({ target: id, match });
    } else if (kind !== "box" && kind !== "caption") {
      diagnostics.push(toDiagnostic(`Unsupported leaf directive: ::${kind}`, match));
    }
  }
  for (const match of source.matchAll(/^:::[ \t]*([a-z][a-z-]*)\b.*$/gimu)) {
    const kind = match[1]?.toLowerCase() ?? "";
    if (kind !== "figure") diagnostics.push(toDiagnostic(`Unsupported container directive: :::${kind}`, match));
  }
  for (const heading of source.matchAll(/^#{1,6}[ \t].*\{#[^}\r\n]+\}[ \t]*$/gmu))
    diagnostics.push(toDiagnostic("Heading ids are not supported; use ::label[id]", heading));
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (seen.has(declaration.target)) diagnostics.push(toDiagnostic(`Duplicate label: ${declaration.target}`, declaration.match));
    seen.add(declaration.target);
  }
  return diagnostics;
}

function getHeadingNumber(type: string, counters: { h2: number; h3: number }): string {
  if (type === "h2") {
    counters.h2 += 1;
    counters.h3 = 0;
    return String(counters.h2);
  }
  counters.h3 += 1;
  return `${counters.h2}.${counters.h3}`;
}

function getUniqueId(value: string, foundIds: Set<string>): string {
  const base = value || "section";
  let id = base;
  let suffix = 2;
  while (foundIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  foundIds.add(id);
  return id;
}

function splitIds(value: string): string[] {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(attributePattern)) {
    const name = match[1];
    const value = match[2] ?? match[3];
    if (name && value !== undefined) attributes.set(name, value);
  }
  return attributes;
}

function attributeValue(value: string | null | undefined): string | undefined {
  return value || undefined;
}

function toDiagnostic(message: string, match: RegExpMatchArray): Diagnostic {
  const from = match.index ?? 0;
  return { severity: "error", message, from, to: from + match[0].length };
}

// Stryker restore Regex
