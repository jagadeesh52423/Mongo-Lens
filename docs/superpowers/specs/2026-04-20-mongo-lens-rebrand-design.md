# Mongo Lens Rebrand Design

**Date:** 2026-04-20  
**Status:** Approved

## Overview

Rebrand the app from "MongoMacApp" to "Mongo Lens", replace logos with new assets, and add a 1-second splash screen on app open.

## Assets

- `~/Downloads/logo_only.svg` — icon without text, used everywhere except splash
- `~/Downloads/logo_with_text.svg` — icon + "MongoLens" + "MONGODB EXPLORER" subtitle, used only on splash screen

## 1. App Name Rename

Replace `"MongoMacApp"` → `"Mongo Lens"` in the following files:

| File | Field |
|------|-------|
| `package.json` | `name` → `"mongo-lens"` |
| `src-tauri/tauri.conf.json` | `productName`, `title` |
| `src-tauri/Cargo.toml` | `name`, `description`, `authors` |
| `index.html` | `<title>` |
| `src-tauri/src/main.rs` | error message string |

**Internal data paths left unchanged** (`~/.mongomacapp/` dir, `mongomacapp.sqlite`, runner dir) to avoid breaking existing user data.

## 2. Logo Update

- Copy `~/Downloads/logo_only.svg` → `public/logo.svg` (replaces existing)
- Copy `~/Downloads/logo_with_text.svg` → `public/logo_with_text.svg` (new file)
- `src/components/layout/IconRail.tsx` already references `/logo.svg` — no component changes needed

## 3. Splash Screen

### Component: `src/components/layout/SplashScreen.tsx`

- Full-screen overlay: `position: fixed`, `inset: 0`, `z-index: 9999`
- Background: `#001E2B` with `radial-gradient(ellipse at center, rgba(0, 237, 100, 0.12) 0%, #001E2B 65%)` for subtle green glow
- `logo_with_text.svg` centered via flexbox, width ~200px
- Animation: CSS keyframes — fade in 200ms → hold 600ms → fade out 200ms (total ~1000ms)
  ```css
  @keyframes splashAnim {
    0%   { opacity: 0; }
    20%  { opacity: 1; }
    80%  { opacity: 1; }
    100% { opacity: 0; }
  }
  animation: splashAnim 1000ms ease forwards;
  ```
- On `animationend`, calls `onDone()` callback to unmount

### Integration in `src/App.tsx`

```tsx
const [showSplash, setShowSplash] = useState(true);
// ...
{showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
```

## 4. App Icons

Generate all required Tauri icon formats from `~/Downloads/logo_only.svg` using macOS built-in tooling:

1. Export PNG sizes via `rsvg-convert` (or `sips` fallback):
   - 32×32 → `src-tauri/icons/32x32.png`
   - 64×64 → intermediate for iconset
   - 128×128 → `src-tauri/icons/128x128.png`
   - 256×256 → `src-tauri/icons/128x128@2x.png`
   - 512×512 → `src-tauri/icons/icon.png`
2. Build `icon.iconset/` and run `iconutil -c icns` → `src-tauri/icons/icon.icns`
3. Generate `src-tauri/icons/icon.ico` via ImageMagick `convert` (if available), combining 16/32/48/256 sizes

## Files Changed

| File | Change |
|------|--------|
| `package.json` | name rename |
| `src-tauri/tauri.conf.json` | productName, title rename |
| `src-tauri/Cargo.toml` | name, description, authors rename |
| `index.html` | title rename |
| `src-tauri/src/main.rs` | error string rename |
| `public/logo.svg` | replaced with logo_only |
| `public/logo_with_text.svg` | new file |
| `src/components/layout/SplashScreen.tsx` | new component |
| `src/App.tsx` | mount SplashScreen |
| `src-tauri/icons/*` | regenerated from logo_only.svg |
