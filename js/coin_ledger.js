const STORAGE_KEY = 'mh_coin_ledger_v1';
const MAX_ENTRIES = 500;
let scopeResolver = null;

function safeStorage(storage) {
    if (storage) return storage;
    try { return globalThis.localStorage || null; } catch (_) { return null; }
}

function cleanText(value, maxLength = 80) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function resolveScope(scope) {
    const value = scope ?? scopeResolver?.();
    return cleanText(value || 'anonymous', 80).replace(/[^a-zA-Z0-9_-]/g, '_') || 'anonymous';
}

function storageKey(scope) {
    return `${STORAGE_KEY}:${resolveScope(scope)}`;
}

function readEntries(storage, scope) {
    const target = safeStorage(storage);
    if (!target) return [];
    try {
        const value = JSON.parse(target.getItem(storageKey(scope)) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (_) {
        return [];
    }
}

function localDayNumber(timestamp) {
    const date = new Date(timestamp);
    return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86400000);
}

export function configureCoinLedgerScope(resolver) {
    scopeResolver = typeof resolver === 'function' ? resolver : null;
}

export function recordCoinTransaction(transaction = {}, options = {}) {
    const storage = safeStorage(options.storage);
    if (!storage) return null;
    const amount = Math.trunc(Number(transaction.amount) || 0);
    const balanceAfter = Math.max(0, Math.trunc(Number(transaction.balanceAfter) || 0));
    if (!amount) return null;
    const now = Math.max(0, Number(options.now) || Date.now());
    const entry = {
        id: `${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: now,
        amount,
        balanceBefore: Math.max(0, balanceAfter - amount),
        balanceAfter,
        direction: amount > 0 ? 'income' : 'expense',
        source: cleanText(transaction.source || 'unknown', 60).replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown',
        category: cleanText(transaction.category || (amount > 0 ? 'other-income' : 'other-expense'), 60).replace(/[^a-zA-Z0-9_-]/g, '_'),
        planetId: cleanText(transaction.planetId || '', 64).replace(/[^a-zA-Z0-9_-]/g, '_'),
    };
    try {
        const entries = readEntries(storage, options.scope);
        storage.setItem(storageKey(options.scope), JSON.stringify([...entries, entry].slice(-MAX_ENTRIES)));
        return entry;
    } catch (_) {
        return null;
    }
}

export function getCoinLedger(options = {}) {
    return readEntries(options.storage, options.scope).map(entry => ({ ...entry }));
}

function totalsBySource(entries, direction) {
    const totals = {};
    entries.filter(entry => entry.direction === direction).forEach(entry => {
        totals[entry.source] = (totals[entry.source] || 0) + Math.abs(entry.amount);
    });
    return totals;
}

export function summarizeCoinLedger(options = {}) {
    const entries = getCoinLedger(options).sort((left, right) => left.timestamp - right.timestamp);
    const firstDay = entries.length ? localDayNumber(entries[0].timestamp) : 0;
    const checkpoints = {};
    for (const targetDay of [1, 3, 7]) {
        const eligible = entries.filter(entry => localDayNumber(entry.timestamp) - firstDay + 1 <= targetDay);
        const income = eligible.filter(entry => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0);
        const expense = eligible.filter(entry => entry.amount < 0).reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
        checkpoints[`d${targetDay}`] = {
            balance: eligible.at(-1)?.balanceAfter ?? null,
            income,
            expense,
            transactions: eligible.length,
        };
    }
    return {
        transactionCount: entries.length,
        firstAt: entries[0]?.timestamp || 0,
        lastAt: entries.at(-1)?.timestamp || 0,
        currentBalance: entries.at(-1)?.balanceAfter ?? null,
        incomeBySource: totalsBySource(entries, 'income'),
        expenseBySource: totalsBySource(entries, 'expense'),
        checkpoints,
    };
}

export function exportCoinLedger(options = {}) {
    return JSON.stringify({
        version: 1,
        exportedAt: Math.max(0, Number(options.now) || Date.now()),
        summary: summarizeCoinLedger(options),
        entries: getCoinLedger(options),
    }, null, 2);
}

export function clearCoinLedger(options = {}) {
    try { safeStorage(options.storage)?.removeItem(storageKey(options.scope)); } catch (_) {}
}