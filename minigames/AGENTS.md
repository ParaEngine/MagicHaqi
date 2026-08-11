# HTML Page Game Development - AI Agent Instructions

## Project Overview
This repository contains a collection of single-page HTML5 educational games and interactive web applications, primarily designed for the Keepwork platform. All games are self-contained HTML files with embedded CSS and JavaScript.

## Core Architecture Principles

### Single-File Structure
- **Every game is a standalone `.html` file**
- games are added to view_minigames.js

### Required Declarative Data Sections
Every game **must** include two dedicated `<script>` data sections **before the real game script**. These are plain data declarations (not game logic) so that the host tooling and AI agents can read, edit, and regenerate them independently of the game code.

Order them like this in the HTML, after any CDN/library `<script>` tags and before the main game logic `<script>`:

1. `game_config` — gameplay configuration
2. `art_assets` — the art asset manifest
3. the real game script

#### 1. `game_config` section
A single global object that holds tunable gameplay parameters such as difficulty and levels. It **must** begin with `game_config =`.

```html
<script>
game_config = {
    difficulty: "normal",        // e.g. "easy" | "normal" | "hard"
    levels: [
        { id: 1, name: "Level 1", target: 10, time: 60 },
        { id: 2, name: "Level 2", target: 20, time: 45 }
    ]
    // add any other game-specific config keys here
};
</script>
```

Rules:
- Declare it as a global (no `const`/`let`/`var`), so the main game script and host tooling can read and overwrite it.
- Keep it pure data only — no functions, no DOM access, no side effects.
- The main game script reads `game_config` to drive difficulty, level definitions, scoring, timers, etc.
- A `setGameConfig` message from the parent may override values in `game_config` at runtime.

#### 2. `art_assets` section
A single global array describing every image asset the game uses. It **must** begin with `art_assets =`. 

```html
<script>
art_assets = [
    {
        id: "pet_dog",              // snake_case unique id
        imageUrl: "https://cdn.keepwork.com/.../pet_dog.webp", // CDN url or data URL
        rows: 4,                     // sprite-sheet rows (1 for a single image)
        columns: 4,                  // sprite-sheet columns (1 for a single image)
        isTransparent: true,         // true if the image has a transparent background
        description: "Pet dog sprite sheet",
        imageWidth: 1024,            // full image width in pixels
        imageHeight: 1024            // full image height in pixels
    }
];
</script>
```

Rules:
- Declare it as a global (no `const`/`let`/`var`).
- Each entry follows the ArtAssetGenerator output shape exactly: `{ id, imageUrl, rows, columns, isTransparent, description, imageWidth, imageHeight }`.
- `rows`/`columns` describe sprite-sheet grids; use `1`/`1` for a single, non-tiled image.
- The main game script looks up assets from `art_assets` by `id` instead of hard-coding image URLs inline.
- it can be empty if the game doesn't use any external images, but the section must still be present.

### Standard Technology Stack
1. **Tailwind CSS**: Always use CDN version for styling
   ```html
   <script src="https://cdn.keepwork.com/keepwork/cdn/tailwindcss@3.4.16.js"></script>
   ```
2. **No custom CSS/font files** - Use only Tailwind utility classes and inline styles
3. **Three.js** (when needed): Use CDN ES module for 3D games
   ```html
   <script type="module">
   import * as THREE from 'https://cdn.keepwork.com/npm/three@0.160.0/build/three.module.min.js';
   </script>
   ```

### UI/UX Design Patterns

#### Common UI Components
- **Rules Modal**: Initial popup showing game instructions with "Start Game" button
  - Typically hidden after first interaction, with floating help button (❓) to reopen
- **Success Effects**: Centered overlay messages using `#successEffect` pattern with fade animations

#### Mobile Responsiveness
- Use `@media (max-width: 768px)` breakpoints
- Switch from fixed positioning to flexbox layouts on small screens

### JavaScript Patterns

#### No DOMContentLoaded
- **Start game logic at the end of script tags** - do not wrap in `DOMContentLoaded`
- Initialize immediately after DOM is parsed

#### Event-Driven Architecture
All games implement a parent-child messaging system with `postMessage`:

```javascript
// Standard message types to handle:
window.addEventListener('message', function(e) {
  switch(e.data.type) {
    case 'setGameConfig':      // Receive markdown/JSON config from parent
  }
});

// Standard events to send to parent:
window.parent.postMessage({ type: 'gameLoaded' }, '*');
window.parent.postMessage({ type: 'gameStarted' }, '*');
window.parent.postMessage({ 
  type: 'gameFinished', 
  data: { earnedPoints, wpm, accuracy, difficulty } 
}, '*');
```

#### MagicHaqi Pet Images
MagicHaqi minigames run inside an iframe. They can ask the parent MagicHaqi app for transparent pet sprite sheets that have already had their background removed. The parent only replies after the image blob is loaded and processed. If the current pet is still in the egg stage, the parent returns a default transparent egg PNG instead of failing.

Request the current pet:

```javascript
const requestId = `pet_${Date.now()}`;
let activePetRequestId = requestId;
window.parent.postMessage({
  type: 'haqi_get_pet_image',
  requestId,
  // Optional: anim can be 'idle', 'happy', 'sad', or 'sleep'. Defaults to the pet's current anim.
  anim: 'idle',
  // Optional: pass petId when received from setGameConfig.
  petId: currentPetId || undefined
}, '*');
```

Robust loading pattern for games that display the active pet:

- Keep one persistent `message` listener for pet payloads. Do **not** rely only on a short-lived exact-`requestId` listener.
- Accept parent-pushed active pet payloads with `requestId: 'active_pet_config'`; the MagicHaqi host may send this without a matching request from the mini game.
- When `setGameConfig` includes `data.petId`, re-request `haqi_get_pet_image` with that `petId`.
- If the single-pet request does not produce an image after about 900ms, request `haqi_get_pet_images` and use the first returned pet, because the current active pet is first.
- Revoke replaced `ObjectURL`s and close replaced `ImageBitmap`s to avoid leaks.

Example robust handler:

```javascript
let petRequestId = '';
let petObjectUrl = '';

function requestPetImage(petId = '') {
  const requestId = `pet_${Date.now()}`;
  petRequestId = requestId;
  window.parent.postMessage({ type: 'haqi_get_pet_image', requestId, anim: 'happy', petId: petId || undefined }, '*');
  setTimeout(() => {
    if (petObjectUrl) return;
    window.parent.postMessage({ type: 'haqi_get_pet_images', requestId: `pets_${Date.now()}`, anim: 'happy' }, '*');
  }, 900);
}

window.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'setGameConfig' && msg.data?.petId) requestPetImage(msg.data.petId);
  if (msg.type === 'haqi_pet_image' && msg.ok && msg.data &&
      (!petRequestId || !msg.requestId || msg.requestId === petRequestId || msg.requestId === 'active_pet_config')) {
    setPetImage(msg.data);
  }
  if (msg.type === 'haqi_pet_images' && msg.ok) {
    const firstPet = Array.isArray(msg.data?.pets) ? msg.data.pets[0] : null;
    if (firstPet) setPetImage(firstPet);
  }
});
```

Request all pets on the current planet, with the current pet first and at most 10 pets:

```javascript
window.parent.postMessage({
  type: 'haqi_get_pet_images',
  requestId: `pets_${Date.now()}`,
  anim: 'idle'
}, '*');
```

Handle responses:

```javascript
window.addEventListener('message', async (event) => {
  const msg = event.data || {};
  if (msg.type === 'haqi_pet_image' && msg.ok) {
    await drawPetFromPayload(msg.data, ctx, 40, 60, 96, 96);
  }
  if (msg.type === 'haqi_pet_images' && msg.ok) {
    for (const [index, pet] of msg.data.pets.entries()) {
      await drawPetFromPayload(pet, ctx, 30 + index * 88, 80, 72, 72);
    }
  }
});
```

Each pet payload has this shape:

```javascript
{
  petId: '...',
  name: '...',
  stage: 'baby',
  anim: 'idle',
  imageBlob: Blob,       // PNG sprite sheet with transparent background, or a default egg PNG
  imageType: 'image/png',
  imageWidth: 1024,
  imageHeight: 1024,
  uv: {
    x: 0, y: 0, width: 256, height: 256, // pixel rect inside the sheet
    row: 0, col: 0, cols: 4, rows: 4,
    u0: 0, v0: 0, u1: 0.25, v1: 0.25     // normalized texture coordinates
  }
}
```

Egg-stage pets use the same payload shape, but `stage` is `'egg'`, `anim` is `'egg'`, and `uv` covers the whole image with `cols: 1` and `rows: 1`.

Canvas drawing helper:

```javascript
async function drawPetFromPayload(pet, ctx, dx, dy, dw, dh) {
  const bitmap = await createImageBitmap(pet.imageBlob);
  const { x, y, width, height } = pet.uv;
  ctx.drawImage(bitmap, x, y, width, height, dx, dy, dw, dh);
  bitmap.close?.();
}
```

DOM image helper, useful when not using canvas:

```javascript
function makePetSpriteElement(pet) {
  const url = URL.createObjectURL(pet.imageBlob);
  const el = document.createElement('div');
  el.style.width = '96px';
  el.style.height = '96px';
  el.style.backgroundImage = `url("${url}")`;
  el.style.backgroundSize = pet.uv.cols > 1 || pet.uv.rows > 1
    ? `${pet.uv.cols * 100}% ${pet.uv.rows * 100}%`
    : 'contain';
  el.style.backgroundPosition = pet.uv.cols > 1 || pet.uv.rows > 1
    ? `${pet.uv.col * 100 / (pet.uv.cols - 1)}% ${pet.uv.row * 100 / (pet.uv.rows - 1)}%`
    : 'center';
  el.style.backgroundRepeat = 'no-repeat';
  el.dataset.objectUrl = url;
  return el;
}
```

If a response has `ok: false`, read `error` and fall back to a local placeholder. For `haqi_pet_images`, `msg.data.errors` may contain per-pet failures while `msg.data.pets` still contains the pets that are ready.

#### Paid Unlock Points (optional — rewarded ads / VIP)

Progress-gated content (later levels, skins, extra hints) can be put behind an unlock
point. The mini-game sends **one message** and the MagicHaqi host shows a unified
unlock dialog (VIP passes for free → watch a rewarded ad → buy KeepWork VIP). The
game must **not** implement any ad or payment UI itself:

```javascript
window.parent.postMessage({
  type: 'haqi_request_unlock',
  requestId: `unlock_${Date.now()}`,
  scene: 'level_3',        // scene id, used for ad slots & analytics
  title: '解锁第3关'        // dialog title shown to the player
}, '*');
```

Host replies (all echo the original `requestId` — match on it, not on `scene`):

- `haqi_unlock_ack` — the host took over. Ads/VIP purchase can take a while;
  cancel any local fallback timer and wait.
- `haqi_unlock_result` — `{ requestId, ok, unlocked, via }` where `via` is
  `'vip' | 'ad' | 'member' | 'cancel' | 'error'`.
- `haqi_vip_status` — `{ isVip }`. You can also query it proactively with
  `{ type: 'haqi_get_vip_status' }`; hide lock badges for VIP users.

Design rules:

- **An unlock point must never brick the game.** When the file is opened standalone
  (no host), the `postMessage` may throw or nothing answers: if no `haqi_unlock_ack`
  arrives within ~1500ms, unlock locally (simulated) so the single file stays
  playable and testable.
- **Free first, pay later**: the first 1-2 levels and the core mechanic are always
  free; put unlock points only on progress content (later levels, skins, hints).
- Declare unlock points in `game_config` (e.g. `unlockLevels: [3, 5]`; an empty
  array means everything is free) so the host and AI tools can retune them
  independently of game logic.
- Keep unlock state in memory only. VIP/membership is global state owned by the
  host, and ad unlocks are per-use — do **not** persist "purchased" flags to
  `localStorage`.
- **Locked content must still be clickable.** Never set `disabled` / `pointer-events:none`
  on a locked level/skin button. Show a 🔒 badge, but the click handler must call
  `haqi_request_unlock` (with requestId + 1500ms fallback). A disabled lock button
  makes the unlock flow unreachable.
- **Match host replies by `requestId` only** — never `msg.scene === 'level_3'`.
  `haqi_unlock_ack` only means the host took over (clear the 1500ms timer); unlock
  only on `haqi_unlock_result` with `ok && unlocked`. Cancel must not freeze the UI.
- **Do not break core play while adding unlock.** Forbidden regressions:
  - canvas / main play surface with `pointer-events: none` / `pointer-events-none`
    (HUD may use `pointer-events: none` with child buttons `pointer-events: auto`)
  - init via `window.load` or `DOMContentLoaded` (run at end of script instead;
    `srcdoc` previews often miss `load`)
  - rewriting the whole game just to add unlock — patch in helpers + lock-click only
- **60s smoke test after any unlock change:** free level scores on tap → locked level
  opens host unlock dialog → cancel returns to level select and free level still works.

See `minigames/test_game.html` for a complete reference implementation.

#### Game State Management
- Track `gameStarted` flag globally to send `gameLoaded` only once
- Store high scores in `localStorage` (e.g., `bestScore`, `highestScore`)

### Keepwork SDK Integration

When games need server-side features (data storage, TTS, LLM chat), include:

```html
<script src="https://cdn.keepwork.com/sdk/keepworkSDK.iife.js?v=20260612a"></script>
```

Initialize the SDK:
```javascript
const sdk = new KeepworkSDK({
  timeout: 30000
});
console.log(`Keepwork SDK initialized token: ${sdk.token}`);
```

**SDK Features Used:**
- Text-to-speech services
- LLM chatbot integration (see `characterAI.html`)
- User data persistence
- Authentication via URL token parameter: `?token=eyJhbGci...`


## Development Workflow

### Creating New Games
1. Copy structure from similar game in root directory
2. Use Tailwind CDN - never create separate CSS files
3. Implement standard message handlers for parent integration
4. Add rules modal with floating help button
5. Test landscape layout without scrolling

### Editing Existing Games
- **Make small, incremental edits** - don't regenerate entire files
- Preserve existing game logic and state management
- Maintain backward compatibility with parent window messaging

## Common Pitfalls to Avoid

❌ Don't use external CSS/font files  
❌ Don't wrap initialization in DOMContentLoaded  
❌ Don't create multi-file projects  
❌ Don't ignore mobile responsiveness  
❌ Don't forget parent window messaging protocol  

✅ Do use Tailwind CDN for all styling  
✅ Do start game logic at end of script tag  
✅ Do keep everything in single HTML file  
✅ Do design for landscape-first  
✅ Do implement standard postMessage handlers
