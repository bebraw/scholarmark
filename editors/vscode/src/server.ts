import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CompletionItemKind,
  createConnection,
  DiagnosticSeverity,
  DocumentSymbol,
  FoldingRangeKind,
  InsertTextFormat,
  Location,
  MarkupKind,
  ProposedFeatures,
  Range,
  SymbolKind,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
  WorkspaceEdit,
  type CompletionItem,
  type DefinitionParams,
  type DocumentSymbolParams,
  type FoldingRange,
  type Hover,
  type InitializeParams,
  type InitializeResult,
  type PrepareRenameParams,
  type ReferenceParams,
  type RenameParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeScholarmark, isScholarmarkDocument, itemAtOffset, type SourceRange } from "../../../src/language-service.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let workspaceFolders: string[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceFolders = (params.workspaceFolders ?? [])
    .filter((folder) => folder.uri.startsWith("file:"))
    .map((folder) => fileURLToPath(folder.uri));
  if (workspaceFolders.length === 0 && params.rootUri?.startsWith("file:")) workspaceFolders = [fileURLToPath(params.rootUri)];
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: [":", "[", ","] },
      definitionProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
    },
  };
});

documents.onDidOpen(({ document }) => void validate(document));
documents.onDidChangeContent(({ document }) => void validate(document));
connection.onDidChangeConfiguration(() => void Promise.all(documents.all().map(validate)));
connection.onDidChangeWatchedFiles(() => void Promise.all(documents.all().map(validate)));

connection.onCompletion(async (params): Promise<CompletionItem[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const bibliography = await loadBibliography(document.uri);
  const analysis = analyzeScholarmark(document.getText(), bibliography.source);
  const offset = document.offsetAt(params.position);
  const prefix = document.getText().slice(Math.max(0, offset - 500), offset);
  if (/:ref\[[^\]\r\n]*$/u.test(prefix)) {
    return analysis.labels.map((label) => ({ label: label.id, kind: CompletionItemKind.Reference, detail: "Scholarmark label" }));
  }
  if (/:cite(?:t|p)?\[[^\]\r\n]*$/u.test(prefix)) {
    return [...analysis.bibliography.values()].map((entry) => ({
      label: entry.id,
      kind: CompletionItemKind.Reference,
      detail: typeof entry.title === "string" ? entry.title : "BibTeX entry",
    }));
  }
  const line = document.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
  if (/^[ \t]*:::$/u.test(line)) return containerDirectiveCompletions;
  if (/^[ \t]*::$/u.test(line)) return leafDirectiveCompletions;
  if (/(?<!:):$/u.test(line)) return textDirectiveCompletions;
  return [];
});

connection.onHover(async (params: TextDocumentPositionParams): Promise<Hover | null> => {
  const context = await documentContext(params);
  if (!context) return null;
  const item = itemAtOffset(context.analysis, context.offset);
  if (!item) return null;
  if ("kind" in item && item.kind === "citation") {
    const entry = context.analysis.bibliography.get(item.id);
    if (!entry) return { contents: { kind: MarkupKind.Markdown, value: `Unresolved citation \`${item.id}\`.` } };
    const title = typeof entry.title === "string" ? entry.title : item.id;
    return { contents: { kind: MarkupKind.Markdown, value: `**${title}**\n\nCitation key: \`${item.id}\`` } };
  }
  const definition = context.analysis.labels.find((label) => label.id === item.id);
  const status = definition ? "Defined in this document." : "Unresolved label.";
  return { contents: { kind: MarkupKind.Markdown, value: `Scholarmark label \`${item.id}\`\n\n${status}` } };
});

connection.onDefinition(async (params: DefinitionParams): Promise<Location | null> => {
  const context = await documentContext(params);
  if (!context) return null;
  const item = itemAtOffset(context.analysis, context.offset);
  if (!item || !("kind" in item)) return null;
  if (item.kind === "reference") {
    const label = context.analysis.labels.find((candidate) => candidate.id === item.id);
    return label ? Location.create(context.document.uri, toRange(context.document, label.selectionRange)) : null;
  }
  if (!context.bibliography.uri) return null;
  const sourceRange = bibliographyKeyRange(context.bibliography.source, item.id);
  if (!sourceRange) return null;
  const bibliographyDocument = TextDocument.create(context.bibliography.uri, "bibtex", 0, context.bibliography.source);
  return Location.create(context.bibliography.uri, toRange(bibliographyDocument, sourceRange));
});

connection.onDocumentSymbol(async (params: DocumentSymbolParams): Promise<DocumentSymbol[]> => {
  const context = await analysisContext(params.textDocument.uri);
  if (!context) return [];
  const symbols: DocumentSymbol[] = context.analysis.headings.map((heading) =>
    DocumentSymbol.create(
      heading.title,
      undefined,
      SymbolKind.String,
      toRange(context.document, heading.range),
      toRange(context.document, heading.selectionRange),
    ),
  );
  symbols.push(
    ...context.analysis.labels.map((label) =>
      DocumentSymbol.create(
        label.id,
        "Scholarmark label",
        SymbolKind.Key,
        toRange(context.document, label.range),
        toRange(context.document, label.selectionRange),
      ),
    ),
  );
  symbols.push(
    ...context.analysis.figures.map((figure, index) =>
      DocumentSymbol.create(
        `Figure ${index + 1}`,
        undefined,
        SymbolKind.Object,
        toRange(context.document, figure.range),
        toRange(context.document, figure.selectionRange),
      ),
    ),
  );
  return symbols;
});

connection.onFoldingRanges(async (params): Promise<FoldingRange[]> => {
  const context = await analysisContext(params.textDocument.uri);
  if (!context) return [];
  return [
    ...context.analysis.comments.map((range) => foldingRange(context.document, range, FoldingRangeKind.Comment)),
    ...context.analysis.figures.map((figure) => foldingRange(context.document, figure.range, FoldingRangeKind.Region)),
  ];
});

connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
  const context = await documentContext(params);
  if (!context) return [];
  const item = itemAtOffset(context.analysis, context.offset);
  if (!item || ("kind" in item && item.kind === "citation")) return [];
  return labelLocations(item.id, params.context.includeDeclaration);
});

connection.onPrepareRename(async (params: PrepareRenameParams): Promise<Range | null> => {
  const context = await documentContext(params);
  if (!context) return null;
  const item = itemAtOffset(context.analysis, context.offset);
  if (!item || ("kind" in item && item.kind === "citation")) return null;
  return toRange(context.document, item.selectionRange);
});

connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit | null> => {
  const context = await documentContext(params);
  if (!context || !/^[a-zA-Z0-9:_-]+$/u.test(params.newName)) return null;
  const item = itemAtOffset(context.analysis, context.offset);
  if (!item || ("kind" in item && item.kind === "citation")) return null;
  const changes: Record<string, TextEdit[]> = {};
  for (const document of documents.all()) {
    const bibliography = await loadBibliography(document.uri);
    const analysis = analyzeScholarmark(document.getText(), bibliography.source);
    const ranges = [
      ...analysis.labels.filter((label) => label.id === item.id),
      ...analysis.occurrences.filter((occurrence) => occurrence.kind === "reference" && occurrence.id === item.id),
    ];
    if (ranges.length > 0) changes[document.uri] = ranges.map((range) => TextEdit.replace(toRange(document, range.selectionRange), params.newName));
  }
  return { changes };
});

async function validate(document: TextDocument): Promise<void> {
  const version = document.version;
  if (!isScholarmarkDocument(document.getText())) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }
  const bibliography = await loadBibliography(document.uri);
  const analysis = analyzeScholarmark(document.getText(), bibliography.source);
  if (documents.get(document.uri)?.version !== version) return;
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: analysis.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      message: diagnostic.message,
      range: toRange(document, diagnostic),
      source: "scholarmark",
    })),
  });
}

async function documentContext(params: TextDocumentPositionParams) {
  const context = await analysisContext(params.textDocument.uri);
  if (!context) return undefined;
  return { ...context, offset: context.document.offsetAt(params.position) };
}

async function analysisContext(documentUri: string) {
  const document = documents.get(documentUri);
  if (!document) return undefined;
  const bibliography = await loadBibliography(document.uri);
  return {
    document,
    bibliography,
    analysis: analyzeScholarmark(document.getText(), bibliography.source),
  };
}

async function loadBibliography(documentUri: string): Promise<{ source: string; uri?: string }> {
  if (!documentUri.startsWith("file:")) return { source: "" };
  const documentPath = fileURLToPath(documentUri);
  const workspace = workspaceFolders
    .filter((folder) => documentPath === folder || documentPath.startsWith(`${folder}${path.sep}`))
    .sort((left, right) => right.length - left.length)[0];
  const base = workspace ?? path.dirname(documentPath);
  let configured = "bibliography.bib";
  try {
    const settings = (await connection.workspace.getConfiguration({ section: "scholarmark", scopeUri: documentUri })) as {
      bibliographyFile?: unknown;
    };
    if (typeof settings?.bibliographyFile === "string" && settings.bibliographyFile.trim()) configured = settings.bibliographyFile;
  } catch {
    // Clients without workspace/configuration support use the documented default.
  }
  const bibliographyPath = path.resolve(base, configured);
  if (workspace && bibliographyPath !== workspace && !bibliographyPath.startsWith(`${workspace}${path.sep}`)) return { source: "" };
  try {
    return { source: await readFile(bibliographyPath, "utf8"), uri: pathToFileURL(bibliographyPath).href };
  } catch {
    return { source: "", uri: pathToFileURL(bibliographyPath).href };
  }
}

async function labelLocations(id: string, includeDeclaration: boolean): Promise<Location[]> {
  const locations: Location[] = [];
  for (const document of documents.all()) {
    const bibliography = await loadBibliography(document.uri);
    const analysis = analyzeScholarmark(document.getText(), bibliography.source);
    if (includeDeclaration) {
      for (const label of analysis.labels.filter((candidate) => candidate.id === id)) {
        locations.push(Location.create(document.uri, toRange(document, label.selectionRange)));
      }
    }
    for (const reference of analysis.occurrences.filter((candidate) => candidate.kind === "reference" && candidate.id === id)) {
      locations.push(Location.create(document.uri, toRange(document, reference.selectionRange)));
    }
  }
  return locations;
}

function toRange(document: TextDocument, range: SourceRange): Range {
  return Range.create(document.positionAt(range.from), document.positionAt(range.to));
}

function foldingRange(document: TextDocument, range: SourceRange, kind: string): FoldingRange {
  const start = document.positionAt(range.from);
  const end = document.positionAt(range.to);
  return { startLine: start.line, startCharacter: start.character, endLine: end.line, endCharacter: end.character, kind };
}

function bibliographyKeyRange(source: string, id: string): SourceRange | undefined {
  const pattern = new RegExp(`@[a-z]+\\s*[({]\\s*(${escapeRegExp(id)})\\s*,`, "iu");
  const match = pattern.exec(source);
  if (!match?.[1] || match.index === undefined) return undefined;
  const from = match.index + match[0].indexOf(match[1]);
  return { from, to: from + match[1].length };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const textDirectiveCompletions: CompletionItem[] = [
  { label: ":cite", detail: "Parenthetical citation", kind: CompletionItemKind.Snippet, insertText: "cite[${1:key}]", insertTextFormat: InsertTextFormat.Snippet },
  { label: ":citet", detail: "Textual citation", kind: CompletionItemKind.Snippet, insertText: "citet[${1:key}]", insertTextFormat: InsertTextFormat.Snippet },
  { label: ":citep", detail: "Parenthetical citation", kind: CompletionItemKind.Snippet, insertText: "citep[${1:key}]", insertTextFormat: InsertTextFormat.Snippet },
  { label: ":ref", detail: "Cross-reference", kind: CompletionItemKind.Snippet, insertText: "ref[${1:label}]", insertTextFormat: InsertTextFormat.Snippet },
];

const leafDirectiveCompletions: CompletionItem[] = [
  { label: "::label", detail: "Declare a label", kind: CompletionItemKind.Snippet, insertText: "label[${1:id}]", insertTextFormat: InsertTextFormat.Snippet },
  { label: "::caption", detail: "Caption the preceding table", kind: CompletionItemKind.Snippet, insertText: "caption[${1:Caption}]", insertTextFormat: InsertTextFormat.Snippet },
  { label: "::bibliography", detail: "Place the bibliography", kind: CompletionItemKind.Snippet, insertText: "bibliography[]", insertTextFormat: InsertTextFormat.Snippet },
];

const containerDirectiveCompletions: CompletionItem[] = [
  { label: ":::details", detail: "Collapsible details", kind: CompletionItemKind.Snippet, insertText: "details[${1:Title}]\n${2:Body}\n:::", insertTextFormat: InsertTextFormat.Snippet },
  { label: "::: comment", detail: "Portable comment block", kind: CompletionItemKind.Snippet, insertText: " comment\n${1:Comment}\n:::", insertTextFormat: InsertTextFormat.Snippet },
  { label: ":::figure", detail: "Native figure", kind: CompletionItemKind.Snippet, insertText: "figure{kind=\"boxplot\" version=1}\n${1}\n:::", insertTextFormat: InsertTextFormat.Snippet },
];

documents.listen(connection);
connection.listen();
