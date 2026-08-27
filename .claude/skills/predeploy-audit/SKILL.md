---
name: predeploy-audit
description: Fan out a full pre-deployment audit before an app goes internet-facing — backend auth-surface gate plus a deployment-config sweep — and consolidate the findings into .claude/memory/pre-deployment-todo.md. Use before a deploy, after a pull-upstream merge, or when asked to re-check deployment readiness.
---

# Pre-deployment audit

Runs two independent audits in parallel over the whole repo, then merges them
into one prioritized TODO. Scope split so the agents never overlap: one owns the
**auth surface**, the other owns **everything else that must change before
internet-facing**. Every ManuLab app targets served multi-user
([[served-multi-user-plan]]) — audit for that even while dev is single-user.

## Steps

1. **Read context first**
   - `.claude/memory/pre-deployment-todo.md` if it exists — a prior run's
     findings; you are updating it, not starting fresh. Note which items claim
     to be fixed so this run confirms or reopens them.
   - `.claude/memory/served-multi-user-plan.md` — the lens every finding is
     framed through.
   - `.claude/memory/framework-upstream-candidates.md` — so the run knows which
     findings are already queued as **Pending** or have **Landed**, and does not
     re-raise settled work.

2. **Launch both agents in one message** (parallel, background):

   - **Auth surface** — `exposure-auditor` subagent. Prompt it to gate the full
     backend auth surface for internet-facing served-multi-user: every GraphQL
     op in the correct `permissions.js` tier; owner-scoping on every
     registered/user-tier op; every REST handler opening with an auth guard
     (and the guard sitting *before* multer on multipart routes); no tokenless
     endpoints beyond the intentional set (login / register / the two download
     streams); the permission gate enforcing every top-level field; file
     upload/download owner-scoping; the `user_secrets` keychain write-only
     invariant. Tell it to cover **every domain present in this repo**, not
     just the framework — here that means `bedside/`, `medical/` and `surveys/`:
     telemetry ingest and device-token routes, the WebSocket monitor, bed
     assignments and patient files, the cardio compute endpoints, and the survey
     stats/export pair. Ask for findings marked **BLOCKER / SHOULD-FIX /
     OK-noted** with `file:line`.

   - **Deployment config** — `general-purpose` subagent. Tell it explicitly
     **not** to audit GraphQL/REST auth (the other agent owns it) and to cover:
     secrets/credentials injection (JWT, DB, MinIO, admin seed — dev defaults
     that could silently ship); CORS / helmet / security headers / introspection
     / error-leakage in Express and the Caddy template; docker prod-readiness
     (`docker-compose.prod.yml` vs dev, published ports, `NODE_ENV`, `./run`,
     `deploy/`); upload / body-size / rate limits (especially `/login`,
     `/register`, and any compute endpoint); dev leftovers (debug flags, seeded
     personal data, security TODOs); dependency health (EOL/CVE deps, audit
     story); MinIO exposure; HTTPS / localhost-hardcoding / service-worker
     caching. Ask for **BLOCKER / SHOULD-FIX / NICE-TO-HAVE** with quoted
     `file:line` evidence.

3. **Consolidate** into `.claude/memory/pre-deployment-todo.md` — checkbox list
   grouped BLOCKER → SHOULD-FIX → NICE-TO-HAVE, each with `file:line` and a
   one-line fix. Merge overlapping findings (both agents may hit the file routes
   — state it once). Keep a "Verified clean (no action)" section so a later run
   does not re-litigate settled items. Mark any prior finding that is now fixed
   as done; reopen any that regressed. Convert relative dates to absolute; date
   the run. Update the `MEMORY.md` pointer line if the blocker set changed.

4. **Report** the consolidated list to the user, blockers first, with the file
   path. Do **not** fix anything — this skill is advisory; the user drives fixes.

## Notes

- The TODO file is **gitignored in manuSpine** (a public framework repo should
  not publish a live list of its own unfixed holes). Committing it is a per-repo
  call, not a framework rule — this fork's `.gitignore` carries no exclusion for
  it, so its copy commits with the repo.
- A finding in **framework** code is not this fork's to patch locally: fix it
  upstream in manuSpine so every app gets it, then pull it down (CLAUDE.md
  "Framework upstream"). Patching framework code here creates exactly the drift
  [[fork-verbatim-surface]] exists to prevent. Findings in `bedside/`,
  `medical/`, `surveys/` and the rest of this fork's domain code are ours to fix
  here.
- This is a **static** audit (reads code). It does not exercise a running
  instance — no live XSS/IDOR/rate-limit reproduction. Dynamic pen-testing
  against a staging URL is a separate, post-deploy tool.
- Frame every finding for multi-user even though dev is single-user; a
  single-user shortcut is itself a finding.
- Re-run after every `pull-upstream` merge — a framework change can silently
  move an op out of its tier or reopen a scoping hole.
