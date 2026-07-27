import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "cjs",
  logLevel: "info",
  minify: false,
  platform: "node",
  sourcemap: true,
  target: "node20",
};

await Promise.all([
  build({ ...shared, entryPoints: ["editors/vscode/src/client.ts"], external: ["vscode"], outfile: "editors/vscode/dist/client.cjs" }),
  build({ ...shared, entryPoints: ["editors/vscode/src/server.ts"], outfile: "editors/vscode/dist/server.cjs" }),
]);
