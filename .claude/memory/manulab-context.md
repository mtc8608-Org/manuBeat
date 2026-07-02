---
name: manulab-context
description: What ManuLab is, manuSpine's role as its OSS foundation, the body-analogy app family, and the bigger federated-research vision
metadata:
  node_type: memory
  type: project
---

# ManuLab / ManuSpine context

**manuSpine** (this repo, `git@github.com:mtc8608/manuSpine.git`) is the open-source full-stack template extracted from **ManuLab** (cabeleira.net), Manuel's personal platform built on his biomedical engineering background. manuSpine is the reusable scaffold (auth, component tree, surveys, CMS, shell components); each app forks it and adds a domain (see [[sibling-apps]]).

## Body-analogy app family
All ManuLab apps are named after organs and all run on manuSpine:

| Name | Purpose |
|------|---------|
| **ManuSkin** | Portfolio / content (outer layer, what the world sees) |
| **ManuLobe** | Finance / investment (decision-making, risk, planning) |
| **ManuPulse** | Clinical surveys and forms |
| **ManuBeat** | Cardio simulation, cardiopulmonary modelling, HDF5 runs, bedside telemetry |
| **ManuCortex** | AI features (reserved, not yet built) |

**manuHunter** (job-search app: jobs, applications, LaTeX CV builder) is a sibling of these — not an organ, but built on the same framework and currently the most active fork; its generic improvements flow back here (see [[framework-upstream-candidates]]).

## Bigger vision
manuSpine being generic and public is a prerequisite for splitting cabeleira.net into separate repos and for a Cardano Catalyst Fund16 grant. The long-term ManuLab vision is a federated clinical-research platform with patient-sovereign health data (Cardano: Aiken contracts, Identus DIDs, Hydra micropayments, Midnight ZK proofs). That vision is manuBeat/ManuLab territory, but it explains why this framework must stay generic and domain-free.

**Why this matters here:** everything in manuSpine is shared by every fork. Nothing domain-specific may land in this repo; framework fixes are made here and flow down via merge (CLAUDE.md "Framework downstream").
