// 商店视图
import { $, $$, coinIconSvg, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { canPlaceItemInArea, CONFIG, SHOP_ITEMS } from './config.js';
import { state } from './state.js';

const OUTDOOR_AREAS = ['land', 'water', 'sky'];
const INDOOR_AREAS = CONFIG.rooms.map(room => room.id);

const SHOP_FILTERS = [
    { id: 'all', label: '全部', matches: () => true },
    { id: 'food', label: '食物', matches: item => item.type === 'food' },
    { id: 'toy', label: '玩具', matches: item => item.type === 'toy' },
    { id: 'furniture', label: '家具/设施', matches: isFurnitureItem },
    { id: 'house', label: '房屋', matches: item => item.type === 'house' },
    { id: 'indoor', label: '室内', matches: item => isFurnitureItem(item) && INDOOR_AREAS.some(area => canPlaceItemInArea(item, area)) },
    { id: 'outdoor', label: '户外设施', matches: item => isFurnitureItem(item) && OUTDOOR_AREAS.some(area => canPlaceItemInArea(item, area)) },
    { id: 'land', label: '陆地', matches: item => isFurnitureItem(item) && canPlaceItemInArea(item, 'land') },
    { id: 'water', label: '水域', matches: item => isFurnitureItem(item) && canPlaceItemInArea(item, 'water') },
    { id: 'sky', label: '天空', matches: item => isFurnitureItem(item) && canPlaceItemInArea(item, 'sky') },
];

let currentShopFilter = 'all';

export function renderShop(panel, _data, { onBuy, onBack } = {}) {
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">🛒 ${escapeHtml(t('shop'))}</span>
            <span class="font-bold text-sm mh-coin-amount" style="color:var(--accent-dark)">${coinIconSvg()} ${state.coins}</span>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:14px">
            <div class="shop-filter-panel">
                <div class="shop-filter-row" aria-label="商店筛选">
                    ${SHOP_FILTERS.map(filter => renderFilterButton(filter)).join('')}
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2" id="mhShopGrid"></div>
        </div>`;
    if ($('mhBack')) $('mhBack').onclick = () => onBack?.();

    $$('[data-shop-filter]').forEach(el => {
        el.onclick = () => {
            currentShopFilter = el.dataset.value || 'all';
            renderShopItems(onBuy);
            refreshFilterButtons(panel);
        };
    });

    renderShopItems(onBuy);
}

function renderFilterButton(filter) {
    const active = filter.id === currentShopFilter ? ' active' : '';
    return `
        <button class="btn-secondary shop-filter-chip${active}" type="button" data-shop-filter="preset" data-value="${escapeHtml(filter.id)}">
            ${escapeHtml(filter.label)}
        </button>`;
}

function refreshFilterButtons(root) {
    root.querySelectorAll('[data-shop-filter="preset"]').forEach(button => {
        button.classList.toggle('active', button.dataset.value === currentShopFilter);
    });
}

function renderShopItems(onBuy) {
    const grid = $('mhShopGrid');
    if (!grid) return;
    const items = SHOP_ITEMS.filter(item => !item.remoteOnly && !item.hiddenFromShop && matchesShopFilter(item));
    const inv = state.inventory || {};
    grid.innerHTML = items.length ? items.map(item => {
        const owned = item.uniqueItem && (inv[item.id] || 0) > 0;
        return `
        <div class="shop-item${owned ? ' is-owned' : ''}" data-buy="${escapeHtml(item.id)}"${owned ? ' data-owned="1"' : ''}>
            <div class="emoji">${item.emoji}</div>
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="price mh-coin-amount">${owned ? '已拥有' : `${coinIconSvg()} ${item.price}`}</div>
        </div>`;
    }).join('') : `<div class="shop-empty col-span-3">没有符合筛选的商品</div>`;

    grid.querySelectorAll('[data-buy]').forEach(el => {
        el.onclick = () => {
            if (el.dataset.owned === '1') { showToast('已拥有唯一物品，无法重复购买', 'info'); return; }
            const id = el.dataset.buy;
            const item = SHOP_ITEMS.find(candidate => candidate.id === id);
            if (!item) return;
            if (state.coins < item.price) { showToast(t('notEnoughCoins'), 'error'); return; }
            showBuyConfirm(item, onBuy);
        };
    });
}

function showBuyConfirm(item, onBuy) {
    let maxQty = item.price > 0 ? Math.floor(state.coins / item.price) : 99;
    if (item.uniqueItem) maxQty = 1;
    if (maxQty < 1) { showToast(t('notEnoughCoins'), 'error'); return; }

    let qty = 1;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card text-center">
            <div class="text-4xl mb-2">${item.emoji}</div>
            <div class="text-base font-bold mb-1" style="color:var(--text-primary)">${escapeHtml(item.name)}</div>
            <div class="text-xs mb-4" style="color:var(--text-muted)">最多可购买 ${maxQty} 个</div>
            <div class="flex items-center justify-center gap-1 mb-3" style="flex-wrap:wrap">
                <button class="btn-secondary" type="button" data-buy-step="min" title="最少">&lt;&lt;</button>
                <button class="btn-secondary" type="button" data-buy-step="dec" title="减少">&lt;</button>
                <div style="min-width:72px;padding:9px 12px;border-radius:14px;background:var(--input-bg);border:1.5px solid var(--border-card);font-size:20px;font-weight:900;color:var(--text-primary)" data-buy-qty>1</div>
                <button class="btn-secondary" type="button" data-buy-step="inc" title="增加">&gt;</button>
                <button class="btn-secondary" type="button" data-buy-step="double" title="翻倍">&gt;&gt;</button>
                <button class="btn-secondary" type="button" data-buy-step="max" title="全部">全部</button>
            </div>
            <div class="font-bold mh-coin-amount mb-4" style="justify-content:center;color:var(--accent-dark)" data-buy-total>${coinIconSvg()} ${item.price}</div>
            <div class="flex gap-2 justify-center">
                <button class="btn-secondary" type="button" data-buy-act="cancel">${escapeHtml(t('cancel'))}</button>
                <button class="btn-primary" type="button" data-buy-act="ok">${escapeHtml(t('confirm'))}</button>
            </div>
        </div>`;

    const qtyEl = mask.querySelector('[data-buy-qty]');
    const totalEl = mask.querySelector('[data-buy-total]');
    const minBtn = mask.querySelector('[data-buy-step="min"]');
    const decBtn = mask.querySelector('[data-buy-step="dec"]');
    const incBtn = mask.querySelector('[data-buy-step="inc"]');
    const doubleBtn = mask.querySelector('[data-buy-step="double"]');
    const maxBtn = mask.querySelector('[data-buy-step="max"]');
    const update = () => {
        qtyEl.textContent = String(qty);
        totalEl.innerHTML = `${coinIconSvg()} ${item.price * qty}`;
        minBtn.disabled = qty <= 1;
        decBtn.disabled = qty <= 1;
        incBtn.disabled = qty >= maxQty;
        doubleBtn.disabled = qty >= maxQty;
        maxBtn.disabled = qty >= maxQty;
    };
    const close = () => mask.remove();

    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-buy-act="cancel"]')) {
            close();
            return;
        }
        if (e.target.closest?.('[data-buy-step="inc"]')) {
            qty = Math.min(maxQty, qty + 1);
            update();
            return;
        }
        if (e.target.closest?.('[data-buy-step="dec"]')) {
            qty = Math.max(1, qty - 1);
            update();
            return;
        }
        if (e.target.closest?.('[data-buy-step="min"]')) {
            qty = 1;
            update();
            return;
        }
        if (e.target.closest?.('[data-buy-step="double"]')) {
            qty = Math.min(maxQty, qty * 2);
            update();
            return;
        }
        if (e.target.closest?.('[data-buy-step="max"]')) {
            qty = maxQty;
            update();
            return;
        }
        if (e.target.closest?.('[data-buy-act="ok"]')) {
            close();
            onBuy?.(item, qty);
        }
    });

    update();
    document.body.appendChild(mask);
}

function matchesShopFilter(item) {
    const filter = SHOP_FILTERS.find(candidate => candidate.id === currentShopFilter) || SHOP_FILTERS[0];
    return filter.matches(item);
}

function isFurnitureItem(item) {
    return item.type === 'furniture' || item.type === 'house';
}
