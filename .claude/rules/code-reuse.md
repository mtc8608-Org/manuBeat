---
paths:
  - "pwa/src/**"
---

# Component reuse rule (non-negotiable)

Always reuse existing components. Only create a new component if you need genuinely new behaviour that cannot be expressed through a new prop. manuSpine ships the shared `pwa/src/components/` shell library that every fork inherits — it is the pattern authority (see CLAUDE.md "Source of truth").

**Why:** duplicating patterns inline (hand-rolled modals, bespoke list panels, custom edit forms) creates maintenance debt and diverges from the standard every derived app is built on. This applies even for "quick" additions or one-off pages.

Before writing any new JSX:
1. Check the shell library first. If something covers the case, use it.
2. If it almost fits, add a prop to the existing component.
3. Only if the behaviour is fundamentally different do you create a new file.

## Decision guide (the single right choice for each need)

- Page layout — the rule is: **list needed → `SplitPageLayout`; no list → `SinglePanelLayout`.** Never hand-roll the IonPage/AppHeader/AreaShell/Grid boilerplate either way.
- Split-layout page → `SplitPageLayout` (wraps IonPage, AppHeader, AreaShell, Grid). Single-panel page (settings, account, any page without a list/detail split) → `SinglePanelLayout` (same shell, one centered column).
- Left-sidebar area nav (`SplitPageLayout` `navItems`) → one shared `AREA_NAV.<AREA>` list per area (like `AREA_NAV.BACKOFFICE`). Every page in the area passes the *same* list in the *same* order. Adding a page to an existing area reuses that area's list — never define a second per-page variant with the items reordered, or the sidebar reshuffles as you navigate between the area's pages (this is what a duplicated `AREA_NAV.JOBS` + `AREA_NAV.CV` caused in manuHunter).
- Both columns of `SplitPageLayout` are *always* a `TabPanel` — the left via `leftTabs` (see `page-template.md`), the right by passing `right={<TabPanel tabs={[...]} />}`. This is unconditional: a column with a single view is still a one-tab `TabPanel` (`<TabPanel tabs={[{ label: 'Detail'|'Preview', content }]} />`), never a bare fragment, `<IonCard>`, or raw node. `TabPanel` always renders the segment bar, even for one tab. `SinglePanelLayout`'s one column follows the same rule via its `tabs` prop — it has no raw-node escape hatch.
- "Create item" button on a list → `onAdd` on `ResourcePanel`, always, without exception. Never via `rightHeader`.
- Page-level controls above the right column → `rightHeader` (bulk ops, mode toggles, save state), never for creating list items.
- Tab-specific buttons → `actions` on the relevant `TabDef`.
- Any modal → `ModalShell`. Never a bare `IonModal > IonHeader > IonToolbar` block.
- Empty/unselected state → `EmptyState`.
- Any DB-backed list (sidebar, tab, or modal) → `ResourcePanel` with `fetcher` + `refreshToken`.
- Pick one item from the DB in a modal → `ModalShell` + `ResourcePanel` (no `onDelete`/`onAdd`) + confirm button. Never `IonSelect`/`IonRadioGroup`/hand-rolled list.
- Tabular data from any source → `DataTable` (source-agnostic `fetcher`).
- Display/preview a PDF (compiled or fetched) → `PdfViewer` (feed it a `Blob` or a `src` URL; it owns the object-URL lifecycle and falls back to `EmptyState`). Never hand-roll an `<iframe>`/`<embed>` + `URL.createObjectURL`.
- Configurable DB-driven form → `FormRenderer` (`mode='app'` dot-path keys, `mode='survey'` UUID keys). Add/edit modals use seeded form trees fetched by UUID, never bespoke field-state + conditional JSX.
- Tree add/edit/delete/reorder → `TreeEditor`. Never hand-roll add/edit/delete modal logic in a page.
- Any chart/plot → `EChart` (owned glue over the Apache ECharts engine; the echarts options object passes straight through). Never import `echarts` directly in a page and never re-add a third-party React wrapper (`echarts-for-react` was removed for peer-locking the engine to v5).
- Guard a route → `PrivateRoute` or `AdminRoute`.

See `page-structure.md` and `page-template.md` for how these are laid out inside a page file.
