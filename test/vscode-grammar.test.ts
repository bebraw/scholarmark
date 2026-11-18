import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { INITIAL, parseRawGrammar, Registry, type IGrammar, type StateStack } from "vscode-textmate";

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const grammarPath = resolve(repositoryRoot, "editors/vscode/syntaxes/scholarmark.tmLanguage.json");
let grammar: IGrammar;

beforeAll(async () => {
  const wasmPath = resolve(dirname(require.resolve("vscode-oniguruma")), "onig.wasm");
  const wasm = readFileSync(wasmPath);
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (value) => new OnigString(value),
    }),
    loadGrammar: async (scopeName) =>
      scopeName === "scholarmark.markdown.injection"
        ? parseRawGrammar(readFileSync(grammarPath, "utf8"), grammarPath)
        : null,
  });
  const loaded = await registry.loadGrammar("scholarmark.markdown.injection");
  if (!loaded) throw new Error("Could not load the Scholarmark TextMate grammar");
  grammar = loaded;
});

describe("VS Code TextMate grammar", () => {
  it("scopes an entire portable comment block as a comment", () => {
    let state: StateStack = INITIAL;
    for (const line of ["::: comment", "Review this claim.", ":::"]) {
      const tokenized = grammar.tokenizeLine(line, state);
      state = tokenized.ruleStack;
      expect(tokenized.tokens.some((token) => token.scopes.includes("comment.block.scholarmark")), line).toBe(true);
    }
  });

  it("highlights a disclosure title while leaving the body in Markdown", () => {
    const opener = grammar.tokenizeLine(":::details[Worked example]", INITIAL);
    expect(opener.tokens.find((token) => token.startIndex === 3)?.scopes).toContain("support.function.directive.scholarmark");
    expect(opener.tokens.find((token) => token.startIndex === 11)?.scopes).toContain("entity.name.label.scholarmark");

    const body = grammar.tokenizeLine("See :ref[method].", opener.ruleStack);
    expect(body.tokens.flatMap((token) => token.scopes)).toContain("support.function.directive.scholarmark");
  });

  it("scopes whole-line comments but not escaped leading percentages", () => {
    const comment = grammar.tokenizeLine("  % Review this sentence.", INITIAL);
    expect(comment.tokens.some((token) => token.scopes.includes("comment.line.percentage.scholarmark"))).toBe(true);

    const escaped = grammar.tokenizeLine("\\% A literal percent sign.", INITIAL);
    expect(escaped.tokens.some((token) => token.scopes.includes("comment.line.percentage.scholarmark"))).toBe(false);
  });

  it("scopes directives, labels, and attributes without treating plain assignments as attributes", () => {
    const directive = grammar.tokenizeLine(':cite[doe2026]{mode=textual locator="p. 4"}', INITIAL);
    const scopes = directive.tokens.flatMap((token) => token.scopes);
    expect(scopes).toContain("support.function.directive.scholarmark");
    expect(scopes).toContain("entity.name.label.scholarmark");
    expect(scopes).toContain("variable.other.attribute.scholarmark");
    expect(scopes).toContain("string.quoted.double.scholarmark");

    const prose = grammar.tokenizeLine("A plain value=assignment remains Markdown.", INITIAL);
    expect(prose.tokens.flatMap((token) => token.scopes)).not.toContain("variable.other.attribute.scholarmark");
  });
});
