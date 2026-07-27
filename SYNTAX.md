# Book Markdown syntax

Book chapters use standard Markdown wherever possible. Book-specific semantics
use Satteri directives so citations and cross-references remain structured and
can be validated at build time.

## Chapter structure

Documents follow the standard Markdown heading hierarchy and may use a
level-one heading as their main title. Level-two and level-three headings receive
generated section numbers. Level-four headings represent LaTeX-style paragraph
labels: they render as unnumbered bold labels.

```markdown
# Study title

## Main section

### Subsection

#### Unnumbered paragraph label
```

## Labels and references

Use `::label[id]` immediately before any block that other content needs to
reference. The same syntax labels headings, tables, figures, and paragraphs.
The id becomes the public fragment and reference key.

```markdown
::label[sec:citing-accuracy]

## Why citing matters

See :ref[sec:citing-accuracy].
See :ref[sec:citing-accuracy]{text="the earlier discussion"}.
```

Without custom text, a heading reference renders the numbered title of its
target. Use `text` to override link text, particularly for non-heading targets:

```markdown
::label[table:methods]

| Method | Result |
| --- | --- |
| A | 42 |

The results appear in :ref[table:methods]{text="the methods table"}.
```

Labels may use familiar LaTeX-style keys containing letters, numbers, colons,
underscores, and hyphens. Duplicate, invalid, and unattached labels fail
validation.

## Citations

Citation ids refer to entries in `bibliography.bib`. Parenthetical citations are
the default.

```markdown
:cite[source-id]
:cite[source-a, source-b]
:cite[source-id]{mode=textual}
:cite[source-id]{mode=full}
:cite[source-id]{locator="p. 42"}
:cite[source-id]{prefix="See " suffix=" for details"}
```

Supported modes are:

- `parenthetical`: renders author and year in parentheses.
- `textual`: renders the author as sentence text followed by the year.
- `full`: renders the full formatted bibliography entry without parentheses.

Multiple ids are comma-separated inside the brackets. Parenthetical and full
citations separate multiple entries with semicolons; textual citations use
commas. `locator` appends a page or section locator. `prefix` and `suffix` add
text directly before and after the rendered citation, including any spaces
provided in their values.

## Standard Markdown

Use standard Markdown for links, emphasis, lists, images, tables, and fenced
code blocks. GFM footnotes are enabled.

```markdown
A statement with supporting detail.[^detail]

[^detail]: The supporting detail.
```

Do not use raw HTML to implement citations or cross-references.

## Validation

The build rejects:

- Missing citation ids or reference labels.
- Duplicate, invalid, or unattached labels.
- Empty or unsupported directives and citation modes.

Run `npm test` for syntax and full-book integration coverage. Run
`npm run build` to validate the complete reference graph while generating the
site.
