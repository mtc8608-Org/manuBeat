---
name: project-framework-upstream
description: manuSpine is the parent framework for manuBeat; upstream remote workflow for pulling framework updates
metadata: 
  node_type: memory
  type: project
  originSessionId: 91db35a6-a458-45f1-b626-1f0b185d1a62
---

manuBeat is derived from the manuSpine framework (`/home/cabsman/Documents/projects/manuSpine`, GitHub: `git@github.com:mtc8608/manuSpine.git`). Both repos share the initial commit `7515a54`.

The `upstream` remote is set up on manuBeat pointing to manuSpine. To pull framework updates:

```bash
git fetch upstream
git merge upstream/master
```

**Why:** Framework will keep evolving and all derived apps (manuBeat, etc.) must be able to pull updates cleanly. Cherry-picking individual commits does not scale — the upstream merge workflow is the correct approach.

**How to apply:** Never suggest cherry-pick for pulling framework changes into manuBeat. Always use `git fetch upstream && git merge upstream/master`.
