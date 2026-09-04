import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/view_minigames.js', import.meta.url), 'utf8');

test('免费邀请版不会把广告解锁交给可能展示支付入口的 SDK', () => {
    assert.match(source, /if \(isRealPaymentEnabled\(\) && ads && typeof ads\.requestUnlock === 'function'\)/);
    assert.match(source, /else \{\s*res = await localUnlockFallback\(title\);/);
});

test('真实支付最终入口默认受发行配置门禁保护', () => {
    const start = source.indexOf('async function openVipPayFlow');
    const end = source.indexOf('// 小游戏内点击', start);
    const implementation = source.slice(start, end);

    assert.match(implementation, /if \(!isRealPaymentEnabled\(\)\) return false;/);
    assert.match(implementation, /sdk\.ads\.openVipMembership/);
    assert.match(implementation, /\/p\/vb\/vipPayOrder/);
});

test('支付关闭时直接会员消息只核验权益且降级弹层不渲染会员按钮', () => {
    const openStart = source.indexOf('async function handleOpenVipRequest');
    const openEnd = source.indexOf('// 解锁付费点', openStart);
    const openImplementation = source.slice(openStart, openEnd);
    const choiceStart = source.indexOf('function chooseUnlockAction');
    const choiceEnd = source.indexOf('// 降级兜底', choiceStart);
    const choiceImplementation = source.slice(choiceStart, choiceEnd);

    assert.match(openImplementation, /if \(isRealPaymentEnabled\(\)\) \{/);
    assert.match(openImplementation, /const isVip = await isUserVipNow\(true\);/);
    assert.match(choiceImplementation, /const paymentEnabled = isRealPaymentEnabled\(\);/);
    assert.match(choiceImplementation, /\$\{paymentEnabled \? '<button class="btn-secondary" data-act="vip"/);
});