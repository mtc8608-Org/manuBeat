---
paths:
  - "pwa/src/pages/**"
---

# Page code conventions

Every page file follows a fixed structure, defined by manuSpine (see CLAUDE.md "Source of truth"). Apply from the start on new pages; do not deviate.

## Section order inside a page file
```
// File header (3-line comment block)
imports
module-level helpers (HELPERS banner, if any)
component function {
  REFS banner + useRef      (if any)
  STATE banner + useState
  LOAD banner + useEffect / data fetch functions
  [page-specific section banners + handlers]
  HANDLERS banner + event handlers (if not split into named sections)
  RENDER banner
  return ( <SplitPageLayout|SinglePanelLayout ...> {/* Modals */} </...> )
}
```

## Figlet ASCII banners (major code sections)
Every major section inside a page file gets a `/* ... */` block of block-character ASCII art, at column 0 (no indentation), generated with:
```bash
npx figlet-cli -f "Block" -w 200 "SECTION NAME" | sed 's/[_|]/█/g'
```
Standard names, reused exactly with the same art across all pages: `HELPERS`, `REFS`, `STATE`, `LOAD`, `HANDLERS`, `RENDER`. Page-specific names (`TREE`, `LIBRARY`, `NEW PAGE`, `PREVIEW`, etc.) are reused across pages where the concept matches. Never invent a new section name when an existing one covers the concept.

## JSX region comments (inside the return)
Every named group of JSX (a component, a panel, a modal block) gets a 2-line `═` box comment:
```jsx
{/* ═══════════════════════════════════════════════════════════
     Label                                                      */}
<ComponentHere ... >
```
- Line 1: `{/* ` + 59 `═` chars. Line 2: 5 spaces + label, closed by `*/}`. Indentation matches the surrounding JSX.
- Reuse standard labels exactly: `Component list`, `Survey list`, `Pages list`, `Cards library`, `Asset list`, `Actions`, `Edit form`, `Chart`, `Metadata`, `Description`, `Preview`, `Fill form`, `Answers`, `Build`, `Modals`. Every `ModalShell` block uses the label `Modals`.

## File header (3-line comment)
```typescript
// Page: PageName — one-line description.
// Reads/writes: what tables / services this page touches.
// Auth requirement (Authenticated / Admin-only / Public).
```

Naming conventions: React components PascalCase; functions/variables camelCase; constants UPPER_SNAKE_CASE (in `constants.ts`); GraphQL queries/mutations camelCase; DB tables/columns snake_case. See `page-template.md` for the SplitPageLayout left-column rules.
