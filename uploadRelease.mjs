#!/usr/bin/env node
// Upload the built `dist/` contents to the immutable CDN folder declared by the
// `<base>` tag in `release/MagicHaqi_v1.html`.
//
// The release HTML's <base href> looks like:
//   https://cdn.keepwork.com/maisi/magichaqi/release/<hash>/
// We derive the remote prefix (everything after the domain) and reuse the
// shared qiniu uploader skill to push every top-level entry under dist/ so the
// CDN layout matches the relative URLs the release HTML expects:
//   <prefix>/MagicHaqi.html
//   <prefix>/assets/...
//   <prefix>/minigames/... etc.
//
// Run `npm run build` first so dist/ exists.

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(projectRoot, '..', '..', '..', '..');

const distDir = path.join(projectRoot, 'dist');
const releaseDir = path.join(projectRoot, 'release');
const releaseHtmlName = 'MagicHaqi_v1.html';
const releaseHtmlPath = path.join(releaseDir, releaseHtmlName);
const uploaderPath = path.join(
    repoRoot,
    '.github',
    'skills',
    'upload-deploy-cdn-files',
    'qiniu_upload_local_files.py',
);

// CDN release configuration. The entry HTML emitted into `release/` gets a
// `<base>` tag pointing at a content-hashed CDN folder. Because the built
// `dist/MagicHaqi.html` references its assets with relative URLs
// (`./assets/...`), the `<base>` tag makes every relative asset/fetch resolve
// against the immutable CDN hash folder. Upload `dist/` to that folder and the
// release HTML served from keepwork.com will pull everything from CDN.
const cdnReleaseBase = 'https://cdn.keepwork.com/maisi/magichaqi/release';

// Planet-specific release HTML variants. Each gets an inline script that sets
// `window.__homePlanet` before the app boots, so the game loads the matching
// star-settlement planet automatically.
const planetReleaseVariants = [
    { name: 'MagicHaqi_haqi.html', homePlanet: 'haqi' },
    { name: 'MagicHaqi_maisi.html', homePlanet: 'maisi' },
    { name: 'MagicHaqi_pixlet.html', homePlanet: 'pixlet' },
];

// View-forcing release HTML variants. Each gets an inline script that sets
// `window.__view` before the app boots, forcing the game to open directly in the
// given view (see js/config.js getForcedView). `MagicHaqi_games.html` opens the
// minigames view.
const viewReleaseVariants = [
    { name: 'MagicHaqi_games.html', view: 'game', title: '魔法哈奇 小游戏' },
];

// Default document title shipped in dist/MagicHaqi.html. Variants replace this
// with a per-planet appTitle (from _planet_index.json) or a custom title.
const DEFAULT_RELEASE_TITLE = '蛋蛋星球 MagicHaqi';

// Read the per-planet `appTitle` map from the famous-planets index so planet
// variants can override the document <title>.
function loadPlanetAppTitles() {
    const indexPath = path.join(projectRoot, 'famous-planets', '_planet_index.json');
    const map = {};
    try {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        const planets = Array.isArray(data?.planets) ? data.planets : [];
        for (const planet of planets) {
            const id = String(planet?.id || '').trim();
            const appTitle = String(planet?.appTitle || '').trim();
            if (id && appTitle) map[id] = appTitle;
        }
    } catch (e) {
        console.warn(`[uploadRelease] Could not read planet appTitles: ${e.message}`);
    }
    return map;
}

// Replace the document <title> in an HTML string. Falls back to a no-op when the
// title element is missing.
function replaceHtmlTitle(html, newTitle) {
    if (!newTitle) return html;
    const escaped = newTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`);
}

function fail(message) {
    console.error(`\n[uploadRelease] ${message}\n`);
    process.exit(1);
}

if (!fs.existsSync(distDir)) {
    fail("dist/ not found. Run `npm run build` first.");
}
if (!fs.existsSync(uploaderPath)) {
    fail(`Uploader script not found: ${uploaderPath}`);
}

// Compute a stable content hash for the build so each publish gets a unique,
// immutable CDN folder. Hash the emitted JS + CSS asset bytes plus the entry
// HTML so any change in code, styles, or markup yields a new hash.
function computeReleaseHash() {
    const hash = crypto.createHash('sha256');
    const htmlPath = path.join(distDir, 'MagicHaqi.html');
    if (fs.existsSync(htmlPath)) hash.update(fs.readFileSync(htmlPath));

    const assetsDir = path.join(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
        const assetNames = fs
            .readdirSync(assetsDir)
            .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
            .sort();
        for (const name of assetNames) {
            hash.update(name);
            hash.update(fs.readFileSync(path.join(assetsDir, name)));
        }
    }
    return hash.digest('hex').slice(0, 12);
}

// Generate release HTML files with the content-hashed CDN base tag.
function generateReleaseHtml() {
    const htmlPath = path.join(distDir, 'MagicHaqi.html');
    if (!fs.existsSync(htmlPath)) {
        fail('dist/MagicHaqi.html not found. Run `npm run build` first.');
    }

    const releaseHash = computeReleaseHash();
    const baseHref = `${cdnReleaseBase}/${releaseHash}/`;
    const baseTag = `  <base href="${baseHref}">\n`;

    let html = fs.readFileSync(htmlPath, 'utf8');
    // Avoid duplicating a base tag and ensure it is the first element in
    // <head> so it applies to every subsequent relative URL.
    html = html.replace(/[ \t]*<base\b[^>]*>\s*\n?/i, '');
    html = html.replace(/<head>/i, `<head>\n${baseTag}`);

    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(releaseHtmlPath, html);
    console.log(`[uploadRelease] Generated release/${releaseHtmlName} -> <base href="${baseHref}">`);

    // Generate planet-specific variants with an inline script that sets
    // `window.__homePlanet` before the app boots. The document <title> is
    // overridden with the planet's appTitle from _planet_index.json (falling
    // back to the default title when no appTitle is configured).
    const planetAppTitles = loadPlanetAppTitles();
    for (const variant of planetReleaseVariants) {
        const planetScript = `  <script>window.__homePlanet='${variant.homePlanet}';</script>\n`;
        const variantTitle = planetAppTitles[variant.homePlanet] || DEFAULT_RELEASE_TITLE;
        let planetHtml = replaceHtmlTitle(html, variantTitle);
        // Insert the planet script in <head> so it runs before the app
        // module initializes.
        planetHtml = planetHtml.replace(
            /<\/head>/i,
            `${planetScript}</head>`,
        );
        const variantPath = path.join(releaseDir, variant.name);
        fs.writeFileSync(variantPath, planetHtml);
        console.log(`[uploadRelease] Generated release/${variant.name} -> home_planet=${variant.homePlanet}, title="${variantTitle}"`);
    }

    // Generate view-forcing variants with an inline script that sets
    // `window.__view` before the app boots (e.g. MagicHaqi_games.html -> game).
    for (const variant of viewReleaseVariants) {
        const viewScript = `  <script>window.__view='${variant.view}';</script>\n`;
        const variantTitle = variant.title || DEFAULT_RELEASE_TITLE;
        let viewHtml = replaceHtmlTitle(html, variantTitle);
        viewHtml = viewHtml.replace(
            /<\/head>/i,
            `${viewScript}</head>`,
        );
        const variantPath = path.join(releaseDir, variant.name);
        fs.writeFileSync(variantPath, viewHtml);
        console.log(`[uploadRelease] Generated release/${variant.name} -> view=${variant.view}, title="${variantTitle}"`);
    }

    return baseHref;
}

const baseHref = generateReleaseHtml();

// Derive the remote prefix: strip scheme + host, keep the path, ensure a single
// trailing slash and no leading slash (the Python uploader expects a prefix
// like `maisi/magichaqi/release/<hash>/`).
let remotePrefix;
try {
    const baseUrl = new URL(baseHref);
    remotePrefix = baseUrl.pathname.replace(/^\/+/, '');
} catch {
    fail(`Invalid <base href>: ${baseHref}`);
}
if (!remotePrefix.endsWith('/')) remotePrefix += '/';

// Collect top-level entries under dist/. Files keep their name; directories are
// uploaded by name (the Python uploader prefixes each directory by its
// basename), so both map to `<prefix>/<entry>` exactly as the release HTML's
// relative URLs resolve.
const distEntries = fs
    .readdirSync(distDir, { withFileTypes: true })
    .map((entry) => path.join(distDir, entry.name));

if (!distEntries.length) {
    fail('dist/ is empty. Run `npm run build` first.');
}

console.log(`\n[uploadRelease] base href : ${baseHref}`);
console.log(`[uploadRelease] prefix    : ${remotePrefix}`);
console.log(`[uploadRelease] uploading ${distEntries.length} top-level dist/ entries...\n`);

const pythonExe = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const args = [uploaderPath, '--prefix', remotePrefix, ...distEntries];

const result = spawnSync(pythonExe, args, { stdio: 'inherit' });
if (result.error) {
    fail(`Failed to launch ${pythonExe}: ${result.error.message}`);
}
process.exit(result.status ?? 1);
