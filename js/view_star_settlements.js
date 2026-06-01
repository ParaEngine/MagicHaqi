// 星际移民视图
import { confirm, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { getDefaultZoomLevelIndex, loadPlanetIndex, loadPlanetShopItems, normalizePlanetZoomOptions } from './config.js';
import { notify, state } from './state.js';
import { saveFieldScenesDebounced, saveTerrainFieldsDebounced, saveUserProfileDebounced, setActiveLayoutsPlanet } from './storage.js';
import { getTerrainFieldSlots, getTerrainFieldType, normalizeTerrainFieldSlotId, TERRAIN_FIELD_SLOT_DEFS, terrainFieldIconHtml } from './view_terrain_fields.js';

let planetCache = null;
let planetLoadPromise = null;

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function settlementSettings() {
    const settings = state.settings || (state.settings = {});
    return settings.starSettlement || (settings.starSettlement = {});
}

function terrainSettings() {
    const settings = state.settings || (state.settings = {});
    return settings.terrainFields || (settings.terrainFields = {});
}

function fieldSceneSettings() {
    const settings = state.settings || (state.settings = {});
    return settings.fieldScenes || (settings.fieldScenes = {});
}

function compactZoomOptions(raw) {
    const options = normalizePlanetZoomOptions(raw);
    const compact = {};
    if (options.default_zoom_level !== 'planet') compact.default_zoom_level = options.default_zoom_level;
    if (options.hide_planet) compact.hide_planet = true;
    if (options.hide_cell) compact.hide_cell = true;
    return compact;
}

function applySettlementZoomOptions(settings, planet) {
    const compact = compactZoomOptions(planet?.zoomOptions || planet?.planet || planet || {});
    if (Object.keys(compact).length) settings.zoomOptions = compact;
    else delete settings.zoomOptions;
}

function applyDefaultZoomLevel(planet) {
    const level = getDefaultZoomLevelIndex(planet?.zoomOptions || planet?.planet || planet || {});
    state.zoomLevel = level;
    state.lastHomeZoomLevel = level;
}

function normalizeOfficialPlanet(raw, indexEntry = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || indexEntry.id || '').trim();
    if (!id) return null;
    const title = String(raw.title || raw.name || indexEntry.title || id).trim();
    const fields = Array.isArray(raw.fields) ? raw.fields : [];
    const planetOptions = raw.planet && typeof raw.planet === 'object'
        ? { ...raw, ...raw.planet }
        : raw;
    return {
        id,
        title,
        name: String(raw.name || title).trim(),
        appTitle: String(raw.appTitle || indexEntry.appTitle || '').trim(),
        badge: String(raw.badge || indexEntry.badge || t('ssBadgeOfficial')).trim(),
        summary: String(raw.summary || indexEntry.summary || '').trim(),
        shopItemUrl: String(raw.shopItemUrl || indexEntry.shopItemUrl || raw.shopItemsFile || indexEntry.shopItemsFile || raw.shopitemsFile || indexEntry.shopitemsFile || raw.shopFile || indexEntry.shopFile || raw.shop_items_file || indexEntry.shop_items_file || '').trim(),
        planet: raw.planet && typeof raw.planet === 'object' ? raw.planet : {},
        zoomOptions: normalizePlanetZoomOptions(planetOptions),
        fields,
    };
}

async function loadOfficialPlanets() {
    if (planetCache) return planetCache;
    if (planetLoadPromise) return planetLoadPromise;
    planetLoadPromise = (async () => {
        try {
            const index = await loadPlanetIndex();
            const entries = Array.isArray(index?.planets) ? index.planets : [];
            planetCache = entries.map(entry => normalizeOfficialPlanet(entry, entry)).filter(Boolean);
        } catch (e) {
            console.warn('加载官方星球索引失败', e);
            planetCache = [];
        }
        return planetCache;
    })();
    return planetLoadPromise;
}

function currentSelectionId() {
    const current = settlementSettings();
    return current.source === 'official' ? current.planetId : 'custom';
}

function currentHomeName() {
    const current = settlementSettings();
    const savedHomeName = String(current.homeSnapshot?.planetName || current.homePlanetName || '').trim();
    if (savedHomeName) return savedHomeName;
    if (current.source === 'official') return t('ssMyPlanet');
    return String(state.planetName || t('ssMyPlanet')).trim();
}

function playerPlanetTitle() {
    const name = currentHomeName();
    return name && name !== t('ssMyPlanet') ? t('ssMyPlanetNamed', { name }) : t('ssMyPlanet');
}

function captureHomeSnapshot() {
    const settings = settlementSettings();
    if (settings.homeSnapshot) return;
    settings.homeSnapshot = {
        planetName: String(state.planetName || t('ssMyPlanet')).trim(),
        terrainSlots: clone(getTerrainFieldSlots({ includeEmpty: true }).map(slot => ({ index: slot.index, typeId: slot.typeId, name: slot.name }))),
        fieldScenes: clone(state.settings?.fieldScenes || {}),
    };
    settings.homePlanetName = settings.homeSnapshot.planetName;
}

function slotKeyForDef(def, index) {
    return String(def?.index || index + 1);
}

function slotKeyFromField(field) {
    const raw = field?.index ?? field?.slotIndex ?? field?.slotId ?? field?.id;
    return raw == null || raw === '' ? '' : normalizeTerrainFieldSlotId(raw);
}

function normalizeFieldSlot(field, def, fallbackSlot) {
    const typeId = String(field?.typeId || fallbackSlot?.typeId || '').trim();
    const type = getTerrainFieldType(typeId);
    const name = String(field?.name || fallbackSlot?.name || type?.name || def.label).trim().slice(0, 12);
    return {
        index: def.index,
        typeId: type ? type.id : '',
        name,
    };
}

function fieldAtSlot(fields, def, index) {
    if (!Array.isArray(fields)) return null;
    const indexed = fields[index];
    const targetSlotKey = slotKeyForDef(def, index);
    const indexedSlotKey = slotKeyFromField(indexed);
    if (indexed && (!indexedSlotKey || indexedSlotKey === targetSlotKey)) return indexed;
    return fields.find(field => slotKeyFromField(field) === targetSlotKey) || indexed || null;
}

function applyPlanetFields(planet) {
    const fields = Array.isArray(planet.fields) ? planet.fields : [];
    const currentSlots = getTerrainFieldSlots({ includeEmpty: true });
    terrainSettings().slots = TERRAIN_FIELD_SLOT_DEFS.map((def, index) => normalizeFieldSlot(fieldAtSlot(fields, def, index), def, currentSlots[index]));

    const scenes = fieldSceneSettings();
    TERRAIN_FIELD_SLOT_DEFS.forEach((def, index) => {
        const field = fieldAtSlot(fields, def, index);
        if (!field) return;
        const slotKey = slotKeyForDef(def, index);
        const next = { ...(scenes[slotKey] || {}) };
        if (field.background && typeof field.background === 'object') next.background = { ...field.background };
        if (Array.isArray(field.particles)) next.particles = field.particles.slice(0, 6);
        if (typeof field.bgMusic === 'string') next.bgMusic = field.bgMusic;
        scenes[slotKey] = next;
    });
}

async function applyOfficialPlanet(planet, { persist = true, sourcePath = '' } = {}) {
    if (!persist && !state.temporaryHomePlanetOverride) {
        state.temporaryHomePlanetOverride = {
            planetName: state.planetName || '',
            hasTerrainFields: !!state.settings?.terrainFields,
            terrainFields: clone(state.settings?.terrainFields || null),
            hasFieldScenes: !!state.settings?.fieldScenes,
            fieldScenes: clone(state.settings?.fieldScenes || null),
            hasStarSettlement: !!state.settings?.starSettlement,
            starSettlement: clone(state.settings?.starSettlement || null),
        };
    }
    if (persist) state.temporaryHomePlanetOverride = null;
    if (persist) captureHomeSnapshot();
    applyPlanetFields(planet);
    state.planetName = planet.name || planet.title;
    // 注意：setActiveLayoutsPlanet 会替换 state.settings.starSettlement 引用，
    // 所以必须在它之后再获取 settings，否则后续写入（包括 zoomOptions）会落到孤立对象上。
    setActiveLayoutsPlanet(planet.id);
    const settings = settlementSettings();
    settings.source = 'official';
    settings.planetId = planet.id;
    settings.title = planet.title;
    settings.appTitle = planet.appTitle || '';
    settings.temporaryHomePlanet = persist ? null : sourcePath || planet.id;
    settings.readonlyPlanet = planet.planet?.readonly !== false;
    settings.planetStyle = {
        hue: Number(planet.planet?.hue) || 188,
        bodyBackground: String(planet.planet?.bodyBackground || '').trim(),
        glowColor: String(planet.planet?.glowColor || '').trim(),
        accentColor: String(planet.planet?.accentColor || '').trim(),
    };
    applySettlementZoomOptions(settings, planet);
    applyDefaultZoomLevel(planet);
    await loadPlanetShopItems(planet);
    settings.migratedAt = Date.now();
    if (persist) saveUserProfileDebounced();
    notify();
}

function homePlanetLookupKeys(rawValue) {
    const values = [rawValue]
        .map(value => String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter(Boolean);
    const keys = new Set();
    values.forEach(value => {
        const withoutJson = value.replace(/\.json$/i, '');
        const withoutBase = withoutJson.replace(/^famous-planets\//i, '');
        const basename = withoutBase.split('/').pop() || withoutBase;
        keys.add(withoutJson);
        keys.add(withoutBase);
        keys.add(basename);
        keys.add(basename.replace(/^planet_/i, ''));
    });
    return keys;
}

function planetIndexEntryKeys(entry) {
    const values = [entry?.id].map(value => String(value || '').trim()).filter(Boolean);
    const keys = new Set();
    values.forEach(value => {
        keys.add(value);
    });
    return keys;
}

async function readHomePlanetFromIndex(rawValue) {
    try {
        const index = await loadPlanetIndex();
        const entries = Array.isArray(index?.planets) ? index.planets : [];
        const lookupKeys = homePlanetLookupKeys(rawValue);
        const entry = entries.find(item => {
            const entryKeys = planetIndexEntryKeys(item);
            return Array.from(lookupKeys).some(key => entryKeys.has(key));
        });
        return entry ? normalizeOfficialPlanet(entry, entry) : null;
    } catch (e) {
        console.warn('读取临时家园星球索引失败', e);
        return null;
    }
}

export async function applyTemporaryHomePlanetFromUrl() {
    let rawValue = '';
    try {
        const url = new URL(window.location.href);
        rawValue = String(url.searchParams.get('home_planet') || '').trim();
    } catch (_) {}
    if (!rawValue) return false;
    try {
        const planet = await readHomePlanetFromIndex(rawValue);
        if (!planet) throw new Error(`invalid home_planet index entry: ${rawValue}`);
        await applyOfficialPlanet(planet, { persist: false, sourcePath: rawValue });
        return true;
    } catch (e) {
        console.warn('临时家园星球加载失败', e);
        showToast(t('ssTempLoadFailed'), 'error', 1800);
        return false;
    }
}

export async function applySettledOfficialPlanetFromProfile() {
    const settings = settlementSettings();
    if (settings.source !== 'official' || !settings.planetId) return false;
    try {
        const planets = await loadOfficialPlanets();
        const planet = planets.find(item => item.id === settings.planetId);
        if (!planet) return false;
        applyPlanetFields(planet);
        state.planetName = planet.name || planet.title;
        settings.title = planet.title;
        settings.appTitle = planet.appTitle || '';
        settings.readonlyPlanet = planet.planet?.readonly !== false;
        settings.planetStyle = {
            hue: Number(planet.planet?.hue) || 188,
            bodyBackground: String(planet.planet?.bodyBackground || '').trim(),
            glowColor: String(planet.planet?.glowColor || '').trim(),
            accentColor: String(planet.planet?.accentColor || '').trim(),
        };
        applySettlementZoomOptions(settings, planet);
        applyDefaultZoomLevel(planet);
        await loadPlanetShopItems(planet);
        notify();
        return true;
    } catch (e) {
        console.warn('恢复已迁移星球失败', e);
        return false;
    }
}

async function restoreCustomPlanet() {
    state.temporaryHomePlanetOverride = null;
    const snapshot = settlementSettings().homeSnapshot || null;
    if (snapshot?.planetName) state.planetName = snapshot.planetName;
    if (snapshot?.terrainSlots) terrainSettings().slots = clone(snapshot.terrainSlots);
    if (snapshot?.fieldScenes) state.settings.fieldScenes = clone(snapshot.fieldScenes);
    // setActiveLayoutsPlanet 会替换 state.settings.starSettlement 引用，必须之后再获取 settings。
    setActiveLayoutsPlanet('');
    if (snapshot?.terrainSlots) saveTerrainFieldsDebounced({ slots: snapshot.terrainSlots });
    if (snapshot?.fieldScenes) saveFieldScenesDebounced(snapshot.fieldScenes);
    const settings = settlementSettings();
    settings.source = 'custom';
    settings.planetId = 'custom';
    settings.title = currentHomeName();
    settings.appTitle = '';
    settings.readonlyPlanet = false;
    settings.planetStyle = null;
    delete settings.zoomOptions;
    await loadPlanetShopItems(null);
    settings.migratedAt = Date.now();
    saveUserProfileDebounced();
    notify();
}

function planetPreviewStyle(planet) {
    const bg = planet?.planet?.bodyBackground || 'radial-gradient(circle at 34% 24%, rgba(255,255,255,.74) 0%, rgba(255,255,255,.18) 19%, transparent 34%), radial-gradient(circle at 50% 42%, #8ff5dc 0%, #43d6cd 44%, #1488a9 100%)';
    const glow = planet?.planet?.glowColor || 'rgba(92, 236, 228, 0.5)';
    return `background:${bg};box-shadow:inset -10px -16px 32px rgba(10,70,108,.32),0 0 22px ${glow}`;
}

function renderFieldsPreview(planet) {
    const fields = Array.isArray(planet.fields) ? planet.fields : [];
    return TERRAIN_FIELD_SLOT_DEFS.map((def, index) => {
        const field = fieldAtSlot(fields, def, index) || {};
        const typeId = field.typeId || '';
        return `<span class="star-settlement-chip" title="${escapeHtml(def.label)}">${terrainFieldIconHtml(typeId)}${escapeHtml(field.name || def.label)}</span>`;
    }).join('');
}

function customPreviewSlots() {
    const settings = settlementSettings();
    const snapshotSlots = settings.homeSnapshot?.terrainSlots;
    const slots = Array.isArray(snapshotSlots) && snapshotSlots.length
        ? snapshotSlots
        : (settings.source === 'official' ? [] : getTerrainFieldSlots({ includeEmpty: true }));
    return TERRAIN_FIELD_SLOT_DEFS.map((def, index) => {
        const slotKey = slotKeyForDef(def, index);
        const slot = slots.find(item => slotKeyFromField(item) === slotKey) || slots[index] || {};
        return {
            index: def.index,
            typeId: slot.typeId || slot.fieldId || '',
            name: String(slot.name || def.label).trim(),
        };
    });
}

function renderCustomCard() {
    const selected = currentSelectionId() === 'custom';
    const slots = customPreviewSlots();
    return `
        <article class="star-settlement-card ${selected ? 'is-selected' : ''}" data-planet-id="custom">
            <div class="star-settlement-planet" style="${planetPreviewStyle(null)}"><span>家</span></div>
            <div class="star-settlement-card-body">
                <div class="star-settlement-card-title"><b>${escapeHtml(playerPlanetTitle())}</b><em>${escapeHtml(t('ssBadgePlayer'))}</em></div>
                <div class="star-settlement-fields">${slots.map(slot => `<span class="star-settlement-chip">${terrainFieldIconHtml(slot.typeId)}${escapeHtml(slot.name)}</span>`).join('')}</div>
            </div>
            <button type="button" class="btn-secondary star-settlement-action" data-settle-custom>${selected ? escapeHtml(t('ssCurrent')) : escapeHtml(t('ssReturnHome'))}</button>
        </article>`;
}

function renderOfficialCard(planet) {
    const selected = currentSelectionId() === planet.id;
    return `
        <article class="star-settlement-card ${selected ? 'is-selected' : ''}" data-planet-id="${escapeHtml(planet.id)}">
            <div class="star-settlement-planet" style="${escapeHtml(planetPreviewStyle(planet))}"><span>${escapeHtml((planet.title || '?').slice(0, 1))}</span></div>
            <div class="star-settlement-card-body">
                <div class="star-settlement-card-title"><b>${escapeHtml(planet.title)}</b><em>${escapeHtml(planet.badge || t('ssBadgeOfficial'))}</em></div>
                <p>${escapeHtml(planet.summary || '换到这个星球后，你的家具、房屋和宠物都会保留。')}</p>
                <div class="star-settlement-fields">${renderFieldsPreview(planet)}</div>
            </div>
            <button type="button" class="btn-primary star-settlement-action" data-settle-official="${escapeHtml(planet.id)}">${selected ? escapeHtml(t('ssCurrent')) : escapeHtml(t('ssMigrate'))}</button>
        </article>`;
}

function starSettlementStyles() {
    return `
        <style id="mhStarSettlementsStyles">
        .star-settlements-view { top:52px; left:0; right:0; bottom:0; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
        .star-settlement-note { color:var(--text-muted); font-size:12px; line-height:1.45; padding:10px 12px; border-radius:14px; border:1px solid rgba(148,163,184,.22); background:rgba(255,255,255,.72); }
        .star-settlement-list { display:flex; flex-direction:column; gap:10px; }
        .star-settlement-card { display:grid; grid-template-columns:72px minmax(0,1fr) auto; gap:10px; align-items:center; padding:10px; border-radius:16px; border:1.5px solid rgba(14,116,144,.2); background:rgba(255,255,255,.86); box-shadow:0 8px 18px rgba(15,23,42,.08); }
        .star-settlement-card.is-selected { border-color:#0ea5e9; background:#ecfeff; }
        .star-settlement-planet { width:64px; height:64px; border-radius:50%; display:grid; place-items:center; color:white; font-weight:900; text-shadow:0 1px 5px rgba(15,23,42,.45); overflow:hidden; }
        .star-settlement-card-body { min-width:0; display:flex; flex-direction:column; gap:6px; }
        .star-settlement-card-title { display:flex; align-items:center; gap:8px; min-width:0; }
        .star-settlement-card-title b { color:var(--text-primary); font-size:15px; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .star-settlement-card-title em { flex:0 0 auto; padding:3px 7px; border-radius:999px; background:rgba(14,165,233,.12); color:#0369a1; font-style:normal; font-size:11px; font-weight:900; }
        .star-settlement-card p { margin:0; color:var(--text-muted); font-size:12px; line-height:1.38; }
        .star-settlement-fields { display:flex; flex-wrap:wrap; gap:5px; }
        .star-settlement-chip { display:inline-flex; align-items:center; gap:3px; max-width:96px; min-height:22px; padding:3px 6px; border-radius:999px; background:rgba(15,23,42,.06); color:#334155; font-size:11px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .star-settlement-chip .terrain-field-icon { flex:0 0 auto; font-size:13px; }
        .star-settlement-action { min-width:58px; white-space:nowrap; }
        .star-settlement-empty { padding:24px 12px; text-align:center; color:var(--text-muted); font-size:13px; }
        @media (max-width: 560px) {
            .star-settlement-card { grid-template-columns:58px minmax(0,1fr); }
            .star-settlement-planet { width:52px; height:52px; }
            .star-settlement-action { grid-column:1 / -1; width:100%; }
        }
        </style>`;
}

function bindSettlements(panel, planets, onBack) {
    const back = panel.querySelector('#mhBack');
    if (back) back.onclick = () => onBack?.();

    panel.querySelectorAll('[data-settle-official]').forEach(btn => {
        btn.onclick = async () => {
            const planet = planets.find(item => item.id === btn.dataset.settleOfficial);
            if (!planet || currentSelectionId() === planet.id) return;
            const ok = await confirm(t('ssMigrateConfirm', { name: planet.title }), { okText: t('ssMigrate'), cancelText: t('cancel') });
            if (!ok) return;
            await applyOfficialPlanet(planet);
            showToast(t('ssMigrated', { name: planet.title }), 'success', 1800);
            renderStarSettlements(panel, null, { onBack });
        };
    });

    const customBtn = panel.querySelector('[data-settle-custom]');
    if (customBtn) customBtn.onclick = async () => {
        if (currentSelectionId() === 'custom') return;
        const ok = await confirm(t('ssReturnConfirm'), { okText: t('ssReturnHome'), cancelText: t('cancel') });
        if (!ok) return;
        await restoreCustomPlanet();
        showToast(t('ssReturned'), 'success', 1800);
        renderStarSettlements(panel, null, { onBack });
    };
}

export function renderStarSettlements(panel, _data, { onBack } = {}) {
    panel.innerHTML = `
        ${starSettlementStyles()}
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('ssTitle'))}</span>
            <span style="width:36px"></span>
        </div>
        <div class="absolute star-settlements-view">
            <div class="star-settlement-note">${escapeHtml(t('ssNote'))}</div>
            <div class="star-settlement-list"><div class="star-settlement-empty">${escapeHtml(t('ssLoading'))}</div></div>
        </div>`;
    const back = panel.querySelector('#mhBack');
    if (back) back.onclick = () => onBack?.();

    loadOfficialPlanets().then(planets => {
        const list = panel.querySelector('.star-settlement-list');
        if (!list) return;
        list.innerHTML = `${renderCustomCard()}${planets.map(renderOfficialCard).join('')}`;
        bindSettlements(panel, planets, onBack);
    }).catch((e) => {
        console.warn('渲染星际移民失败', e);
        const list = panel.querySelector('.star-settlement-list');
        if (list) list.innerHTML = renderCustomCard();
        bindSettlements(panel, [], onBack);
    });
}
