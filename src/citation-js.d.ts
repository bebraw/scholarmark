declare module "@citation-js/core" {
  export class Cite {
    constructor(data?: unknown, options?: unknown);
    readonly data: unknown[];
  }
}

declare module "@citation-js/plugin-bibtex";
