import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const profileSource = await readFile(new URL('../js/view_profile.js', import.meta.url), 'utf8');
const homeSource = await readFile(new URL('../js/view_home.js', import.meta.url), 'utf8');

test('pet profile replaces its text title with centered proportional artwork', () => {
    assert.match(profileSource, /class="mh-profile-title-art" src="https:\/\/cdn\.keepwork\.com\/keepwork\/cdn\/magichaqi\/assets\/ui\/profile\/cc1-520\.webp" width="520" height="151" alt="档案"/);
    assert.match(profileSource, /<div class="topbar mh-profile-topbar" style="height:140px">/);
    assert.match(profileSource, /width:auto;max-width:calc\(100% - 96px\);height:auto;max-height:132px;margin:0 auto;object-fit:contain/);
    assert.match(profileSource, /<div class="absolute mh-profile-stage" style="top:140px;/);
    assert.doesNotMatch(profileSource, /📋 \$\{escapeHtml\(t\('profile'\)\)\}/);
});

test('pet profile uses equal halves with the sliced profile artwork', () => {
    assert.match(profileSource, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
    assert.match(profileSource, /star-map-background\.webp/);
    assert.match(profileSource, /data-profile-side="left"/);
    assert.match(profileSource, /data-profile-side="right"/);
    assert.match(profileSource, /profile-pet-frame\.webp/);
    assert.match(profileSource, /profile-companion-status-frame\.webp/);
    assert.match(profileSource, /profile-info-frame-1\.webp/);
    assert.match(profileSource, /profile-info-frame-2\.webp/);
    assert.match(profileSource, /profile-info-frame-3\.webp/);
    assert.match(profileSource, /data-profile-panel="care"/);
    assert.match(profileSource, /class="mh-profile-care-title">饲养状态<\/div>/);
    assert.match(profileSource, /data-profile-panel="body"/);
    assert.match(profileSource, /data-profile-panel="dna"/);
    assert.match(profileSource, /data-profile-panel="memory"/);
    assert.match(profileSource, /--profile-stack-gap:8px/);
    assert.match(profileSource, /container-type:size/);
    assert.match(profileSource, /@media \(max-width:900px\), \(hover:none\) and \(pointer:coarse\)/);
    assert.match(profileSource, /\.mh-profile-left-column, \.mh-profile-right \{ display:contents \}/);
    assert.match(profileSource, /flex-direction:column/);
    assert.match(profileSource, /\.mh-profile-right \{[^}]*width:min\(calc\(69\.7127329193% - var\(--profile-stack-gap\) \* \.7639751553\)/);
    assert.match(profileSource, /transform:translateY\(calc\(min\(/);
    assert.match(profileSource, /--profile-align-nudge:\.235px/);
    assert.match(profileSource, /100cqh/);
    assert.match(profileSource, /\.mh-profile-info-body \{ top:36% \}/);
    assert.match(profileSource, /\[data-profile-panel="dna"\] \.mh-profile-info-body \{ top:42%;bottom:-4% \}/);
    assert.match(profileSource, /\[data-profile-panel="dna"\] \{ aspect-ratio:615\/277 \}/);
    assert.match(profileSource, /\[data-profile-panel="memory"\] \{ aspect-ratio:615\/274 \}/);
    assert.match(profileSource, /top:140px;left:0;right:0;bottom:0;overflow:hidden/);
    assert.match(profileSource, /<div class="mh-profile-left-column" data-profile-side="left">[\s\S]*data-profile-panel="care"[\s\S]*<div class="mh-profile-right" data-profile-side="right">[\s\S]*data-profile-panel="body"[\s\S]*data-profile-panel="dna"[\s\S]*data-profile-panel="memory"/);
    assert.match(profileSource, /\['精力', lifeStats\.energy/);
    assert.match(profileSource, /\['心情', lifeStats\.mood/);
    assert.match(profileSource, /\['清洁', lifeStats\.clean/);
    assert.match(profileSource, /\['羁绊', lifeStats\.bond/);
    assert.match(profileSource, /mh-profile-dna-code font-mono/);
    assert.match(profileSource, /\.mh-profile-dna-secondary \{ white-space:nowrap;overflow:hidden;text-overflow:ellipsis \}/);
    assert.match(profileSource, /\[data-profile-panel="dna"\] \.mh-profile-info-body \{ top:36%;bottom:0 \}/);
    assert.doesNotMatch(profileSource, /mh-profile-info-body \{[^}]*overflow:auto/);
    assert.doesNotMatch(profileSource, /class="card-flat/);
});

test('home dock calls the exploration archive entry exploration records', () => {
    assert.match(homeSource, /k: 'haqiExplorationArchive',[^\n]*label: '探索记录'/);
    assert.doesNotMatch(homeSource, /k: 'haqiExplorationArchive',[^\n]*label: '探索档案'/);
});