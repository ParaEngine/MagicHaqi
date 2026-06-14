// 星际移民视图
import { confirm, escapeHtml, showToast } from './utils.js';
import { planetName, t } from './i18n.js';
import { getDefaultZoomLevelIndex, loadPlanetIndex, loadPlanetShopItems, normalizePlanetZoomOptions } from './config.js';
import { notify, state } from './state.js';
import { saveFieldScenesDebounced, saveTerrainFieldsDebounced, saveUserProfileDebounced, setActiveLayoutsPlanet } from './storage.js';
import { getTerrainFieldSlots, getTerrainFieldType, normalizeTerrainFieldSlotId, TERRAIN_FIELD_SLOT_DEFS, terrainFieldIconHtml } from './view_terrain_fields.js';

let planetCache = null;
let planetLoadPromise = null;

// 默认主星球（蛋蛋星球）的 id：玩家的自定义家园即基于这颗星球，
// 因此列表里要隐藏它，标题显示为「家园名（默认星球名）」。
const DEFAULT_PLANET_ID = 'default';

function defaultOfficialPlanet() {
    return Array.isArray(planetCache) ? planetCache.find(p => p.id === DEFAULT_PLANET_ID) || null : null;
}

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
        encyclopediaUrl: String(raw.encyclopediaUrl || indexEntry.encyclopediaUrl || raw.encyclopediaFile || indexEntry.encyclopediaFile || raw.encyclopedia_url || indexEntry.encyclopedia_url || '').trim(),
        planet: raw.planet && typeof raw.planet === 'object' ? raw.planet : {},
        audience: raw.audience && typeof raw.audience === 'object' ? raw.audience : (indexEntry.audience && typeof indexEntry.audience === 'object' ? indexEntry.audience : {}),
        zoomOptions: normalizePlanetZoomOptions(planetOptions),
        fields,
    };
}

// 星球「自我照料能力」selfCare ∈ [0,1]：越大宠物越能照顾自己，养成数值衰减越慢。
//   0 = 几乎每天都要照料（默认）；0.7 ≈ 一周照料一次；1 = 完全自给自足（零压力，
//   数值锁定 ~80%、不生病、不创伤）。规范化到 [0,1]，缺省 0。
function planetSelfCareValue(planet) {
    const raw = Number(planet?.audience?.selfCare);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(1, raw));
}

function officialPlanetTitle(planet) {
    return planetName(planet?.title || planet?.name) || t('stOfficialPlanetFallback');
}

function officialPlanetName(planet) {
    return planetName(planet?.name || planet?.title) || officialPlanetTitle(planet);
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

// 是否处于 ?home_planet= 临时家园（仅 URL 覆盖，未真正迁移）。
function isTemporaryHomeActive() {
    const current = settlementSettings();
    return current.source === 'official' && !!String(current.temporaryHomePlanet || '').trim();
}

// 顶部「我的家园」卡片是否就是玩家当前所在星球：
// 自定义家园，或处于 ?home_planet= 临时家园时都算「当前」。
function isHomeCurrent() {
    return currentSelectionId() === 'custom' || isTemporaryHomeActive();
}

function currentHomeName() {
    const current = settlementSettings();
    const savedHomeName = String(current.homeSnapshot?.planetName || current.homePlanetName || '').trim();
    if (savedHomeName) return savedHomeName;
    if (current.source === 'official') return t('ssMyPlanet');
    return String(state.planetName || t('ssMyPlanet')).trim();
}

function currentUsername() {
    return String(state.user?.username || state.sdk?.user?.username || '').trim();
}

// 当前家园所基于的官方星球：
// - 已迁移 / ?home_planet= 临时家园（source==='official'）→ 该官方星球本身；
// - 自定义家园（source==='custom'）→ 默认主星球（蛋蛋星球）。
function currentBasePlanet() {
    const settings = settlementSettings();
    if (settings.source === 'official') {
        const byId = Array.isArray(planetCache) ? planetCache.find(p => p.id === settings.planetId) : null;
        if (byId) return byId;
        const tempHome = String(settings.temporaryHomePlanet || '').trim();
        if (tempHome && Array.isArray(planetCache)) {
            const keys = homePlanetLookupKeys(tempHome);
            const byTemp = planetCache.find(p => Array.from(keys).some(key => planetIndexEntryKeys(p).has(key)));
            if (byTemp) return byTemp;
        }
    }
    return defaultOfficialPlanet();
}

function playerPlanetTitle() {
    const name = currentHomeName();
    const user = currentUsername();
    // 标题显示为「家园名（所基于的星球名）」，家园名优先用玩家星球名，缺省时回退到用户名。
    const base = currentBasePlanet();
    const baseName = base ? officialPlanetName(base) : '';
    const homeName = (name && name !== t('ssMyPlanet')) ? name : user;
    if (homeName && baseName) return t('ssMyPlanetWithUser', { name: homeName, user: baseName });
    if (homeName) return homeName;
    return user ? t('ssMyPlanetNamed', { name: user }) : t('ssMyPlanet');
}

function playerPlanetDesc() {
    const settings = settlementSettings();
    const saved = String(settings.homeSnapshot?.summary || settings.homeSummary || '').trim();
    if (saved) return saved;
    // 描述沿用所基于星球（含 ?home_planet= 临时家园）的简介，缺省时回退到默认家园描述。
    const base = currentBasePlanet();
    return String(base?.summary || '').trim() || t('ssMyHomeDesc');
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
    state.planetName = officialPlanetName(planet);
    // 注意：setActiveLayoutsPlanet 会替换 state.settings.starSettlement 引用，
    // 所以必须在它之后再获取 settings，否则后续写入（包括 zoomOptions）会落到孤立对象上。
    setActiveLayoutsPlanet(planet.id);
    const settings = settlementSettings();
    settings.source = 'official';
    settings.planetId = planet.id;
    settings.title = officialPlanetTitle(planet);
    settings.appTitle = planet.appTitle || '';
    settings.temporaryHomePlanet = persist ? null : sourcePath || planet.id;
    settings.readonlyPlanet = planet.planet?.readonly !== false;
    settings.selfCare = planetSelfCareValue(planet);
    settings.encyclopediaUrl = String(planet.encyclopediaUrl || '').trim();
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
        rawValue = String(new URL(window.location.href).searchParams.get('home_planet') || '').trim();
    } catch (_) {}
    if (!rawValue) rawValue = String(window.__homePlanet || '').trim();
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
        state.planetName = officialPlanetName(planet);
        settings.title = officialPlanetTitle(planet);
        settings.appTitle = planet.appTitle || '';
        settings.readonlyPlanet = planet.planet?.readonly !== false;
        settings.selfCare = planetSelfCareValue(planet);
        settings.encyclopediaUrl = String(planet.encyclopediaUrl || '').trim();
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
    settings.selfCare = 0;
    settings.encyclopediaUrl = '';
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
        if (!typeId) return '';
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
    const selected = isHomeCurrent();
    const slots = customPreviewSlots().filter(slot => slot.typeId);
    // 当前家园：去掉「回迁」按钮，改用醒目的当前样式与「当前」标记；
    // 仅当玩家此刻已真正迁移到官方星球时，才保留「回迁」按钮。
    return `
        <article class="star-settlement-card ${selected ? 'is-current is-no-action' : ''}" data-planet-id="custom">
            <div class="star-settlement-planet" style="${planetPreviewStyle(null)}"><span>家</span></div>
            <div class="star-settlement-card-body">
                <div class="star-settlement-card-title"><b>${escapeHtml(playerPlanetTitle())}</b><em class="${selected ? 'is-current-tag' : ''}">${escapeHtml(selected ? t('ssCurrent') : t('ssBadgePlayer'))}</em></div>
                <p>${escapeHtml(playerPlanetDesc())}</p>
                ${slots.length ? `<div class="star-settlement-fields">${slots.map(slot => `<span class="star-settlement-chip">${terrainFieldIconHtml(slot.typeId)}${escapeHtml(slot.name)}</span>`).join('')}</div>` : ''}
            </div>
            ${selected ? '' : `<button type="button" class="btn-secondary star-settlement-action" data-settle-custom>${escapeHtml(t('ssReturnHome'))}</button>`}
        </article>`;
}

function renderOfficialCard(planet) {
    // 仅已真正迁移（非 ?home_planet= 临时家园）时，官方卡片才算「当前」。
    const selected = currentSelectionId() === planet.id && !isTemporaryHomeActive();
    const title = officialPlanetTitle(planet);
    // 已迁移到该官方星球时：醒目的当前样式 + 「当前」标记，去掉迁移按钮。
    return `
        <article class="star-settlement-card ${selected ? 'is-current is-no-action' : ''}" data-planet-id="${escapeHtml(planet.id)}">
            <div class="star-settlement-planet" style="${escapeHtml(planetPreviewStyle(planet))}"><span>${escapeHtml((title || '?').slice(0, 1))}</span></div>
            <div class="star-settlement-card-body">
                <div class="star-settlement-card-title"><b>${escapeHtml(title)}</b><em class="${selected ? 'is-current-tag' : ''}">${escapeHtml(selected ? t('ssCurrent') : (planet.badge || t('ssBadgeOfficial')))}</em></div>
                <p>${escapeHtml(planet.summary || '换到这个星球后，你的家具、房屋和宠物都会保留。')}</p>
                ${(() => { const chips = renderFieldsPreview(planet); return chips ? `<div class="star-settlement-fields">${chips}</div>` : ''; })()}
            </div>
            ${selected ? '' : `<button type="button" class="btn-primary star-settlement-action" data-settle-official="${escapeHtml(planet.id)}">${escapeHtml(t('ssMigrate'))}</button>`}
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
        .star-settlement-card.is-no-action { grid-template-columns:72px minmax(0,1fr); }
        .star-settlement-card.is-current { border:2px solid #0ea5e9; background:linear-gradient(135deg,#ecfeff 0%,#e0f2fe 100%); box-shadow:0 10px 26px rgba(14,165,233,.28), 0 0 0 4px rgba(14,165,233,.12); }
        .star-settlement-card.is-current .star-settlement-planet { box-shadow:inset -10px -16px 32px rgba(10,70,108,.32),0 0 0 3px rgba(255,255,255,.9),0 0 20px rgba(14,165,233,.55); }
        .star-settlement-card.is-current .star-settlement-card-title b { color:#0c4a6e; }
        .star-settlement-card-title em.is-current-tag { background:#0ea5e9; color:#fff; }
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
            const ok = await confirm(t('ssMigrateConfirm', { name: officialPlanetTitle(planet) }), { okText: t('ssMigrate'), cancelText: t('cancel') });
            if (!ok) return;
            await applyOfficialPlanet(planet);
            showToast(t('ssMigrated', { name: officialPlanetTitle(planet) }), 'success', 1800);
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
        // 当前已迁移到某个官方星球（含 ?home_planet= 临时家园）时，隐藏该星球自身的卡片，
        // 避免列表里出现「当前」重复项。
        const activeId = currentSelectionId();
        // 玩家的自定义家园（source==='custom'）即基于默认主星球，因此也要隐藏默认星球。
        const hideDefault = activeId === 'custom';
        const tempHome = String(settlementSettings().temporaryHomePlanet || '').trim();
        const tempHomeKeys = tempHome ? homePlanetLookupKeys(tempHome) : null;
        const visiblePlanets = planets.filter(planet => {
            if (planet.id === activeId) return false;
            if (hideDefault && planet.id === DEFAULT_PLANET_ID) return false;
            if (tempHomeKeys) {
                const entryKeys = planetIndexEntryKeys(planet);
                if (Array.from(tempHomeKeys).some(key => entryKeys.has(key))) return false;
            }
            return true;
        });
        list.innerHTML = `${renderCustomCard()}${visiblePlanets.map(renderOfficialCard).join('')}`;
        bindSettlements(panel, planets, onBack);
    }).catch((e) => {
        console.warn('渲染星际移民失败', e);
        const list = panel.querySelector('.star-settlement-list');
        if (list) list.innerHTML = renderCustomCard();
        bindSettlements(panel, [], onBack);
    });
}
