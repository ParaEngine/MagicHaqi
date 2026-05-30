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
// Run `npm run build` first so dist/ and release/MagicHaqi_v1.html exist.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(projectRoot, '..', '..', '..', '..');

const distDir = path.join(projectRoot, 'dist');
const releaseHtmlPath = path.join(projectRoot, 'release', 'MagicHaqi_v1.html');
const uploaderPath = path.join(
    repoRoot,
    '.github',
    'skills',
    'upload-deploy-cdn-files',
    'qiniu_upload_local_files.py',
);

function fail(message) {
    console.error(`\n[uploadRelease] ${message}\n`);
    process.exit(1);
}

if (!fs.existsSync(distDir)) {
    fail("dist/ not found. Run `npm run build` first.");
}
if (!fs.existsSync(releaseHtmlPath)) {
    fail("release/MagicHaqi_v1.html not found. Run `npm run build` first.");
}
if (!fs.existsSync(uploaderPath)) {
    fail(`Uploader script not found: ${uploaderPath}`);
}

// Extract the <base href="..."> from the release HTML.
const releaseHtml = fs.readFileSync(releaseHtmlPath, 'utf8');
const baseMatch = releaseHtml.match(/<base\b[^>]*\bhref=["']([^"']+)["']/i);
if (!baseMatch) {
    fail('No <base href> tag found in release/MagicHaqi_v1.html.');
}
const baseHref = baseMatch[1];

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
