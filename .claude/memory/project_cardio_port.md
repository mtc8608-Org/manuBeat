---
name: project-cardio-port
description: Active work to port CardioRespiratoryModelV2 (branch V2.3) into manuBeat as the medical/cardio domain
metadata: 
  node_type: memory
  type: project
  originSessionId: 91db35a6-a458-45f1-b626-1f0b185d1a62
---

The current main project goal is porting `git@github.com:mtc8608-Org/CardioRespiratoryModelV2.git` (branch `V2.3`) into manuBeat.

**Why:** This is the core domain logic for manuBeat — the cardiovascular/respiratory model that the platform is built around.

**How to apply:** When discussing new features, Python domain code, DB schema, or API routes for manuBeat, assume the source of truth for the model logic is the V2.3 branch of CardioRespiratoryModelV2. Suggest referencing that repo when implementing or reviewing cardio domain code.
