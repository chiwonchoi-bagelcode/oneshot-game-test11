# Inkbloom (물들임)

A portrait mobile puzzle game about timing ink. Tap an empty spot to drop ink; every beat it spreads
one cell. When two colours reach the same cell **on the same beat**, they mix. Choosing *where* and
*when* to drop decides where colours meet — that is how you paint each target picture.

The original prototype lives in `reference/` (kept for comparison only).

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (dev build: debug panel on the left edge)
npm run build        # type-check + production bundle in dist/ (no debug panel)
npm run preview      # serve dist/
```

## Store builds (Capacitor)

`capacitor.config.json` is ready (app id `com.bagelcode.inkbloom`, portrait, paper-coloured splash).

```bash
npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/ios @capacitor/android @capacitor/haptics @capacitor/app
npm run build
npx cap add ios && npx cap add android
npx @capacitor/assets generate --assetPath resources   # icons + splash from resources/
npx cap sync
```

Lock orientation to portrait in Xcode / AndroidManifest. The game already uses Capacitor's Haptics
and App (`backButton`) plugins when present and falls back to web APIs otherwise.

**Placeholders to connect before release**
- Payments: `src/services/iap.ts` → `charge()` (product ids/prices are in `src/config/balance.ts`).
- Rewarded ads: `src/services/ads.ts` → `playAd()` (daily caps already enforced).
- Privacy policy / terms links in Settings.

## Where to tune things

| What | File |
| --- | --- |
| Tempo, rewards, prices, ad caps, daily/streak rewards, store products, cosmetics | `src/config/balance.ts` |
| Chapters (order, accent colours, mechanics) | `src/levels/chapters.ts` |
| Levels (generated, verified) | `src/levels/data/*.ts` via `npm run levels:gen` |
| All text (Korean / English) | `src/i18n/strings/*.ts` |

## Levels

- `tools/gen-levels.ts` builds the 8×30 campaign and the daily pool (seeded, reproducible).
- `npm run levels:verify` re-plays every stored solution through the same simulation the game uses,
  checks the mechanic schedule, board sizes, and measures random/greedy-bot success so no level can be
  solved by tapping without thinking. Report: `tools/level-report.md`.
- `node tools/e2e/run.mjs levels` plays every level inside the real game loop (autoplay).

## Debug panel (dev builds only)

Bug tab on the left edge: grant coins/hints/rewinds, unlock or clear levels, solve/autoplay the current
level, move the calendar a day forward/back (daily puzzles, streaks, ad caps), simulate a notch and home
indicator, switch language, reset the save. `window.__ink` exposes the same for automated tests.

## Architecture

```
src/core        simulation (pure, shared with tools), level transforms, RNG
src/levels      chapter list, level pack access, generated data
src/state       save/load (versioned + backup), store, economy, progress, daily
src/render      board renderer (canvas), skins, colour-blind glyphs, chapter paintings, logo
src/audio       procedural music + SFX (WebAudio), lifecycle (background/resume)
src/ui          design system (styles.css), popups, router, wallet, rewards, icons
src/screens     title, journey, chapter, play (+results), daily, gallery, shop, settings
src/services    ads / IAP placeholders, haptics + sound feedback
src/debug       dev-only panel
tools           level generator/verifier, e2e runner
```
