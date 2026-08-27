---
name: echart-owned-wrapper
description: Charting decision 2026-07-04 — echarts engine stays a dependency, the React glue is the owned EChart shell component; echarts-for-react removed; manuBeat migration pending
metadata:
  node_type: memory
  type: project
---

# EChart: the chart glue is ours, the engine is not

Decided 2026-07-04 during the dependency-policy work. `echarts-for-react`
(the third-party React adapter) was removed and replaced by the owned
component `pwa/src/components/charts/EChart.tsx`; the echarts **engine**
stays a direct dependency, bumped to `^6` (clearing the XSS advisory
GHSA-fgmj-fm8m-jvvx that the adapter blocked).

**Why**: the adapter was ~200 lines of init/setOption/resize/dispose glue,
effectively unmaintained, and peer-locked to echarts ≤5 — it structurally
blocked every engine upgrade. Glue this small is cheaper to own than to
inherit stale: echarts' init/setOption/resize/dispose surface has been
stable across majors 3→6, so realistic maintenance is near zero. The
engine itself (rendering, chart types — Apache-maintained) is exactly what
we do NOT want to own. Manuel decided this explicitly and owns the wrapper.

**Contract**: `<EChart option={...} height? theme? notMerge? className?>`
— the echarts options object passes straight through to `setOption`.
`notMerge` defaults to false (merge), matching echarts-for-react's default,
so migrated call sites keep their update semantics (relevant for streaming
charts). Lives in `components/charts/` (folders are by function: shell =
layout, forms = data entry, content = CMS cards, routing = guards, charts =
charts). Registered in `code-reuse.md`'s decision guide, CLAUDE.md, and the
seeded dev-guide components overview.

**Fork impact — pending**: manuBeat is the only chart consumer
(3 pages: `bedside/Monitor.tsx`, `models/HdfInspector.tsx`,
`models/Simulator.tsx`, each `import ReactECharts from 'echarts-for-react'`).
On its next pull-upstream merge it must swap those imports to
`components/charts/EChart` (prop `option` is the same; `ReactECharts`'
`style`/`opts` extras, if used, map to `height`/`className`) and drop
`echarts-for-react` + bump `echarts` in its own package.json. Verify the
three pages render, especially Monitor's streaming updates. manuHunter is
unaffected (no charts).
