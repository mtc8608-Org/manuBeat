---
name: mobile-app-path
description: Capacitor was removed 2026-07-04 as unused scaffolding — how to re-add native iOS/Android support if a ManuLab app ever needs it
metadata:
  node_type: memory
  type: project
---

# Mobile app path (Capacitor removed 2026-07-04)

The pwa carried Ionic-starter Capacitor scaffolding (`@capacitor/core` + 4
plugin packages + `@capacitor/cli` v4, `capacitor.config.ts`, an integration
entry in `ionic.config.json`) that was never used: no `ios/`/`android/`
projects, zero imports in manuSpine or any fork. Removed during the 2026-07-04
dependency-policy work — its stale v4 CLI carried high-severity `tar`/`xml2js`
advisories and unused deps are pure maintenance liability.

**The PWA path already covers most mobile needs**: Ionic UI is mobile-first
and the app is installable from the browser (add-to-home-screen). Native
packaging is only needed for app-store distribution or native device APIs
(push notifications, background exec, deep hardware access).

**To re-add native support** (in the fork that needs it, not the framework,
unless every app goes native):

```bash
cd pwa
npm i @capacitor/core && npm i -D @capacitor/cli
npx cap init <appName> <appId> --web-dir=dist   # recreates capacitor.config.ts
npx cap add ios && npx cap add android           # native projects
npm run build && npx cap sync                    # copy web build into them
```

Then restore `"capacitor": {}` under `integrations` in `ionic.config.json`
and add whichever plugin packages are actually used (`@capacitor/app`,
`@capacitor/keyboard`, …) at the then-current major — do not resurrect the
old pinned v4 list. Device-API calls should be wrapped in
`Capacitor.isNativePlatform()` guards so the same code keeps working as a
served PWA.
