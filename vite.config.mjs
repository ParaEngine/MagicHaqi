import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const rootDir = import.meta.dirname;
const sideBySideDirs = ['minigames', 'famous-pets', 'pet-story'];
const sideBySideFiles = ['docs/userguide.html'];

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
    plugins: [inlinePetSheetWorker(), extractHtmlStylesToCss(), copySideBySideDirs()],
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