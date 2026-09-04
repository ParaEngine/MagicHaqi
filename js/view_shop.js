// 商店视图
import { $, $$, coinIconSvg, escapeHtml, renderVisualAsset, showToast } from './utils.js';
import { itemName, t } from './i18n.js';
import { canPlaceItemInArea, CONFIG, DECO_VISUALS, OUTDOOR_FIELD_IDS, SHOP_ITEMS } from './config.js';
import { state } from './state.js';

const OUTDOOR_AREAS = OUTDOOR_FIELD_IDS;
const INDOOR_AREAS = CONFIG.rooms.map(room => room.id);

const SHOP_FILTERS = [
    { id: 'all', icon: '▦', labelKey: 'catAll', matches: () => true },
    { id: 'food', icon: '🍎', labelKey: 'catFood', matches: item => item.type === 'food' },
    { id: 'outdoor', icon: '🍃', labelKey: 'catOutdoor', matches: item => isFurnitureItem(item) && OUTDOOR_AREAS.some(area => canPlaceItemInArea(item, area)) },
    { id: 'indoor', icon: '♟', labelKey: 'catIndoor', matches: item => isFurnitureItem(item) && INDOOR_AREAS.some(area => canPlaceItemInArea(item, area)) },
    { id: 'toy', icon: '🧸', labelKey: 'catToy', matches: item => item.type === 'toy' },
    { id: 'house', icon: '⌂', labelKey: 'catHouse', matches: item => item.type === 'house' },
    { id: 'furniture', icon: '▰', labelKey: 'catFurniture', matches: isFurnitureItem },
    { id: 'land', icon: '▲', labelKey: 'catLand', matches: item => isFurnitureItem(item) && canPlaceItemInArea(item, 'land') },
    { id: 'water', icon: '💧', labelKey: 'catWater', matches: item => isFurnitureItem(item) && canPlaceItemInArea(item, 'water') },
    { id: 'sky', icon: '☁', labelKey: 'catSky', matches: item => isFurnitureItem(item) && canPlaceItemInArea(item, 'sky') },
];

let currentShopFilter = 'all';
let currentShopPage = 0;
let suppressInitialShopClickUntil = 0;

export function setShopFilter(filterId = 'all') {
    currentShopFilter = SHOP_FILTERS.some(filter => filter.id === filterId) ? filterId : 'all';
    currentShopPage = 0;
}

export function suppressShopInitialClick(durationMs = 450) {
    suppressInitialShopClickUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
}

export function renderShop(panel, _data, { onBuy, onBack } = {}) {
    panel.__mhShopResizeCleanup?.();
    panel.innerHTML = `
        <section class="mh-shop-view">
            <header class="mh-shop-header">
                <h1 class="mh-shop-title" aria-label="${escapeHtml(t('shop'))}"></h1>
                <div class="mh-shop-wallet"><span>${state.coins}</span></div>
            </header>
            <div class="shop-filter-panel">
                <div class="shop-filter-row" aria-label="${escapeHtml(t('shopFilterAria'))}">
                    ${SHOP_FILTERS.map(filter => renderFilterButton(filter)).join('')}
                </div>
            </div>
            <main class="mh-shop-grid" id="mhShopGrid"></main>
            <footer class="mh-shop-footer">
                <button class="mh-shop-back" id="mhBack" type="button" aria-label="${escapeHtml(t('back'))}"></button>
                <nav class="mh-shop-pager" id="mhShopPager" aria-label="${escapeHtml(t('shop'))}"></nav>
                <div class="mh-shop-corner" aria-hidden="true"></div>
            </footer>
        </section>`;
    bindInitialClickBlocker(panel);
    if ($('mhBack')) $('mhBack').onclick = () => onBack?.();

    $$('[data-shop-filter]').forEach(el => {
        el.onclick = () => {
            currentShopFilter = el.dataset.value || 'all';
            currentShopPage = 0;
            renderShopItems(onBuy);
            refreshFilterButtons(panel);
        };
    });

    renderShopItems(onBuy);
    bindShopResize(panel, onBuy);
}

function bindShopResize(panel, onBuy) {
    let pageSize = getShopPageSize();
    const handleResize = () => {
        const nextPageSize = getShopPageSize();
        if (nextPageSize === pageSize || !panel.querySelector('#mhShopGrid')) return;
        pageSize = nextPageSize;
        renderShopItems(onBuy);
    };
    window.addEventListener('resize', handleResize, { passive: true });
    panel.__mhShopResizeCleanup = () => {
        window.removeEventListener('resize', handleResize);
    };
}

function bindInitialClickBlocker(panel) {
    if (!panel || panel.__mhShopInitialClickBlocker) return;
    const block = (e) => {
        if (Date.now() >= suppressInitialShopClickUntil) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
    };
    panel.__mhShopInitialClickBlocker = block;
    ['click', 'mouseup', 'mousedown'].forEach(type => panel.addEventListener(type, block, true));
}

function renderFilterButton(filter) {
    const active = filter.id === currentShopFilter ? ' active' : '';
    return `
        <button class="shop-filter-chip${active}" type="button" data-shop-filter="preset" data-value="${escapeHtml(filter.id)}">
            <span class="shop-filter-icon" aria-hidden="true">${escapeHtml(filter.icon)}</span>
            <span>${escapeHtml(t(filter.labelKey))}</span>
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
    const pageSize = getShopPageSize();
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    currentShopPage = Math.min(currentShopPage, pageCount - 1);
    const visibleItems = items.slice(currentShopPage * pageSize, (currentShopPage + 1) * pageSize);
    const inv = state.inventory || {};
    grid.innerHTML = visibleItems.length ? visibleItems.map(item => {
        const owned = item.uniqueItem && (inv[item.id] || 0) > 0;
        const name = itemName(item.name);
        return `
        <div class="shop-item${owned ? ' is-owned' : ''}" data-buy="${escapeHtml(item.id)}"${owned ? ' data-owned="1"' : ''}>
            ${renderShopItemIcon(item)}
            <div class="name">${escapeHtml(name)}</div>
            <div class="price mh-coin-amount">${owned ? escapeHtml(t('owned')) : item.price}</div>
        </div>`;
    }).join('') : `<div class="shop-empty">${escapeHtml(t('shopEmpty'))}</div>`;

    grid.querySelectorAll('[data-buy]').forEach(el => {
        el.onclick = () => {
            if (el.dataset.owned === '1') { showToast(t('ownedUnique'), 'info'); return; }
            const id = el.dataset.buy;
            const item = SHOP_ITEMS.find(candidate => candidate.id === id);
            if (!item) return;
            if (state.coins < item.price) { showToast(t('notEnoughCoins'), 'error'); return; }
            showBuyConfirm(item, onBuy);
        };
    });
    renderShopPager(pageCount, onBuy);
}

function getShopPageSize() {
    if (window.matchMedia('(max-width: 520px)').matches) return 8;
    if (window.matchMedia('(max-width: 1024px)').matches) return 12;
    return 15;
}

function renderShopPager(pageCount, onBuy) {
    const pager = $('mhShopPager');
    if (!pager) return;
    pager.innerHTML = `
        <button type="button" data-shop-page="prev" aria-label="Previous page"${currentShopPage === 0 ? ' disabled' : ''}></button>
        <span>${currentShopPage + 1} / ${pageCount}</span>
        <button type="button" data-shop-page="next" aria-label="Next page"${currentShopPage >= pageCount - 1 ? ' disabled' : ''}></button>`;
    pager.querySelectorAll('[data-shop-page]').forEach(button => {
        button.onclick = () => {
            currentShopPage += button.dataset.shopPage === 'next' ? 1 : -1;
            renderShopItems(onBuy);
        };
    });
}

function getShopItemVisual(item) {
    const visual = DECO_VISUALS[item?.id] || {};
    return {
        ...visual,
        svg: item?.svg || visual.svg,
        imageUrl: item?.imageUrl || visual.imageUrl,
    };
}

function renderShopItemIcon(item) {
    const visualHtml = renderVisualAsset(getShopItemVisual(item), { className: 'shop-item-img', alt: itemName(item?.name) || '' });
    return visualHtml
        ? `<div class="emoji shop-item-visual">${visualHtml}</div>`
        : `<div class="emoji">${escapeHtml(item?.emoji || '')}</div>`;
}

function renderBuyConfirmIcon(item) {
    const visualHtml = renderVisualAsset(getShopItemVisual(item), { className: 'shop-buy-confirm-img', alt: itemName(item?.name) || '' });
    return visualHtml || escapeHtml(item?.emoji || '');
}

function showBuyConfirm(item, onBuy) {
    let maxQty = item.price > 0 ? Math.floor(state.coins / item.price) : 99;
    if (item.uniqueItem) maxQty = 1;
    if (maxQty < 1) { showToast(t('notEnoughCoins'), 'error'); return; }

    let qty = 1;
    const name = itemName(item.name);
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-buy-modal-mask';
    mask.innerHTML = `
        <div class="modal-card text-center mh-buy-modal-card">
            <div class="text-4xl mb-2 mh-buy-confirm-icon" style="display:flex;align-items:center;justify-content:center">${renderBuyConfirmIcon(item)}</div>
            <div class="text-base font-bold mb-1" style="color:var(--text-primary)">${escapeHtml(name)}</div>
            <div class="text-xs mb-4" style="color:var(--text-muted)">${escapeHtml(t('maxBuyQty', { max: maxQty }))}</div>
            <div class="flex items-center justify-center gap-1 mb-3 mh-buy-qty-row" style="flex-wrap:wrap">
                <button class="btn-secondary" type="button" data-buy-step="min" title="${escapeHtml(t('qtyMin'))}">&lt;&lt;</button>
                <button class="btn-secondary" type="button" data-buy-step="dec" title="${escapeHtml(t('qtyDec'))}">&lt;</button>
                <div style="min-width:72px;padding:9px 12px;border-radius:14px;background:var(--input-bg);border:1.5px solid var(--border-card);font-size:20px;font-weight:900;color:var(--text-primary)" data-buy-qty>1</div>
                <button class="btn-secondary" type="button" data-buy-step="inc" title="${escapeHtml(t('qtyInc'))}">&gt;</button>
                <button class="btn-secondary" type="button" data-buy-step="double" title="${escapeHtml(t('qtyDouble'))}">&gt;&gt;</button>
                <button class="btn-secondary" type="button" data-buy-step="max" title="${escapeHtml(t('qtyMax'))}">${escapeHtml(t('qtyMax'))}</button>
            </div>
            <div class="font-bold mh-coin-amount mb-4" style="justify-content:center;color:var(--accent-dark)" data-buy-total>${coinIconSvg()} ${item.price}</div>
            <div class="flex gap-2 justify-center mh-buy-actions">
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
