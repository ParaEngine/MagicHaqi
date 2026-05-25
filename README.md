# MagicHaqi

MagicHaqi is a mobile-first H5 virtual pet game built with vanilla JavaScript modules and the KeepworkSDK. Players hatch AI-generated pets, care for them across multiple zoom levels, decorate rooms and planets, collect resources, and build pet stories over time.

## Run

Open `MagicHaqi.html` directly in a browser, or run the local Vite server:

```bash
npm install
npm run dev
```

For the best SDK behavior, use `127.0.0.1` or the Vite dev URL instead of a raw file URL.

## Project Layout

- `MagicHaqi.html` - app entry point
- `js/` - game state, views, pet logic, storage, AI/API wrappers, and zoom-level modules
- `css/` - level-specific styles
- `minigames/` - standalone pet minigames
- `docs/` - design, architecture, QA, and planning notes
- `dev_tools/` - helper generators for pets, planets, scenes, and shop items

## Main Flow

Log in, hatch a pet, then move through the four zoom levels: space, planet field, pet rooms, and cell view. From the home view, players can also visit the shop, inventory, chat, profile, stories, and minigames.

## Tech

- Vanilla JavaScript ES modules
- Tailwind CSS via CDN
- Vite for local development and build
- KeepworkSDK for login, storage, AI image generation, chat, and digital human features