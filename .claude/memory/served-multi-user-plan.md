---
name: served-multi-user-plan
description: All ManuLab apps built on manuSpine are single-user today but planned to be served as multi-user — never take single-user shortcuts in design
metadata:
  node_type: memory
  type: project
---

# Single-user now, served multi-user later

As of July 2026 every ManuLab app built on manuSpine (manuHunter, manuBeat, ManuSkin, ManuLobe, ManuPulse, …) has one real user (Manuel), but the plan is to serve them all as multi-user apps.

**Why:** "it's just me" is never a valid argument in design discussions, in the framework or in any app forked from it. Choices that only work single-user (server env-var API keys, global unscoped state, skipping `owner_id` scoping, admin-only gates standing in for per-user permissions) become migrations later in every fork.

**How to apply:** when weighing options, pick the multi-user-safe shape even if a single-user shortcut is simpler today: owner-scope domain data, keep user settings/secrets per user, and keep self-service user-writable surfaces isolated from the auth-critical `users` table.
