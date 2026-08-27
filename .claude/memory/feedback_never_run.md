---
name: feedback_never_run
description: Never execute ./run (or docker compose); always end by stating which ./run command the user must run
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4b07ae86-bff2-4c89-be4f-72abb8bd8fe3
---

Never execute anything related to `./run` (or raw `docker compose`) yourself — not start, rebuild, reset, or down. Instead, **always end a task by stating which `./run` command the user needs to run** to apply the changes.

**Why:** the user controls the runtime/DB lifecycle; running it for them (especially `./run reset`, which wipes DB + MinIO) is destructive and theirs to trigger.

**How to apply:** after making changes, finish with an explicit line like "Run `./run reset` to apply" (reset for init-script/seed changes, `./run rebuild <service>` for Dockerfile/deps, plain `./run` otherwise). See CLAUDE.md "Running the project" for the command list.
