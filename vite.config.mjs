import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const rootDir = import.meta.dirname;
const sideBySideDirs = ['minigames', 'famous-pets', 'famous-planets', 'pet-story'];
const sideBySideFiles = ['docs/userguide.html', 'docs/pet_wiki.html'];



// Tracks the asset/chunk file names emitted by the current build so stale files
// left over from previous builds can be removed from the assets folder.
const emittedBundleFiles = new Set();

function copySideBySideDirs() {
    return {
        name: 'copy-side-by-side-dirs',
        closeBundle() {
            const distDir = path.join(rootDir, 'dist');
            for (const dirName of sideBySideDirs) {
                const sourceDir = path.join(rootDir, dirName);
                const targetDir = path.join(distDir, dirName);
                if (!fs.existsSync(sourceDir)) continue;
                fs.rmSync(targetDir, { recursive: true, force: true });
                fs.cpSync(sourceDir, targetDir, { recursive: true });
            }
            for (const fileName of sideBySideFiles) {
                const pathParts = fileName.split('/');
                const sourceFile = path.join(rootDir, ...pathParts);
                const targetFile = path.join(distDir, ...pathParts);
                if (!fs.existsSync(sourceFile)) continue;
                fs.mkdirSync(path.dirname(targetFile), { recursive: true });
                fs.copyFileSync(sourceFile, targetFile);
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



export default defineConfig({
    root: rootDir,
    base: './',
    publicDir: false,
    plugins: [
        inlinePetSheetWorker(),
        extractHtmlStylesToCss(),
        cleanStaleAssets(),
        copySideBySideDirs(),
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