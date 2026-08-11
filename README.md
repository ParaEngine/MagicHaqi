# MagicHaqi

MagicHaqi is a mobile-first H5 virtual pet game built with vanilla JavaScript modules and the KeepworkSDK. Players hatch AI-generated pets, care for them across multiple zoom levels, decorate rooms and planets, collect resources, and build pet stories over time.

## Run

Open `MagicHaqi.html` directly in a browser, or run the local Vite server:

```bash
npm install
npm run dev
```

For the best SDK behavior, use `127.0.0.1` or the Vite dev URL instead of a raw file URL.

## Build & Deploy

The game ships as a single HTML entry served from keepwork.com, with all static
assets loaded from the immutable CDN (`cdn.keepwork.com`).

```bash
npm run build    # produce dist/ only
npm run upload   # build in upload mode, generate release/*.html, and upload dist/
```

`npm run dev` never writes `dist/` or `release/`. `npm run build` writes only
`dist/`. Files under `release/` are generated exclusively by `npm run upload`.

### `npm run build`

Vite builds the game into `dist/`:

- `dist/MagicHaqi.html` - entry HTML with relative asset URLs (`./assets/...`).
- `dist/assets/` - one hashed `.js` and one hashed `.css` bundle.
- Side-by-side dirs (`minigames/`, `famous-pets/`, `famous-planets/`,
  `pet-story/`, `dev_tools/`) and a couple of `docs/*.html` files are copied
  verbatim and fetched at runtime (not bundled).

### `npm run upload`

The upload command runs Vite with the dedicated `upload` mode, then
`uploadRelease.mjs` emits `release/MagicHaqi_v1.html` and its planet/view
variants. Each file is a clone of `dist/MagicHaqi.html` with a `<base>` tag
injected as the first child of `<head>`:

```html
<base href="https://cdn.keepwork.com/maisi/magichaqi/release/<hash>/">
```

`<hash>` is a content hash (sha256 of the entry HTML + JS/CSS bundles, first 12
hex chars). It is stable across identical rebuilds and only changes when the
build output changes, giving each publish its own immutable CDN folder. Because
the entry HTML uses relative URLs, the `<base>` tag makes every relative asset
and runtime `fetch` resolve against that CDN folder. Absolute URLs (Tailwind
CDN, CDN-hosted pet images) are unaffected.

`uploadRelease.mjs` then uses that `<base href>`,
derives the remote prefix (e.g. `maisi/magichaqi/release/<hash>/`), and uploads
every top-level entry under `dist/` to that CDN folder via the shared
`upload-deploy-cdn-files` skill (`qiniu_upload_local_files.py`). The CDN layout
then matches the relative URLs the release HTML expects.

Requires Python with the `qiniu` and `pyyaml` packages, plus valid
`qiniu.yaml` credentials resolved by the upload skill.

### Serving

Serve `release/MagicHaqi_v1.html` from keepwork.com with a no-cache header so
the latest published hash is always picked up:

```
Cache-Control: no-cache, must-revalidate
```

The CDN hash folder never changes, so its files can be cached long-term:

```
Cache-Control: public, max-age=31536000, immutable
```

Publishing a new build creates a new hash folder; pointing
`release/MagicHaqi_v1.html` at it is enough - no CDN purge is needed.

`dist/` is a build artifact. `release/` contains upload-only generated files.

## Project Layout

- `MagicHaqi.html` - app entry point
- `js/` - game state, views, pet logic, storage, AI/API wrappers, and zoom-level modules
- `css/` - level-specific styles
- `minigames/` - standalone pet minigames
- `agents/` - agent layer: `pet-master` (OpenClaw co-parent skill for all users) and `haqi-operator` (24/7 ops agent for the developer)
- `site/` - English landing page ("AI pets for humans and agents")
- `docs/` - design, architecture, QA, and planning notes
- `dev_tools/` - helper generators for pets, planets, scenes, and shop items
- `vite.config.mjs` - dev server and `dist/` build configuration
- `uploadRelease.mjs` - generates `release/*.html` and uploads `dist/` (run only via `npm run upload`)

## Main Flow

Log in, hatch a pet, then move through the four zoom levels: space, planet field, pet rooms, and cell view. From the home view, players can also visit the shop, inventory, chat, profile, stories, and minigames.

## Agent layer (page-as-API, no backend)

MagicHaqi can be operated by AI agents (co-parents) by driving the live website — there is
**no MagicHaqi REST backend**. Three shortcuts: KeepWork login REST → URL navigation →
a hidden in-page command interface.

- **Command interface** (`js/agentBridge.js`): `window.MagicHaqiAgent.exec(cmd)` / `getState()`;
  hidden nodes `#mh-agent-cmd` (in), `#mh-agent-result` (out), `#mh-agent-state` (live snapshot).
- **Login**: `POST https://api.keepwork.com/core/v0/users/login` → token → `MagicHaqi.html?token=`.
- **Deep links**: `?adopt=1`, `?agent=<id>` (binds a two-owner `agentOwner`), `?cmd=`, `?view=ops`.
- **Audit** (`js/agentAudit.js`): writes go to `agent/audit.log`.
- **Ops Console**: `MagicHaqi.html?view=ops` — human dashboard / fallback.
- **Agent packages** (`agents/`): `pet-master/` (all users) and `haqi-operator/` (developer 24/7 ops).

## Tech

- Vanilla JavaScript ES modules
- Tailwind CSS via CDN
- Vite for local development and build
- Content-hashed CDN release flow (keepwork.com entry HTML + `cdn.keepwork.com` assets)
- KeepworkSDK for login, storage, AI image generation, chat, and digital human features