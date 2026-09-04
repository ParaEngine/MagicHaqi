import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const homeSource = fs.readFileSync(new URL('../js/view_home.js', import.meta.url), 'utf8');
const fieldSource = fs.readFileSync(new URL('../js/level_field.js', import.meta.url), 'utf8');

test('首页右上 HUD 使用五张 CDN 美术并保留实时数值', () => {
    ['mood', 'biofuel', 'coins', 'menu'].forEach(name => {
        assert.match(homeSource, new RegExp(`home-hud-${name}-v4\\.webp`));
    });
    assert.match(fieldSource, /home-hud-music-v4\.webp/);

    assert.match(homeSource, /data-mh-topbar-stat-value=/);
    assert.match(homeSource, /data-hud-value="biofuel"/);
    assert.match(homeSource, /data-hud-value="coins"/);
});

test('菜单与音乐继续沿用既有交互钩子', () => {
    assert.match(homeSource, /id="mhMenuBtn"/);
    assert.match(homeSource, /menuButton\.onclick/);
    assert.match(homeSource, /menuButton\.oncontextmenu/);

    assert.match(fieldSource, /data-field-music-toggle/);
    assert.match(fieldSource, /soundManager\.toggleBgMusicMuted/);
    assert.match(fieldSource, /setAttribute\('aria-pressed'/);
});