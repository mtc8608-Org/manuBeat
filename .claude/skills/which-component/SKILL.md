---
name: which-component
description: Recommend existing shell/form components for a described UI need. Advisory only — use during design discussions about new additions, before any code is written.
---

# Which component

Given a described UI need (a new page, panel, modal, form, list, table, preview…), recommend what to build it from. This skill makes **no edits** — it produces a recommendation.

## Procedure

1. Read `.claude/rules/code-reuse.md` and map the described need onto its decision guide.
2. Confirm against the actual component source in `pwa/src/components/` (shell/ and forms/) that the recommended component's props cover the need.
3. Find 1–2 existing pages in `pwa/src/pages/` that already use the component that way and cite them as the pattern to copy.
4. Classify the need as exactly one of:
   - **(a) Covered as-is** — name the component(s) and the props/config to use.
   - **(b) New prop on an existing component** — name the component and sketch the prop. This is a framework change: it is built here in manuSpine and reaches forks via merge.
   - **(c) Genuinely new component** — justify why no prop can express it, and say whether it is shell-generic (belongs here) or domain-specific (belongs in a fork, not in manuSpine).
5. When run in a fork: if the need is not covered locally, check upstream manuSpine (`/home/cabsman/Documents/projects/manuSpine`) first (CLAUDE.md "Source of truth") and prefer its pattern.

Answer in prose with the classification up front. Do not start implementing.
