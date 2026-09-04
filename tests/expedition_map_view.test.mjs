import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { expeditionPetReadiness } from '../js/view_expedition_map.js';

const source = await readFile(new URL('../js/view_expedition_map.js', import.meta.url), 'utf8');

test('远征记录点击会展开可见详情并保留宿主回调', () => {
    assert.match(source, /class="expedition-map__history-detail"/);
    assert.match(source, /button\.setAttribute\('aria-expanded', String\(expanded\)\)/);
    assert.match(source, /if \(detail\) detail\.hidden = !expanded/);
    assert.match(source, /if \(expanded\) onReviewHistory\?\.\(button\.dataset\.expeditionHistory\)/);
});

test('远征历史摘要和详情共用章节进度口径', () => {
    assert.match(source, /const progress = formatExpeditionHistoryProgress\(item\)/);
    assert.match(source, /<strong>\$\{escapeHtml\(progress\)\}<\/strong>/);
});

test('远征准备使用与首页一致的体力阈值提示照料关系', () => {
    assert.deepEqual(expeditionPetReadiness({ stats: { hunger: 34 } }), {
        energy: 34,
        needsCare: true,
        label: '体力 34/100 · 建议先照料',
    });
    assert.deepEqual(expeditionPetReadiness({ stats: { hunger: 35 } }), {
        energy: 35,
        needsCare: false,
        label: '体力 35/100 · 状态良好',
    });
    assert.match(source, /也可以继续出发/);
    assert.match(source, /data-expedition-launch type="button" \$\{expedition && pet \? '' : 'disabled'\}/);
});