import assert from 'node:assert/strict';
import test from 'node:test';

import {
    clearCoinLedger,
    exportCoinLedger,
    getCoinLedger,
    recordCoinTransaction,
    summarizeCoinLedger,
} from '../js/coin_ledger.js';

function createStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    };
}

const day = value => Date.parse(`2026-08-${String(value).padStart(2, '0')}T12:00:00`);

test('records sanitized income and expense balance snapshots', () => {
    const storage = createStorage();
    const income = recordCoinTransaction({ amount: 60, balanceAfter: 160, source: 'return route!', category: 'retention', planetId: 'haqi' }, { storage, now: day(1) });
    const expense = recordCoinTransaction({ amount: -5, balanceAfter: 155, source: 'clean-machine', category: 'care', planetId: 'haqi' }, { storage, now: day(1) + 1000 });
    assert.equal(income.balanceBefore, 100);
    assert.equal(income.source, 'return_route_');
    assert.equal(expense.balanceBefore, 160);
    assert.equal(expense.direction, 'expense');
    assert.equal(recordCoinTransaction({ amount: 0, balanceAfter: 155 }, { storage }), null);
});

test('isolates account and guest ledgers', () => {
    const storage = createStorage();
    recordCoinTransaction({ amount: 10, balanceAfter: 110, source: 'minigame' }, { storage, scope: 'account_1', now: day(1) });
    recordCoinTransaction({ amount: 20, balanceAfter: 120, source: 'minigame' }, { storage, scope: 'guest', now: day(1) });
    assert.equal(getCoinLedger({ storage, scope: 'account_1' })[0].amount, 10);
    assert.equal(getCoinLedger({ storage, scope: 'guest' })[0].amount, 20);
    clearCoinLedger({ storage, scope: 'guest' });
    assert.equal(getCoinLedger({ storage, scope: 'guest' }).length, 0);
});

test('summarizes D1 D3 D7 balances and source totals', () => {
    const storage = createStorage();
    recordCoinTransaction({ amount: 720, balanceAfter: 820, source: 'onboarding' }, { storage, now: day(1) });
    recordCoinTransaction({ amount: -20, balanceAfter: 800, source: 'shop' }, { storage, now: day(1) + 1000 });
    recordCoinTransaction({ amount: 60, balanceAfter: 860, source: 'return-route' }, { storage, now: day(3) });
    recordCoinTransaction({ amount: 40, balanceAfter: 900, source: 'minigame' }, { storage, now: day(7) });
    const summary = summarizeCoinLedger({ storage });
    assert.deepEqual(summary.checkpoints, {
        d1: { balance: 800, income: 720, expense: 20, transactions: 2 },
        d3: { balance: 860, income: 780, expense: 20, transactions: 3 },
        d7: { balance: 900, income: 820, expense: 20, transactions: 4 },
    });
    assert.deepEqual(summary.incomeBySource, { onboarding: 720, 'return-route': 60, minigame: 40 });
    assert.deepEqual(summary.expenseBySource, { shop: 20 });
    assert.equal(JSON.parse(exportCoinLedger({ storage, now: day(8) })).entries.length, 4);
});

test('caps the ledger at 500 transactions', () => {
    const storage = createStorage();
    for (let index = 0; index < 505; index += 1) {
        recordCoinTransaction({ amount: 1, balanceAfter: index + 1, source: 'test' }, { storage, now: day(1) + index });
    }
    const entries = getCoinLedger({ storage });
    assert.equal(entries.length, 500);
    assert.equal(entries[0].balanceAfter, 6);
}
);