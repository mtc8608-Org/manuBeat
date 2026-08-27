---
name: name-notebook-cells-by-heading
description: "Refer to notebook cells by their region comment or markdown heading, never by index number"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c7eeb6f2-d1d6-4257-b035-062416c0fb28
  modified: 2026-08-10T15:30:25.625Z
---

When discussing a `.ipynb` with the user, identify a cell by its `# region -> …`
comment or the markdown heading above it ("the EFC recovery cell", "the cost &
accuracy table cell"), never by index ("cell 17").

**Why:** the user reads notebooks in the VSCode/Jupyter UI, which shows no cell
numbers. An index is unresolvable for them and reads as a made-up reference.

**How to apply:** every cell reference in a reply, commit message or plan uses
the region text. The region-wrap rule ([[.claude/rules/notebook-cells.md]]
territory) guarantees every cell has one.

Related: [[notebook-cells]] (the region-wrapping rule the names come from).
