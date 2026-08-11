# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MagicHaqi (蛋蛋星球) is a mobile-first H5 virtual-pet game: pure ES Module + Vanilla JS that runs directly in the browser, backed by the KeepworkSDK for login, storage, AI image generation, and chat. There is **no application backend** — the live web page itself is the API.

## Working in this repo

🚫 **NEVER run `npm run build`, `vite build`, `npm run build 2`, or any bundle/compile command** to develop or to verify a change. The app does **not** need a build step — it runs straight from the browser.

To check your work: open `MagicHaqi.html` in a browser (VS Code Live Preview) or hit the local dev server. Do **not** start a server "to test"; Live Preview / opening the file is enough.

- `npm run dev` — Vite dev server (optional; prefer `127.0.0.1`/Vite URL over a raw `file://` URL so the SDK behaves and local SDK source resolves).
- `npm run build` / `npm run upload` — **human-only**, for CDN distribution packaging (`dist/`, `release/MagicHaqi_v1.html`, content-hashed CDN folders). Never run these for development or verification.
- There is **no test suite** and no lint config — do not look for `npm test`.

Standalone HTML files (`minigames/*.html`, `dev_tools/*.html`, `MagicHaqi.html`) are each self-contained and opened directly; they are copied verbatim at distribution time, not bundled.

## Architecture

**Single source of truth + render-on-mutate.** `js/state.js` holds all in-memory state (`user`, `currentPet`, `currentView`, `zoomLevel`, `currentField`, `currentRoom`, planet-management fields, etc.). The flow is:

```
view_*.js (DOM event) → state.mutate*() → storage.save() (debounced) → render(currentView)
```

- **`js/app.js`** — SDK bootstrap, the route table (`{login, petList, hatch, home, shop, inventory, chat, profile, settings, ...}`), and global events. It owns all orchestration.
- **`js/view_*.js`** — each view module *only* renders HTML and binds events. It must **not** read `storage` or call the SDK directly; it hands intent back to `app.js` via callbacks (`renderX(panel, data, callbacks)`).
- **`js/storage.js`** — the only adapter over `sdk.personalPageStore` (workspace `MagicHaqi`). Writes are debounced (~1s). Handles pet CRUD, `memory.md`, layouts, inventory, profile.
- **`js/api.js`** — wraps AI calls: DNA→prompt, `genImage`, `aiChat`.
- **`js/petTick.js`** — state decay / stage growth / sickness; ticks every 30s and back-computes offline elapsed time on load (per-tick decay capped at ~24h equivalent).

When adding a feature, follow the layering: state lives in `state.js`, persistence goes through `storage.js`, SDK access goes through `api.js`/`storage.js`, and views stay render-only with callbacks into `app.js`. Economy mutations go through `state.js` helpers (`addCoins`, `addBiofuel`) — never write `state.coins`/`state.biofuel` raw.

> **Reality check:** this strict layering holds for the core raising loop, but several later self-contained feature views (game maker, minigames, story, mailbox, encyclopedia, spacetravel) import `storage.js` / call `sdk.*` directly. That's tracked, intentional-to-revisit debt — see `docs/architecture.md` §3 (intent vs. reality) and §13 (debt register). Don't add *new* direct `storage`/`sdk` access in views without a reason; prefer the callback path.

### Four-level Zoom Dial (`js/level_*.js` + `view_home.js`)

`view_home.js` is the **orchestrator** for the main stage. It maintains `state.zoomLevel ∈ [0..3]` plus a continuous `cameraZoom`, listens to wheel / pinch / drag, and delegates all rendering and interaction to four level modules in `LEVELS = [planetLevel, fieldLevel, petLevel, cellLevel]`. Crossing a level's `minCamera`/`maxCamera` triggers `setLevel(±1)` with a wormhole transition (the transition lives in `view_home.js`, not the level modules).

| Level | File | Scope |
|-------|------|-------|
| 0 🌌 Space | `level_planet.js` | Rotating planet (tint from `dominantTraits`); planet-management loop: build/upgrade infrastructure, weather, interstellar visits, UFO, astrology buffs, milestones, Haqi Island entry |
| 1 🪐 Field | `level_field.js` | Land/water/air ecosystems; placed outdoor furniture + 💩 → ⛽ biofuel; weather visuals from level 0 |
| 2 🐾 Pet | `level_pet.js` | 5 rooms, 8×6 decoration grid, sprite wander, 5 interaction buttons (feed/play/wash/sleep/learn) |
| 3 🧬 Cell | `level_cell.js` | Inner-body view, DNA diet hints, egg-stage wishes |

Each level module exports a uniform interface: `id`, `index`, `minCamera`/`maxCamera`, `enterFromAbove`/`enterFromInner`, `stageHtml(pet)`, `dockHtml(pet)`, `bindStage(pet, ctx)`, `bindDock(pet, ctx)`, optional `onEnter`/`onLeave`/`onCameraChange`. To add a level: append to `LEVELS` and add a `CONFIG.zoomLevels` entry.

### DNA & breeding (`js/dna.js`)

DNA = 12 chars `[A-Z0-9]` in 3 segments. `decodeDna` maps each char to a Chinese trait; `crossover(a,b)` picks parent segments with ~5% per-char mutation; `dnaToPrompt` builds the `genImage` prompt. DNA generation and appearance generation are deliberately decoupled — DNA succeeds first so a failed image can be regenerated later.

### Persistence model

PersonalPageStore (workspace `MagicHaqi`), no localStorage for game data (localStorage only caches UI prefs like last view):
- `pets/<id>.json` — pet config; `pets/<id>.memory.md` (8KB cap, head-summary rotation) + `pets/<id>.chat.log`.
- `user/profile.json` — shared state incl. `petOrder`, `currentPetId`, `biofuel`, planet management fields (`planetWeather`, `planetBuff`, `planetInfrastructure`, `planetActions`, `planetVisitors`, `planetCreatedAt`, `totalPlayMs`).
- `user/inventory.json` (ordered array; legacy `{itemId: count}` is migrated on load), `user/layouts.json`.
- `agent/audit.log` (agent write audit), `agent/ops-*.{json,log}` (ops agent state).

### KeepworkSDK surface

Login (`sdk.token` → `sdk.loginWindow.open()`), `sdk.getCurrentUser()`, `sdk.personalPageStore.withWorkspace('MagicHaqi')` (readFile/createFile/replaceStringInFile), `sdk.aiGenerators.genImage`, `sdk.aiChat.createSession({systemPrompt, modId:'magichaqi', chatId: petId})`, `new DigitalHuman(...)` (VIP voice; instantiated only on click, destroyed on leave), `sdk.remoteLog?.track`. The SDK is loaded from CDN in `app.js`.

### Agent layer (page-as-API)

AI co-parent agents drive the **live site** instead of a REST backend, via three shortcuts: KeepWork login REST → URL navigation → an in-page command bridge.

- **`js/agentBridge.js`** — `window.MagicHaqiAgent.exec(cmd)` / `getState()`; command registry `COMMANDS` reuses existing view callbacks / `handleAction` / `storage` / `api` (does not change gameplay). Hidden DOM nodes `#mh-agent-cmd` (in), `#mh-agent-result` (out), `#mh-agent-state` (live snapshot, refreshed on render).
- **Deep links**: `?token=<t>`, `?adopt=1`, `?agent=<id>` (binds two-owner `agentOwner`), `?cmd=<urlencoded>`, `?view=ops`.
- **`js/agentAudit.js`** — logs write operations to `agent/audit.log`.
- **`js/view_ops_console.js`** — `?view=ops` human fallback dashboard.
- **`agents/`** — `pet-master/` (OpenClaw co-parent skill shipped to all users) and `haqi-operator/` (developer's 24/7 one-person-company ops agent).

## Conventions

- All player-facing UI text is Chinese (zh-CN) via `js/i18n.js` `t()`. Theme is a warm-orange, kids-oriented palette (`--accent: #f59e0b`, `--bg-base: #fef3c7`) reusing AIMovieMaker's CSS-variable system (`.btn-primary`, `.modal-input`, `.card-flat`, `.toast-*`, `.fade-in`).
- CSS is split by level: `css/planet.css` (L0), `css/field.css` (L1), `css/pet.css` (sprites). Tailwind comes from CDN.
- Decoration uses click-to-place (pick item → tap grid cell), **not** HTML5 drag, for mobile touch reliability. Layouts persist as `[{itemId, x, y, w, h}]`.
- `dev_tools/*.html` are generators (pets, planets, scenes, shop items, encyclopedia) that emit the JSON under `famous-pets/`, `famous-planets/`, etc.

See `docs/architecture.md` and `docs/design.md` for deeper detail. `AGENTS.md` is the Chinese-language counterpart of this file.
