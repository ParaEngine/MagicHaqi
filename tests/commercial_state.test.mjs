import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVipMembershipOptions, isRealPaymentEnabled, normalizeVipPurchaseRequest, syncVerifiedVipState } from '../js/commercial_state.js';

test('真实支付默认关闭且只接受显式布尔配置', () => {
    assert.equal(isRealPaymentEnabled(), false);
    assert.equal(isRealPaymentEnabled({}), false);
    assert.equal(isRealPaymentEnabled({ realPaymentEnabled: false }), false);
    assert.equal(isRealPaymentEnabled({ realPaymentEnabled: 'true' }), false);
    assert.equal(isRealPaymentEnabled({ realPaymentEnabled: 1 }), false);
    assert.equal(isRealPaymentEnabled({ realPaymentEnabled: true }), true);
});

test('真实会员核验结果双向覆盖本地权益缓存', () => {
    const state = { isPaid: false };

    assert.equal(syncVerifiedVipState(state, true), true);
    assert.equal(state.isPaid, true);
    assert.equal(syncVerifiedVipState(state, true), false);
    assert.equal(syncVerifiedVipState(state, false), true);
    assert.equal(state.isPaid, false);
});

test('无效核验结果不会改变本地权益', () => {
    const state = { isPaid: true };

    assert.equal(syncVerifiedVipState(state, undefined), false);
    assert.equal(state.isPaid, true);
});

test('会员套餐选择会传给官方 SDK 且忽略客户端价格', () => {
    const request = { scene:'keepwork_vip', tierId:'standard', planId:'month_6', packageId:'month_6', price:999999 };
    assert.deepEqual(normalizeVipPurchaseRequest(request), {
        scene:'keepwork_vip', tierId:'standard', planId:'month_6', packageId:'month_6',
    });
    assert.deepEqual(buildVipMembershipOptions(request), {
        from:'magichaqi', scene:'keepwork_vip', tierId:'standard', planId:'month_6', packageId:'month_6',
    });
});

test('会员套餐标识拒绝可注入支付参数的非法字符', () => {
    assert.deepEqual(normalizeVipPurchaseRequest({ scene:'', tierId:'standard&amount=1', planId:'../bad', packageId:'month_6' }), {
        scene:'minigame', tierId:'', planId:'', packageId:'month_6',
    });
});