import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const rootDir = import.meta.dirname;
const sideBySideDirs = ['minigames', 'dev_tools', 'famous-pets', 'famous-planets', 'pet-story'];
const sideBySideFiles = ['docs/userguide.html', 'docs/pet_wiki.html'];
const sdkCdnPattern = /https:\/\/cdn\.keepwork\.com\/sdk\/keepworkSDK\.iife\.js(?:\?v=[^'"\s<)]*)?/g;
const sdkCdnBase = 'https://cdn.keepwork.com/sdk/keepworkSDK.iife.js';

// Download the live keepworkSDK bundle and return a short content hash. A random
// query param busts the CDN edge cache so we always hash the freshest bytes; the
// `?v=` we then ship is the hash of the *contents*, not that throwaway buster.
async function fetchSdkContentHash() {
    const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await fetch(`${sdkCdnBase}?v=${cacheBuster}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download failed (${res.status} ${res.statusText})`);
    const buf = Buffer.from(await res.arrayBuffer());
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

// Rewrite `const sdkCdnUrl = '…keepworkSDK.iife.js?v=<hash>'` in js/app.js so the
// shipped version param matches the live SDK's content hash. Runs first in
// buildStart (before the entry is read), so the bundled app.js and every HTML
// file synced by copySideBySideDirs()/extractHtmlStylesToCss() get the new hash.
function syncAppSdkCdnVersion() {
    return {
        name: 'sync-app-sdk-cdn-version',
        apply: 'build',
        async buildStart() {
            let hash;
            try {
                hash = await fetchSdkContentHash();
            } catch (err) {
                this.warn(`[sync-app-sdk-cdn-version] keeping existing sdkCdnUrl ?v= — ${err.message}`);
                return;
            }
            const appJsPath = path.join(rootDir, 'js', 'app.js');
            const appJs = fs.readFileSync(appJsPath, 'utf8');
            const nextAppJs = appJs.replace(
                /(const\s+sdkCdnUrl\s*=\s*['"]https:\/\/cdn\.keepwork\.com\/sdk\/keepworkSDK\.iife\.js)(?:\?v=[^'"]*)?(['"])/,
                `$1?v=${hash}$2`,
            );
            if (nextAppJs === appJs) {
                this.warn('[sync-app-sdk-cdn-version] sdkCdnUrl not found / already current in js/app.js');
                return;
            }
            fs.writeFileSync(appJsPath, nextAppJs);
            // eslint-disable-next-line no-console
            console.log(`[sync-app-sdk-cdn-version] sdkCdnUrl ?v=${hash}`);
        },
    };
}

function appSdkCdnUrl() {
    const appJs = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf8');
    const match = appJs.match(/const\s+sdkCdnUrl\s*=\s*['"]([^'"]+)['"]/);
    if (!match) throw new Error('Unable to find sdkCdnUrl in js/app.js');
    return match[1];
}

function syncSdkCdnVersionInHtml(targetPath, sdkUrl) {
    if (!targetPath.toLowerCase().endsWith('.html') || !fs.existsSync(targetPath)) return;
    const html = fs.readFileSync(targetPath, 'utf8');
    const nextHtml = html.replace(sdkCdnPattern, sdkUrl);
    if (nextHtml !== html) fs.writeFileSync(targetPath, nextHtml);
}

function syncSdkCdnVersionInHtmlTree(targetPath, sdkUrl) {
    if (!fs.existsSync(targetPath)) return;
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
        syncSdkCdnVersionInHtml(targetPath, sdkUrl);
        return;
    }
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
        syncSdkCdnVersionInHtmlTree(path.join(targetPath, entry.name), sdkUrl);
    }
}



// Tracks the asset/chunk file names emitted by the current build so stale files
// left over from previous builds can be removed from the assets folder.
const emittedBundleFiles = new Set();

function copySideBySideDirs() {
    return {
        name: 'copy-side-by-side-dirs',
        closeBundle() {
            const distDir = path.join(rootDir, 'dist');
            const sdkUrl = appSdkCdnUrl();
            for (const dirName of sideBySideDirs) {
                const sourceDir = path.join(rootDir, dirName);
                const targetDir = path.join(distDir, dirName);
                if (!fs.existsSync(sourceDir)) continue;
                fs.rmSync(targetDir, { recursive: true, force: true });
                fs.cpSync(sourceDir, targetDir, { recursive: true });
                syncSdkCdnVersionInHtmlTree(targetDir, sdkUrl);
            }
            for (const fileName of sideBySideFiles) {
                const pathParts = fileName.split('/');
                const sourceFile = path.join(rootDir, ...pathParts);
                const targetFile = path.join(distDir, ...pathParts);
                if (!fs.existsSync(sourceFile)) continue;
                fs.mkdirSync(path.dirname(targetFile), { recursive: true });
                fs.copyFileSync(sourceFile, targetFile);
                syncSdkCdnVersionInHtml(targetFile, sdkUrl);
            }
        },
    };
}

// Files under the side-by-side dirs / files are referenced at runtime via
// `new URL('../<dir>/...', import.meta.url)` + fetch(). A dynamic segment in
// such a URL makes Vite slurp the whole parent tree (project root, docs, every
// side-by-side dir, even vite.config.mjs) into assets/ with content hashes.
// Those hashed copies are useless because the runtime fetch resolves against
// the verbatim copies produced by copySideBySideDirs(). This plugin drops any
// emitted asset that originated from a side-by-side location so it never ends
// up hashed inside assets/.
const sideBySideRoots = [
    ...sideBySideDirs.map((dirName) => path.resolve(rootDir, dirName)),
    ...sideBySideFiles.map((fileName) => path.resolve(rootDir, ...fileName.split('/'))),
];

function isSideBySideSource(sourcePath) {
    if (!sourcePath) return false;
    const resolved = path.resolve(rootDir, sourcePath.split('?')[0]);
    return sideBySideRoots.some(
        (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
}

// The directory-slurp pulls in files from the project root, docs/, and the
// side-by-side dirs. None of those emitted assets are referenced by the bundle
// via their hashed names: the game fetches them through literal runtime URLs
// (`new URL('../<dir>/file', import.meta.url)`) that resolve against the
// verbatim copies produced by copySideBySideDirs(). So an emitted asset is
// "slurped" (and safe to drop) when its source originates outside the real
// build inputs (js/ and css/).
const bundleSourceRoots = [
    path.resolve(rootDir, 'js'),
    path.resolve(rootDir, 'css'),
];

function assetSourcePaths(asset) {
    if (asset.type !== 'asset') return [];
    if (asset.originalFileNames?.length) return asset.originalFileNames;
    if (asset.originalFileName) return [asset.originalFileName];
    return [];
}

function isSlurpedAsset(asset) {
    const sources = assetSourcePaths(asset);
    if (!sources.length) return false;
    return sources.every((source) => {
        const resolved = path.resolve(rootDir, source.split('?')[0]);
        const fromBuildInput = bundleSourceRoots.some(
            (root) => resolved === root || resolved.startsWith(root + path.sep),
        );
        return !fromBuildInput;
    });
}

// Drop slurped assets from the bundle and remove stale files in dist/assets
// that are not part of the current build.
function cleanStaleAssets() {
    return {
        name: 'clean-stale-assets',
        enforce: 'post',
        generateBundle(_, bundle) {
            // Collect the asset basenames that emitted chunks still reference.
            // Vite rewrites static `new URL('../<dir>/file', import.meta.url)`
            // calls into `new URL('<basename>-<hash>.<ext>', import.meta.url)`,
            // so those hashed assets must be kept even though they were slurped
            // from a side-by-side location.
            const referencedAssetNames = new Set();
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk') continue;
                const matches = chunk.code.matchAll(
                    /new URL\(\s*["']([^"']+\.[A-Za-z0-9]+)["']\s*,\s*import\.meta\.url\s*\)/g,
                );
                for (const match of matches) {
                    referencedAssetNames.add(match[1].split('/').pop());
                }
            }

            for (const [fileName, asset] of Object.entries(bundle)) {
                // Always keep the real entry HTML emitted at the dist root, but
                // drop the redundant hashed copy the directory-slurp emits into
                // assets/.
                if (fileName === 'MagicHaqi.html') {
                    emittedBundleFiles.add(fileName);
                    continue;
                }
                const basename = fileName.split('/').pop();
                const slurped = isSlurpedAsset(asset) || isSideBySideSource(assetSourcePaths(asset)[0]);
                if (slurped && !referencedAssetNames.has(basename)) {
                    delete bundle[fileName];
                    continue;
                }
                emittedBundleFiles.add(basename);
            }
        },
        closeBundle() {
            const assetsDir = path.join(rootDir, 'dist', 'assets');
            if (!fs.existsSync(assetsDir)) return;
            for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
                if (!entry.isFile()) continue;
                if (emittedBundleFiles.has(entry.name)) continue;
                fs.rmSync(path.join(assetsDir, entry.name), { force: true });
            }
        },
    };
}

function inlinePetSheetWorker() {
    const workerPath = path.join(rootDir, 'js', 'petSheetWorker.js');
    const workerCall = "new Worker(new URL('./petSheetWorker.js', import.meta.url))";

    return {
        name: 'inline-pet-sheet-worker',
        enforce: 'pre',
        transform(code, id) {
            if (!id.endsWith('/js/pet.js') && !id.endsWith('\\js\\pet.js')) return null;
            if (!code.includes(workerCall)) return null;
            const workerSource = fs.readFileSync(workerPath, 'utf8');
            const inlinedWorkerCall = `new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: 'text/javascript' })))`;
            return {
                code: code.replace(workerCall, inlinedWorkerCall),
                map: null,
            };
        },
    };
}

function extractHtmlStylesToCss() {
    function moveStylesToCss(html, appendStyles) {
        const extractedStyles = [];
        const nextHtml = html.replace(/\n?[ \t]*<style(?:\s[^>]*)?>([\s\S]*?)<\/style>[ \t]*\n?/gi, (_, css) => {
            const style = css.trim();
            if (style) extractedStyles.push(style);
            return '\n';
        });
        if (!extractedStyles.length) return html;

        appendStyles(extractedStyles.join('\n\n'));
        return nextHtml.replace(/\n{3,}/g, '\n\n');
    }

    return {
        name: 'extract-html-styles-to-css',
        apply: 'build',
        enforce: 'post',
        generateBundle(_, bundle) {
            const htmlAsset = Object.values(bundle).find((asset) => asset.type === 'asset' && asset.fileName === 'MagicHaqi.html');
            if (!htmlAsset) return;

            const cssAsset = Object.values(bundle).find((asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'));
            let emittedCssFileName = '';
            htmlAsset.source = moveStylesToCss(String(htmlAsset.source), (css) => {
                if (cssAsset) {
                    cssAsset.source = `${cssAsset.source}\n\n${css}`;
                    return;
                }
                emittedCssFileName = 'assets/MagicHaqi.css';
                this.emitFile({ type: 'asset', fileName: emittedCssFileName, source: css });
            });
            if (emittedCssFileName) {
                htmlAsset.source = String(htmlAsset.source).replace('</head>', `  <link rel="stylesheet" crossorigin href="./${emittedCssFileName}">\n</head>`);
            }
        },
        closeBundle() {
            const distDir = path.join(rootDir, 'dist');
            const htmlPath = path.join(distDir, 'MagicHaqi.html');
            const assetsDir = path.join(distDir, 'assets');
            if (!fs.existsSync(htmlPath) || !fs.existsSync(assetsDir)) return;

            const cssFileName = fs.readdirSync(assetsDir).find((fileName) => fileName.endsWith('.css')) || 'MagicHaqi.css';
            const cssPath = path.join(assetsDir, cssFileName);
            const html = fs.readFileSync(htmlPath, 'utf8');
            let didExtract = false;
            const nextHtml = moveStylesToCss(html, (css) => {
                didExtract = true;
                const existingCss = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
                fs.writeFileSync(cssPath, existingCss ? `${existingCss}\n\n${css}` : css);
            });
            if (!didExtract) return;

            const cssHref = `./assets/${cssFileName}`;
            const htmlWithCss = nextHtml.includes(cssHref)
                ? nextHtml
                : nextHtml.replace('</head>', `  <link rel="stylesheet" crossorigin href="${cssHref}">\n</head>`);
            fs.writeFileSync(htmlPath, htmlWithCss);
        },
    };
}



// The dev source (MagicHaqi.html, minigames/*, dev_tools/*) loads Tailwind from
// the CDN as a runtime in-browser JIT compiler. That compiler parses the DOM and
// generates CSS on every page load (~130-170ms of main-thread work) — fine for
// authoring, far too slow for shipped pages. This plugin replaces that runtime
// <script> in the *dist* copies with a tiny inline <style> containing only the
// utility classes each file actually uses, compiled at build time. Source files
// keep the CDN script, so the dev experience is unchanged.
const TW_CDN_SRC = 'https://cdn.keepwork.com/keepwork/cdn/tailwindcss@3.4.16.js';
function tailwindScriptRe() {
    return new RegExp(
        `<script[^>]*src=["']${TW_CDN_SRC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*></script>`,
        'g',
    );
}

// Conservative CSS minify: strip comments and newline-adjacent whitespace, drop
// the semicolon before a closing brace. Tailwind's generated CSS never relies on
// newlines inside declaration values, so this is safe and matches the CLI's
// --minify output closely (~6.5KB per game vs the 407KB runtime compiler).
function minifyCss(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s*\n\s*/g, '')
        .replace(/;}/g, '}')
        .trim();
}

const twCache = new Map(); // content fingerprint -> compiled css (cheap dedupe across identical files)
async function compileTailwind(contentSources) {
    const key = crypto.createHash('sha1').update(contentSources.join(' ')).digest('hex');
    if (twCache.has(key)) return twCache.get(key);
    const input = '@tailwind base;@tailwind components;@tailwind utilities;';
    const result = await postcss([
        tailwindcss({
            content: contentSources.map((raw) => ({ raw, extension: 'html' })),
            corePlugins: { preflight: true },
        }),
    ]).process(input, { from: undefined });
    const css = minifyCss(result.css);
    twCache.set(key, css);
    return css;
}

function collectHtmlFiles(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectHtmlFiles(full, out);
        else if (entry.name.toLowerCase().endsWith('.html')) out.push(full);
    }
    return out;
}

function precompileTailwind() {
    return {
        name: 'precompile-tailwind',
        async closeBundle() {
            const distDir = path.join(rootDir, 'dist');
            if (!fs.existsSync(distDir)) return;

            // The main app's class usage lives in its bundled JS, not just the
            // HTML, so scan the emitted assets/*.js for MagicHaqi.html.
            const assetsDir = path.join(distDir, 'assets');
            const bundledJs = fs.existsSync(assetsDir)
                ? fs.readdirSync(assetsDir)
                    .filter((f) => f.endsWith('.js'))
                    .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
                : [];

            let processed = 0;
            for (const fp of collectHtmlFiles(distDir)) {
                const html = fs.readFileSync(fp, 'utf8');
                if (!tailwindScriptRe().test(html)) continue;
                const isMainApp = path.basename(fp) === 'MagicHaqi.html';
                // Self-contained pages (minigames/dev_tools) have all their
                // markup + scripts inline, so the HTML itself is the full
                // content source; the main app also needs its bundled JS.
                const sources = isMainApp ? [html, ...bundledJs] : [html];
                const css = await compileTailwind(sources);

                // Main app: it is Vite-bundled and already <link>s the bundled
                // assets/*.css (extractHtmlStylesToCss). Append the precompiled
                // Tailwind into that stylesheet and just drop the runtime <script>,
                // rather than inlining a ~10KB <style> into every release HTML.
                // (Self-contained minigames/dev_tools have no bundle, so they keep
                // the inline <style> path below.)
                if (isMainApp) {
                    const bundledCss = fs.existsSync(assetsDir)
                        ? fs.readdirSync(assetsDir).find((f) => f.endsWith('.css'))
                        : null;
                    if (bundledCss) {
                        const cssPath = path.join(assetsDir, bundledCss);
                        const existing = fs.readFileSync(cssPath, 'utf8');
                        // Tailwind base/preflight first, so the app's hand-written
                        // CSS keeps winning on equal specificity (matches the source
                        // order where the Tailwind <script> preceded the app CSS).
                        fs.writeFileSync(cssPath, `${css}\n${existing}`);
                        fs.writeFileSync(fp, html.replace(tailwindScriptRe(), ''));
                        processed++;
                        continue;
                    }
                    // Fallback (no bundled css asset found): inline as before.
                }

                const styleBlock = `<style data-tw-precompiled>${css}</style>`;
                fs.writeFileSync(fp, html.replace(tailwindScriptRe(), styleBlock));
                processed++;
            }
            // eslint-disable-next-line no-console
            console.log(`\n[precompile-tailwind] replaced runtime Tailwind compiler in ${processed} dist HTML file(s).`);
        },
    };
}

export default defineConfig({
    root: rootDir,
    base: './',
    publicDir: false,
    plugins: [
        syncAppSdkCdnVersion(), // must run first: rewrites js/app.js ?v= before the entry is read
        inlinePetSheetWorker(),
        extractHtmlStylesToCss(),
        cleanStaleAssets(),
        copySideBySideDirs(),
        precompileTailwind(), // must run last: needs the populated dist/ tree
    ],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'esnext',
        cssCodeSplit: false,
        rollupOptions: {
            input: path.join(rootDir, 'MagicHaqi.html'),
            output: {
                inlineDynamicImports: true,
                entryFileNames: 'assets/MagicHaqi-[hash].js',
                chunkFileNames: 'assets/MagicHaqi-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
});