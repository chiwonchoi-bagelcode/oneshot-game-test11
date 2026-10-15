# Inkbloom core comparison — shared brief

The original Inkbloom (물들임) is a charming puzzle but too hard: players must pick *where* and
*when* to drop ink at the same time. We are building **five versions with different cores** on the
same game shell so the client can install each one fresh, play it like a new player, and pick the
direction most likely to make first-time players come back the next day (D1R).

Every version keeps the same look: title, journey, chapter screen with the Dawn Pond painting
(one region per stage), board renderer (watercolour ink, paper, mixing bloom, win animation),
sounds, result sheet, seals, coins/hints, shop, daily, gallery, settings. **Only the core differs.**
Do not restyle anything to make one version prettier than the others.

## Scope per version

* Exactly **30 stages, tutorial included** (stage 1–3 usually teach). No stage 0, no stage 31+.
* A first-time player knows nothing about the original or other versions: teach this version's
  controls and goal through play. One new idea at a time, practised before it's combined.
* Make the first day as attractive as possible *for this core*: quick first success, then the joy
  of using what you learned, then small discoveries. No padding (same board with new numbers).
* Difficulty doesn't need to match other versions; polish (tutorial, levels, feedback) should.

## Architecture (read these files first)

* `src/play/core.ts` — the `Core` interface and `CoreHost` (what the shell gives you).
* `src/screens/play.ts` — the shell: boosters (restart / undo-or-rewind / hint), fail & result
  sheets, intro rule cards, guide hand (`host.guide`, with `path` for drag demos), pause/menu.
* `src/play/timing-core.ts` — the original rules as a core (beat clock, grace window, hints,
  rewind, guided tutorial). Cores D and E **subclass** it.
* `src/core/sim.ts` — `Sim` (board state the renderer reads: `ink`, `mixed`, `born`, `from`, `src`,
  `seed`, `waves`, `tick`, `pi`, `drops`, `L`), `LevelDef` (now with `wells`, `regions`,
  `strokes`, `mud`, `coach`, and `Drop.k` / `Drop.c`), `parseLevel`, `runSolution`.
* `src/render/board.ts` — `BoardRenderer`. Useful calls for non-timing cores:
  `setSim`, `replaceSim`, `invalidate()` (after mutating sim arrays yourself), `onDrop(idx,c)`,
  `onStep(events)` (fill/mix events animate growth from `from` and the mix bloom — bump
  `sim.tick` and set `born[idx] = sim.tick` for cells you colour), `onTargetMet`, `onReject`,
  `showWrong`, `setGhosts`, `setOverlay(fn, live)` (draw your own marks every frame:
  paths, wells, region outlines, forecasts — use `api.color(c)` so skins apply),
  `setGoalStyle(cells|null)` (picture-style goals: colour wash everywhere, ring + check only on
  the listed cells; `[]` = wash only), `cellAt`, `cellRect`. The shell calls `playWin`.
* `src/ui/rule-diagrams.ts` — `registerDiagram(key, () => ({ boards: TimelineBoard[] }))` for
  rule cards / rules book (cells list ink blobs with appearance times; `outline` draws region
  borders).
* `src/levels/pack.ts` — a variant build is one chapter of `src/cores/<x>/levels.ts`; daily
  puzzles are re-skinned copies of your stages 6–30 (keep `intro` keys accurate).
* `src/variant.ts` — `CORE`, save slot per version, whether the core has a beat clock / rewinds.
* `src/cores/<x>/core.ts` (export `createCore(host)`), `levels.ts` (`LEVELS`), `strings.ts`
  (KO/EN: `mech.<key>.title/.body` for every intro key, coach lines, tray labels).

### Contract details

* Win: call `host.win()` once the board is final (after your animation). Fail (if your core has a
  fail state): `host.fail(cells, mainText, tipText)`.
* Seal (first-try stamp): the shell voids it on restart-after-moves, hint, undo/rewind, fail.
  Call `host.voidSeal()` yourself for core-specific take-backs (lifting a drop, clearing a stroke,
  erasing). Normal in-gesture corrections (backtracking while dragging) are free.
* Hints: the shell charges and records it; your `showHint()` displays it (ghost marks / ghost
  paths) and `hintShowing()` reports it. Guided stages (`guided: true`) show the solution for free
  with the hand (`host.guide`).
* Rule cards: a stage with `intro: '<key>'` shows the card the first time (from stage 2 on).
  Prefix your keys with your core letter (`a_mix`, `b_cross`, …) so builds never collide.
* `state()` must include `phase` ('idle' | … | 'won' | 'lost'); `autoplay(now)` must play the
  stored solution through your own input path; `solveNow()` jumps to solved.
* Booster `undo`: `'undo'` (free, icon undo) for take-back cores, `'rewind'` (paid item) for
  timing cores, or `null`. Don't leave buttons that do nothing in your core.

## Rules for working in parallel

Five agents work at the same time. **Only edit your own folders**: `src/cores/<x>/`,
`tools/cores/<x>/`, and new files you create there (CSS files imported from your `core.ts`).
Do **not** edit shared files (`src/screens/*`, `src/play/*`, `src/render/*`, `src/ui/*`,
`src/core/*`, `src/levels/*`, `src/i18n/*` except via your `strings.ts`, `src/state/*`,
`src/config/*`, `tools/e2e/*`). If something shared truly blocks you, work around it in your
folder (subclass, overlay, wrap) and describe the needed change in your final report.
`npx tsc --noEmit` covers the whole repo; other agents' half-finished files may error — filter to
your paths. Never commit; never touch git state.

## Quality bar (the client checks all of this)

* Phone portrait, one hand, 360×780 and 390×844, notch on (`window.__ink.notch(true)`).
* Buttons/tray items ≥ 48 px, never long-and-thin; nothing overlaps or overflows in KO or EN;
  the finger and UI must not hide the important part of the board while playing.
* Copy: natural friendly game voice (KO 해요체), short, specific; no AI-ish phrasing, no jargon,
  no emoji anywhere.
* Colour-blind: everything must work with `settings.symbols` (glyphs from `src/render/glyphs.ts`).
* Low-end phones: draw only what changes; no heavy per-frame work beyond small overlays.

## Verification you must do (not just "the solver says ok")

1. A Node verifier (`tools/cores/<x>/verify.ts`, run with `node`) that checks every stage with the
   same rules the game uses: solvable by the stored solution, sizes, intro schedule, and a
   difficulty/"mindless play" metric suited to your core (e.g. random-play success rate).
2. In the real game build (`tools/e2e/core-lib.mjs`: `openCore('<x>')`), **play every one of the
   30 stages through real touch input** (CDP touch taps/drags at cell centres, real tempo for
   timing cores) from a fresh install, in order, and check each is won. Also run `autoplay`.
3. Play the first-time flow yourself with screenshots (title → stage 1 tutorial → … at least
   stages 1–10 and every rule card, plus a few later stages) and **look at them**. Fix whatever is
   confusing, boring, ugly or broken, then re-test. Iterate on rules and levels, not just code.
4. Check restart, undo, hint (buy with coins when out), pause/menu, fail (if any), result sheet,
   and app reload mid-progress in your build.
5. KO and EN at 360 px: your tray, coach lines, rule cards.

Report at the end: final rules, what changed vs the original, the 30-stage learning/difficulty
table (stage → new idea / purpose), what you verified and how, screenshots paths, open issues and
any shared-file change you need.
