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

Use `::label[id]` immediately after any block that other content needs to
reference, following the familiar LaTeX order. The same syntax labels headings,
tables, figures, and paragraphs.
The id becomes the public fragment and reference key.

```markdown
## Why citing matters
::label[sec:citing-accuracy]

See :ref[sec:citing-accuracy].
See :ref[sec:citing-accuracy]{text="the earlier discussion"}.
```

Without custom text, heading, captioned-table, and native-figure references
render the numbered title of their target. Use `text` to override link text:

```markdown
| Method | Result |
| --- | --- |
| A | 42 |
::caption[Results by experimental method.]
::label[table:methods]

The results appear in :ref[table:methods].
Compare :ref[table:methods]{text="the methods table"} with the appendix.
```

A table caption uses the same `::caption[...]` spelling as a native figure
caption, but follows the complete GFM table. If present, the table's label
follows its caption. A caption anywhere else must be inside a supported figure
container. Captioned tables and valid native figures use independent numbered
sequences. Their postfix labels render directly as the `id` of the `<table>` or
`<figure>`.

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

## Disclosures

Use `:::details[Title]` for supporting material that belongs in the publication
but need not interrupt the main text. Put a nonempty plain-text title in square
brackets, then a Markdown body, and close the container on its own line:

```markdown
:::details[How was the sample selected?]
We included **completed trials** that met both conditions:

- The instrument was calibrated.
- The observation window covered the full trial.
:::

The main explanation continues here.
```

HTML renders a closed native `<details>` with the title as its `<summary>`.
Links, citations, and labels in the body work as in the surrounding text.
For a nested container, use a longer fence for the outer disclosure (for
example, four colons around a three-colon block). No attributes are accepted.
An invalid disclosure reports an error and leaves its content visible.

For print or other noninteractive output, keep the title and body together.
A host printing the HTML can open its `details` elements before printing.

## Comments

A `%` as the first non-whitespace character comments out that physical source
line. The line does not render, contribute document semantics, or split a prose
paragraph. Use `\%` for a literal percent at the beginning of a line. Percent
signs elsewhere remain ordinary text.

```markdown
First sentence goes here.
% Commented sentence goes here.
Third sentence goes here.
```

Use `::: comment` for a block comment:

```markdown
::: comment
Verify this interpretation before submission.
:::
```

Comment markers inside frontmatter and fenced code are literal.

## Validation

The build rejects:

- Missing citation ids or reference labels.
- Duplicate, invalid, or unattached labels.
- Empty or unsupported directives and citation modes.

Run `npm test` for syntax and full-book integration coverage. Run
`npm run build` to validate the complete reference graph while generating the
site.
