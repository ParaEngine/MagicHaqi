// 背包视图
import { $, $$, coinIconSvg, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { getShopItemById } from './config.js';
import { state } from './state.js';

const ITEM_BY_ID = new Proxy({}, { get: (_, id) => getShopItemById(id) });

function getInventoryItemHint(item) {
    if (item?.type === 'furniture') return t('invHintFurniture', { name: item.name });
    if (item?.type === 'food') return t('invHintFood', { name: item.name });
    return t('invHintDefault', { name: item?.name || t('invHintThisItem') });
}

export function renderInventory(panel, _data, { onBack, onSell, onReorder } = {}) {
    const inv = state.inventory || {};
    const savedOrder = Array.isArray(state.inventoryOrder) ? state.inventoryOrder : [];
    const ownedIds = Object.keys(inv).filter(id => (inv[id] || 0) > 0 && ITEM_BY_ID[id]);
    const ownedSet = new Set(ownedIds);
    // Preserve saved order for known ids, then append any new ids not yet ordered.
    const orderedIds = [
        ...savedOrder.filter(id => ownedSet.has(id)),
        ...ownedIds.filter(id => !savedOrder.includes(id)),
    ];
    const entries = orderedIds.map(id => ({ ...ITEM_BY_ID[id], qty: inv[id] }));

    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">🎒 ${escapeHtml(t('inventory'))}</span>
            <span class="font-bold text-sm mh-coin-amount" style="color:var(--accent-dark)">${coinIconSvg()} ${state.coins}</span>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:14px">
            ${entries.length === 0
                ? `<div class="card-flat text-center" style="color:var(--text-muted);padding:30px">${escapeHtml(t('inventoryEmpty'))}</div>`
                : `<div class="grid grid-cols-3 gap-2" id="mhInvGrid">
                    ${entries.map(it => `
                        <div class="shop-item mh-inv-item" draggable="true" data-iid="${escapeHtml(it.id)}" data-type="${escapeHtml(it.type)}">
                            <div class="emoji">${it.emoji}</div>
                            <div class="name">${escapeHtml(it.name)} ×${(it.unlimited || it.uniqueItem) ? '∞' : it.qty}</div>
                        </div>
                    `).join('')}
                </div>`}
        </div>`;
    if ($('mhBack')) $('mhBack').onclick = () => onBack?.();

    const grid = $('mhInvGrid');
    if (grid && entries.length > 0) {
        wireDragReorder(grid, orderedIds, onReorder);
    }

    $$('[data-iid]').forEach(el => {
        el.onclick = () => {
            // Suppress click that ended a drag.
            if (el.dataset.dragSuppress === '1') { delete el.dataset.dragSuppress; return; }
            const id = el.dataset.iid;
            const type = el.dataset.type;
            const it = ITEM_BY_ID[id];
            if (!it) return;
            const owned = inv[id] || 0;
            if (it.unlimited || !it.price || owned < 1) {
                showToast(getInventoryItemHint({ ...it, type }), 'info', 2600);
                return;
            }
            showSellConfirm({ ...it, qty: owned }, onSell);
        };
    });
}

function wireDragReorder(grid, initialIds, onReorder) {
    let dragId = null;
    let dragEl = null;
    let touchClone = null;
    let touchActive = false;

    const currentIds = () => Array.from(grid.querySelectorAll('[data-iid]')).map(el => el.dataset.iid);

    const moveDragged = (targetEl, clientX, clientY) => {
        if (!dragEl || !targetEl || targetEl === dragEl) return;
        const rect = targetEl.getBoundingClientRect();
        const horizontal = clientX < rect.left + rect.width / 2;
        const vertical = clientY < rect.top + rect.height / 2;
        const before = horizontal || vertical;
        if (before) targetEl.parentNode.insertBefore(dragEl, targetEl);
        else targetEl.parentNode.insertBefore(dragEl, targetEl.nextSibling);
    };

    const commit = () => {
        if (!dragEl) return;
        dragEl.classList.remove('mh-inv-dragging');
        dragEl.dataset.dragSuppress = '1';
        const next = currentIds();
        const before = initialIds.join('|');
        const after = next.join('|');
        dragEl = null;
        dragId = null;
        if (before !== after) onReorder?.(next);
    };

    grid.addEventListener('dragstart', (e) => {
        const item = e.target.closest?.('[data-iid]');
        if (!item) return;
        dragEl = item;
        dragId = item.dataset.iid;
        item.classList.add('mh-inv-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (_) {}
    });
    grid.addEventListener('dragover', (e) => {
        if (!dragEl) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
        const target = e.target.closest?.('[data-iid]');
        if (target) moveDragged(target, e.clientX, e.clientY);
    });
    grid.addEventListener('drop', (e) => {
        if (!dragEl) return;
        e.preventDefault();
        commit();
    });
    grid.addEventListener('dragend', () => { if (dragEl) commit(); });

    // Touch fallback (mobile): a floating clone follows the finger so the
    // user can see what they are dragging. Start threshold avoids hijacking taps.
    let touchStartX = 0;
    let touchStartY = 0;
    let cloneOriginX = 0;
    let cloneOriginY = 0;
    let cloneOffsetX = 0;
    let cloneOffsetY = 0;
    let pendingX = 0;
    let pendingY = 0;
    let rafId = 0;
    const TOUCH_THRESHOLD = 6;

    const applyFrame = () => {
        rafId = 0;
        if (!dragEl) return;
        // Move clone with transform (compositor-only, no layout).
        if (touchClone) {
            const dx = pendingX - cloneOriginX - cloneOffsetX;
            const dy = pendingY - cloneOriginY - cloneOffsetY;
            touchClone.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        }
        // Reorder check: only mutate DOM if we crossed into a different sibling.
        const under = document.elementFromPoint(pendingX, pendingY);
        const target = under?.closest?.('[data-iid]');
        if (target && target !== dragEl && grid.contains(target)) {
            moveDragged(target, pendingX, pendingY);
        }
    };

    const scheduleFrame = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(applyFrame);
    };

    const createTouchClone = (clientX, clientY) => {
        if (!dragEl) return;
        const rect = dragEl.getBoundingClientRect();
        cloneOriginX = rect.left;
        cloneOriginY = rect.top;
        cloneOffsetX = clientX - rect.left;
        cloneOffsetY = clientY - rect.top;
        const clone = dragEl.cloneNode(true);
        clone.classList.add('mh-inv-drag-clone');
        clone.classList.remove('mh-inv-dragging');
        clone.style.position = 'fixed';
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        clone.style.margin = '0';
        clone.style.pointerEvents = 'none';
        clone.style.zIndex = '9999';
        clone.style.willChange = 'transform';
        clone.style.transform = 'translate3d(0,0,0)';
        clone.removeAttribute('draggable');
        document.body.appendChild(clone);
        touchClone = clone;
    };

    grid.addEventListener('touchstart', (e) => {
        const item = e.target.closest?.('[data-iid]');
        if (!item || e.touches.length !== 1) return;
        dragEl = item;
        dragId = item.dataset.iid;
        touchActive = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    grid.addEventListener('touchmove', (e) => {
        if (!dragEl || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (!touchActive) {
            if (Math.abs(t.clientX - touchStartX) < TOUCH_THRESHOLD &&
                Math.abs(t.clientY - touchStartY) < TOUCH_THRESHOLD) return;
            touchActive = true;
            dragEl.classList.add('mh-inv-dragging');
            createTouchClone(t.clientX, t.clientY);
        }
        e.preventDefault();
        pendingX = t.clientX;
        pendingY = t.clientY;
        scheduleFrame();
    }, { passive: false });
    const finishTouch = () => {
        if (!dragEl) return;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        if (touchClone) { touchClone.remove(); touchClone = null; }
        if (touchActive) commit();
        else { dragEl = null; dragId = null; }
        touchActive = false;
    };
    grid.addEventListener('touchend', finishTouch);
    grid.addEventListener('touchcancel', finishTouch);
}

function showSellConfirm(item, onSell) {
    const owned = item.qty || 0;
    const maxQty = Math.max(1, owned);
    const unitPrice = Math.floor((item.price || 0) * 0.9);
    let qty = 1;

    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card text-center">
            <div class="text-4xl mb-2">${item.emoji}</div>
            <div class="text-base font-bold mb-1" style="color:var(--text-primary)">${escapeHtml(item.name)}</div>
            <div class="text-xs mb-1" style="color:var(--text-muted)">${escapeHtml(t('sellPriceInfo', { price: item.price, unit: unitPrice }))}</div>
            <div class="text-xs mb-4" style="color:var(--text-muted)">${escapeHtml(t('sellQtyInfo', { owned, max: maxQty }))}</div>
            <div class="flex items-center justify-center gap-1 mb-3" style="flex-wrap:wrap">
                <button class="btn-secondary" type="button" data-sell-step="min" title="${escapeHtml(t('qtyMin'))}">&lt;&lt;</button>
                <button class="btn-secondary" type="button" data-sell-step="dec" title="${escapeHtml(t('qtyDec'))}">&lt;</button>
                <div style="min-width:72px;padding:9px 12px;border-radius:14px;background:var(--input-bg);border:1.5px solid var(--border-card);font-size:20px;font-weight:900;color:var(--text-primary)" data-sell-qty>1</div>
                <button class="btn-secondary" type="button" data-sell-step="inc" title="${escapeHtml(t('qtyInc'))}">&gt;</button>
                <button class="btn-secondary" type="button" data-sell-step="double" title="${escapeHtml(t('qtyDouble'))}">&gt;&gt;</button>
                <button class="btn-secondary" type="button" data-sell-step="max" title="${escapeHtml(t('qtyMax'))}">${escapeHtml(t('qtyMax'))}</button>
            </div>
            <div class="font-bold mh-coin-amount mb-4" style="justify-content:center;color:var(--accent-dark)" data-sell-total>${coinIconSvg()} ${unitPrice}</div>
            <div class="flex gap-2 justify-center">
                <button class="btn-secondary" type="button" data-sell-act="cancel">${escapeHtml(t('cancel'))}</button>
                <button class="btn-primary" type="button" data-sell-act="ok">${escapeHtml(t('sell'))}</button>
            </div>
        </div>`;

    const qtyEl = mask.querySelector('[data-sell-qty]');
    const totalEl = mask.querySelector('[data-sell-total]');
    const minBtn = mask.querySelector('[data-sell-step="min"]');
    const decBtn = mask.querySelector('[data-sell-step="dec"]');
    const incBtn = mask.querySelector('[data-sell-step="inc"]');
    const doubleBtn = mask.querySelector('[data-sell-step="double"]');
    const maxBtn = mask.querySelector('[data-sell-step="max"]');
    const update = () => {
        qtyEl.textContent = String(qty);
        totalEl.innerHTML = `${coinIconSvg()} ${unitPrice * qty}`;
        minBtn.disabled = qty <= 1;
        decBtn.disabled = qty <= 1;
        incBtn.disabled = qty >= maxQty;
        doubleBtn.disabled = qty >= maxQty;
        maxBtn.disabled = qty >= maxQty;
    };
    const close = () => mask.remove();

    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-sell-act="cancel"]')) { close(); return; }
        if (e.target.closest?.('[data-sell-step="inc"]')) { qty = Math.min(maxQty, qty + 1); update(); return; }
        if (e.target.closest?.('[data-sell-step="dec"]')) { qty = Math.max(1, qty - 1); update(); return; }
        if (e.target.closest?.('[data-sell-step="min"]')) { qty = 1; update(); return; }
        if (e.target.closest?.('[data-sell-step="double"]')) { qty = Math.min(maxQty, qty * 2); update(); return; }
        if (e.target.closest?.('[data-sell-step="max"]')) { qty = maxQty; update(); return; }
        if (e.target.closest?.('[data-sell-act="ok"]')) {
            close();
            onSell?.(item, qty);
        }
    });

    update();
    document.body.appendChild(mask);
}
