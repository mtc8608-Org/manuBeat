---
name: flag-upstream
description: Record a framework-generic change built in a fork as an upstream-port candidate in framework-upstream-candidates.md. Use in a fork (manuHunter, manuBeat, …) right after building something reusable, or when asked to "flag this for upstream".
---

# Flag a change for upstream

Runs in a **fork**. manuSpine is the upstream framework; anything framework-generic built in a fork must eventually be recreated there so every derived app gets it (CLAUDE.md "Framework downstream"). This skill writes the port-list entry that makes that later port cheap. The port itself is the `port-upstream` skill, run in manuSpine.

## When to flag

Flag a change if it would make sense in a fresh fork with a different domain: shell components and props, form field types, framework tables/resolvers/routes, auth/permission mechanics, build infra. Do **not** flag domain features, domain seeds, or app-level form shapes — those stay in the fork.

Gate check before writing the entry — the change is only generic if:
- it imports nothing from domain code (`pages/<domain>`, domain resolvers/routes, domain constants);
- its names and copy contain no domain terms (or the entry lists them under Strip);
- it lives in (or belongs in) a framework location: `pwa/src/components/`, `nodejs/{lib,schema/resolvers/framework,routes/framework}`, `init-scripts/01-init-db.sql`, service Dockerfiles.

If only *part* of the change is generic (e.g. a mechanism minus its domain payload, like a cache-mount pattern minus domain packages), flag the mechanism and say exactly where the domain line is.

## Where the entry goes (single source of truth)

The port list is the **upstream clone's** copy: `<manuSpine local path>/.claude/memory/framework-upstream-candidates.md`. Resolve the manuSpine path from this fork's CLAUDE.md "Framework upstream" section — never hardcode it. Write there directly (both clones live on this machine); the consumer is the upstream porter, and a single file avoids two-copy drift. If the fork has its own stale copy of the file, leave it — `pull-upstream` reconciles it at merge time. Only if the upstream clone is missing locally, append to the fork's own copy and say so.

## Entry template (strict)

Append to the **Pending** section, converting relative dates to absolute:

```markdown
- **<Title> (<YYYY-MM-DD>)** —
  Where: <files/paths in this fork; line refs for small changes>
  What: <behaviour summary detailed enough to recreate from this entry + a diff — props added, cases added, DDL, seed ID ranges, localStorage keys, error codes handled>
  Strip: <domain residue the porter must remove or reword: comments, seed descriptions, op names in lists, package-list items — "none" if clean>
  Decisions: <choices deliberately left open for port time, e.g. "generalise X behind a prop first", "consider variant Y" — "none" if the port is verbatim>
  Depends: <other entries, exports, or tables this needs; implied port order — "none">
```

Quality bar: an entry that just names the feature is a bug. The `port-upstream` run may happen months later, in a different session, by someone who has never seen the code — Where/What must carry the intent, Strip and Decisions must carry the judgment calls you already made.

## After writing

- If the new entry supersedes or extends an existing Pending entry, merge them instead of duplicating.
- No commit rules beyond the repo's normal git style; the entry travels with whatever commit is in flight or its own small one.
