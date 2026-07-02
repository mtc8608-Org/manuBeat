---
paths:
  - "pwa/src/pages/**"
---

# SplitPageLayout left-column template rules

The left column of every page has five non-negotiable rules. In the reference project these were corrected multiple times across pages; apply them from the start on every new page — here and in every fork. See `code-reuse.md` and `page-structure.md`.

**Why:** the template is mandated. Deviating causes inconsistent UI and repeated correction work.

```tsx
<SplitPageLayout
  leftTabs={[{                 // always leftTabs, never left={<TabPanel .../>}
    label: 'List Name',
    actions: <IonButton ...>Action</IonButton>,   // buttons ONLY, no error text
    content: (
      <>
        {error && <IonText color="danger">...</IonText>}  // errors in content, not actions
        <ResourcePanel
          fetcher={fetchItems}          // always fetcher + refreshToken, never data={array}
          refreshToken={String(version)}
          config={PANEL_CONFIG.XYZ}
        />
      </>
    ),
  }]}
  hidden={<input ref={...} />}   // always-mounted invisible DOM goes in hidden
  ...
/>
```

The five rules, enforced together:
1. Always pass `leftTabs={[...]}`. Never `left={<TabPanel .../>}` or a bare `<ResourcePanel>`. `SplitPageLayout` renders the `TabPanel` internally. Use the `left: ReactNode` escape hatch only for a controlled TabPanel needing `activeTab`/`onTabChange` (rare).
2. `ResourcePanel` always uses `fetcher` + `refreshToken`. Never the `data={array}` prop.
3. `actions` is for buttons only. Error messages and non-interactive elements go inside `content`.
4. Hidden DOM nodes (file inputs, invisible refs, library TreeEditors) go in `SplitPageLayout`'s `hidden` prop.
5. **ResourcePanel item slot budget.** `IonLabel` is the only flexible element in a list item; every start/end-slot element (icon, badge, badge stack, Delete button) is fixed-width and steals the label's space. In the narrow left column, exceeding the budget collapses the label to zero width — the name *disappears* and the item stretches tall (text wraps char-by-char). Budget: at most **one** end-slot extra beside the Delete button — a single badge, or a stacked badge *array* only when there is no `onDelete`. With `onDelete` present, skip `getIcon` and never pass a badge array. Symptom to recognise: badges and Delete render, names blank, items abnormally tall (this bit manuHunter's Users page and again its Roles page).

`rightHeader` is an always-present zone (renders an empty bordered strip when undefined); use it only for page-level controls (bulk ops, mode toggles, save state), never to create a list item (that is `ResourcePanel`'s `onAdd`). Set `keepMounted` on a tab whose content holds a `useRef` other tabs access.

`SinglePanelLayout` (pages without a list) follows the same contract: pass `tabs={[...]}` (never a raw node), `hidden` for always-mounted DOM, and `header` for page-level controls (the single-column equivalent of `rightHeader`, same "never for creating list items" rule).
