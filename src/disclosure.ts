import type { Paragraph } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type { Diagnostic } from "./markdown.js";

type Disclosure = { summary: Paragraph; error?: never } | { summary?: never; error: Diagnostic };

/** Inspect the parser's label paragraph rather than treating the first body paragraph as a title. */
export function parseDisclosure(node: ContainerDirective, source: string): Disclosure {
  const from = node.position?.start.offset ?? 0;
  const end = node.position?.end.offset ?? from;
  const newline = source.indexOf("\n", from);
  const to = newline < 0 ? end : Math.min(newline, end);
  const error = (message: string): Disclosure => ({ error: { severity: "error", from, to, message } });
  const label = node.children[0];
  if (
    label?.type !== "paragraph" ||
    !label.data?.directiveLabel ||
    !label.children.every((child) => child.type === "text") ||
    !label.children.map((child) => child.value).join("").trim()
  ) {
    return error(":::details requires a nonempty plain-text summary in brackets");
  }
  if (Object.keys(node.attributes ?? {}).length) return error(":::details does not accept attributes");
  if (node.children.length === 1) return error(":::details requires a Markdown body");

  // remark-directive also accepts implicit ends. Require an explicit closing
  // fence so accidentally omitting one cannot collapse the rest of a document.
  const width = /^:+/u.exec(source.slice(from, to))?.[0].length ?? 3;
  const lastChildEnd = node.children.at(-1)?.position?.end.offset ?? to;
  const closing = /(:{3,})[ \t]*$/u.exec(source.slice(lastChildEnd, end));
  if (!closing || closing[1].length < width) return error(":::details requires a closing fence");

  return { summary: label };
}
