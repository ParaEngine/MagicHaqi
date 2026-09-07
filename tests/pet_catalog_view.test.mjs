import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/view_petList.js', import.meta.url), 'utf8');

test('pet catalog exposes stable page, navigation, content, and empty-state layers', () => {
    assert.match(source, /class="mh-pet-list-view \$\{isPicker \? 'is-picker' : ''\}"/);
    assert.match(source, /class="topbar mh-pet-list-topbar"/);
    assert.match(source, /class="mh-pet-list-scroll"/);
    assert.match(source, /class="mh-pet-list-content"/);
    assert.match(source, /class="mh-pet-list-nav"/);
    assert.match(source, /class="card-flat text-center mh-pet-list-empty"/);
    assert.doesNotMatch(source, /top:52px;left:0;right:0;bottom:\$\{isPicker/);
});

test('pet catalog artwork keeps its aspect ratio without duplicating baked-in labels or icons', () => {
    assert.match(source, /--mh-pet-catalog-tab-art:url\('https:\/\/cdn\.keepwork\.com\/keepwork\/cdn\/magichaqi\/assets\/ui\/pet-catalog\/pet-catalog-tab-idle\.webp'\)/);
    assert.match(source, /--mh-pet-catalog-card-art:none/);
    assert.match(source, /--mh-pet-catalog-page-art:url\('https:\/\/cdn\.keepwork\.com\/keepwork\/cdn\/magichaqi\/assets\/expedition-backgrounds\/star-map-background\.webp'\)/);
    assert.match(source, /background:#8ed5e4 var\(--mh-pet-catalog-page-art\) center \/ cover no-repeat/);
    assert.doesNotMatch(source, /pet-catalog-background-clean(?:-v\d+)?\.webp/);
    assert.match(source, /background-image:var\(--mh-pet-catalog-card-art\)/);
    assert.match(source, /aspect-ratio:842 \/ 166;[^}]*pet-catalog-title\.webp[^}]*contain no-repeat/);
    assert.match(source, /aspect-ratio:288 \/ 128;[^}]*pet-catalog-wallet\.webp[^}]*contain no-repeat/);
    assert.match(source, /\.mh-pet-list-tab\.is-mine \{ aspect-ratio:846 \/ 142;[^}]*pet-catalog-tab-active\.webp/);
    assert.match(source, /\.mh-pet-list-tab\.is-rare \{ aspect-ratio:812 \/ 142;[^}]*pet-catalog-tab-idle\.webp/);
    assert.doesNotMatch(source, /\.mh-pet-list-tab\.is-mine\.active[^}]*background-image/);
    assert.match(source, /\.mh-pet-list-tab\.is-mine\.active \{[^}]*drop-shadow\(0 0 7px rgba\(90,218,255,\.95\)\)/);
    assert.match(source, /\.mh-pet-list-tab\.is-mine \.mh-pet-list-tab-count \{ color:#fff;/);
    assert.doesNotMatch(source, /\.mh-pet-list-tab \{[^}]*background-size:100% 100%/);
    assert.match(source, /\.mh-pet-list-tab\.is-rare\.active \.mh-pet-list-tab-count \{ color:#24577d;/);
    assert.match(source, /\.mh-pet-list-nav \{[^}]*background:transparent/);
    assert.match(source, /class="mh-pet-list-tab-count">\$\{escapeHtml/);
    assert.match(source, /class="font-bold mh-pet-list-wallet">\$\{window\.MH_state\?\.coins \|\| 0\}<\/span>/);
    assert.doesNotMatch(source, /class="font-bold mh-pet-list-wallet">\$\{coinIconSvg\(\)/);
    assert.doesNotMatch(source, /pet-catalog-research-release\.webp/);
    assert.match(source, /aspect-ratio:1716 \/ 158;[^}]*pet-catalog-research-release-v5\.webp[^}]*contain no-repeat/);
    assert.match(source, /class="mh-pet-research-release" data-research-release type="button" aria-label="一键研究放归重复 N \/ R 伙伴"><\/button>/);
    assert.doesNotMatch(source, /mh-pet-list-decoration|pet-catalog-tree-round\.webp|pet-catalog-tree-pine\.webp|pet-catalog-flower-bush\.webp|pet-catalog-rock\.webp|pet-catalog-fence\.webp/);
    assert.match(source, /petListTabsHtml\(\{ petCount: list\.length, rareUnlockedCount/);
    assert.match(source, /data-pet-stats="\$\{escapeHtml\(pet\.id\)\}"/);
    assert.match(source, /data-pet-rename="\$\{escapeHtml\(pet\.id\)\}"/);
});

test('pet catalog owns responsive scrolling without page overflow', () => {
    assert.match(source, /\.mh-pet-list-view \{[^}]*overflow:hidden/);
    assert.match(source, /\.mh-pet-list-scroll \{[^}]*overflow-y:auto; overflow-x:hidden/);
    assert.match(source, /\.mh-pet-list-nav \{[^}]*position:sticky/);
    assert.match(source, /\.mh-pet-list-title \{[^}]*position:absolute; left:50%; top:50%;[^}]*transform:translate\(-50%, -50%\)/);
    assert.match(source, /\.mh-famous-filter-tabs \{[^}]*grid-template-columns:repeat\(5, minmax\(0, 1fr\)\)[^}]*overflow:visible/);
    assert.match(source, /\.mh-famous-filter-tab \{[^}]*width:100%; min-width:0;[^}]*overflow:hidden/);
    assert.match(source, /@media \(max-width:420px\) \{ \.mh-pet-list-scroll \{ padding:10px; \}/);
    assert.match(source, /--mh-pet-picker-footer-height:\$\{isPicker && multiple \? '62px' : '0px'\}/);
});

test('lazy pet cards recover from server load failures and expose manual retry', () => {
    assert.match(source, /class="mh-pet-lazy-status"/);
    assert.match(source, /delete el\.dataset\.petLazyLoading/);
    assert.match(source, /loadingLabel\.textContent = t\('petLazyRetry'\)/);
    assert.match(source, /\.addEventListener\('click', \(event\) => \{/);
    assert.match(source, /load\(entry\.target\)\.then\(\(\) => \{/);
});

test('rare pet rehatching requires an expedition capture and grants only N quality', () => {
    assert.match(source, /hasCapturedFamousPet\(entry, Object\.values\(state\.pets \|\| \{\}\), famousPetCaptureHistory\(\)\)/);
    assert.match(source, /data-rare-capture/);
    assert.match(source, /setView\('expeditionMap'\)/);
    assert.match(source, /snapshot\?\.\('N'\)/);
    assert.match(source, /battleStats: \{ \.\.\.quality\.stats \}/);
});
