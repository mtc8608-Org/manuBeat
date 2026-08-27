---
paths:
  - "python/run_*/*.ipynb"
---

# Notebook cell regions (non-negotiable)

EVERY code cell in EVERY notebook (`*.ipynb`) MUST be region-wrapped — no exceptions, whether the
cell is new, cloned from a template, or edited:

- The **first line** of the cell is `# region -> <what the cell does>`.
- The **last line** of the cell is `# endregion`.

This holds for one-line cells too. Markdown cells are exempt.

**Why:** the user relies on editor folding and wants uniform, foldable notebooks. The `# region` /
`# endregion` comments are inert Python, so they never affect execution.

**How to apply:** when you create, adapt, or touch a code cell, add the wrapper. After building or
editing a notebook, verify every code cell's first line starts `# region -> ` and its last line is
`# endregion`. A few older driver notebooks predate this rule — fold them in whenever you touch
them; do not add new unwrapped cells anywhere.

# Markdown cells: title and a COLLAPSIBLE description are separate cells

Every markdown cell that carries BOTH a heading and explanatory prose MUST be split into two
consecutive markdown cells:

- **Cell 1 — title only**: the `#`/`##`/… heading line, nothing else.
- **Cell 2 — description**: the prose that followed it, wrapped in a collapsible `<details>`
  disclosure so it can be folded independently of the surrounding code cells:

  ```
  <details>
  <summary>{first line of the prose}</summary>

  {the rest of the prose}

  </details>
  ```

  Collapsed by default (no `open` attribute). The `<summary>` is the first line of the prose (the
  always-visible teaser); everything after it is the foldable body. A blank line after `</summary>`
  is REQUIRED for the body to render as markdown. A one-line description leaves the body empty —
  that is fine, it just shows as the summary line.

**Why:** the user folds a verbose description away while keeping the title AND the code cells
visible. A bare prose cell has no independent fold control (only heading sections collapse, and
those hide the code too), and a combined title+prose cell can't be collapsed without hiding the
heading — the `<details>` block is the only thing that folds just the description.

**How to apply:** when you author or edit a markdown cell that has a heading followed by any
non-empty prose, emit it as a title cell + a `<details>`-wrapped description cell. Leave a
heading-only cell (no prose) as-is, and leave a prose-only cell (no heading) as-is — only cells
that mix the two get split. When scaffolding a new notebook, generate the title +
collapsible-description pair from the start.
