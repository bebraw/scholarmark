import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";

const child = spawn(process.execPath, [resolve("editors/vscode/dist/server.cjs"), "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
connection.onRequest("workspace/configuration", () => [{ bibliographyFile: "bibliography.bib" }]);
connection.listen();

try {
  const initialized = await connection.sendRequest("initialize", {
    processId: null,
    rootUri: null,
    capabilities: { workspace: { configuration: true } },
    workspaceFolders: null,
  });
  assert.equal(initialized.capabilities.definitionProvider, true);
  assert.equal(initialized.capabilities.foldingRangeProvider, true);
  connection.sendNotification("initialized", {});
  connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri: "untitled:scholarmark-smoke", languageId: "markdown", version: 1, text: "::" },
  });
  const completions = await connection.sendRequest("textDocument/completion", {
    textDocument: { uri: "untitled:scholarmark-smoke" },
    position: { line: 0, character: 2 },
  });
  assert.ok(completions.some((item) => item.label === "::label"));
  assert.ok(completions.some((item) => item.label === "::bibliography"));
  await connection.sendRequest("shutdown");
  connection.sendNotification("exit");
  console.log("language server smoke test passed");
} finally {
  connection.dispose();
  child.kill();
}
