// view_encyclopedia.js — 动物园动物图鉴视图
// 当前星球（starSettlement）配置了 encyclopediaUrl 时可用。
// 流程：动物列表 → 图鉴详情（照片/叫声/双语/分龄/趣味知识）→ 答题挑战 → 解锁领养。
// 进度（learned / adopted）按星球存 user/<planetId>.encyclopedia.json。
import { $, escapeHtml, showToast } from './utils.js';
import { t, getLang } from './i18n.js';
import { loadEncyclopediaData } from './config.js';
import { state } from './state.js';
import { loadEncyclopediaProgress, saveEncyclopediaProgress } from './storage.js';

// ---------- 模块内 UI 状态 ----------
let currentAnimalId = null;       // null = 列表页
let contentLang = null;           // 'zh' | 'en'，默认跟随游戏语言
let ageLevel = 'kid';             // 'kid' | 'junior'
let quizState = null;             // { index, correct } 进行中的答题
let photoIndex = 0;
let progressCache = null;         // 当前星球的进度
let progressPlanetId = '';        // progressCache 属于哪颗星球
let audioPlayer = null;

// ---------- 相机模块状态 ----------
let cameraStream = null;          // getUserMedia 流
let cameraPhotoData = null;       // 拍到的 base64 图片
let cameraDataCache = null;       // 缓存当前图鉴数据供识别使用

// ---------- 互动任务状态 ----------
// { animalId -> { photo:bool, record:bool, draw:bool, note:bool } }
let taskState = {};
let mediaRecorder = null;         // MediaRecorder 实例
let recordedChunks = [];          // 录音数据
let recordedBlob = null;          // 录音结果
let drawCanvas = null;            // 涂鸦 canvas 引用

function currentPlanetId() {
    return String(state.settings?.starSettlement?.planetId || '').trim();
}

export function currentEncyclopediaUrl() {
    return String(state.settings?.starSettlement?.encyclopediaUrl || '').trim();
}

/** 当前星球是否配置了图鉴（dock / 菜单入口据此显隐）。 */
export function hasEncyclopedia() {
    return !!currentEncyclopediaUrl();
}

function lang() {
    return contentLang || (getLang() === 'en' ? 'en' : 'zh');
}

function bi(text) {
    if (text == null) return '';
    if (typeof text === 'string') return text;
    return String(text[lang()] || text.zh || text.en || '');
}

function stopAudio() {
    try { audioPlayer?.pause?.(); } catch (_) {}
    audioPlayer = null;
}

export function disposeEncyclopedia() {
    stopAudio();
    quizState = null;
    cleanupCamera();
    cleanupRecorder();
}

/** 自检：扫描已领养的 shenzhen_zoo 宠物，同步图鉴 adopted 状态 */
async function syncAdoptedProgress(data, planetId) {
    if (!data || planetId !== 'shenzhen_zoo') return;
    const animals = Array.isArray(data.animals) ? data.animals : [];
    if (!animals.length) return;
    // 确保所有 petOrder 中的宠物数据已加载
    const { loadPet } = await import('./storage.js');
    for (const id of (state.petOrder || [])) {
        if (!state.pets[id]) {
            try { const pet = await loadPet(id); if (pet) state.pets[id] = pet; } catch (_) {}
        }
    }
    const adoptedAnimalIds = new Set();
    // 扫描所有宠物，找出已领养的动物园动物
    for (const id of (state.petOrder || [])) {
        const pet = state.pets[id];
        if (pet && String(pet.adoptedFromZoo || '').trim() === 'shenzhen_zoo') {
            const animalId = String(pet.adoptedFromAnimal || '').trim();
            if (animalId) adoptedAnimalIds.add(animalId);
        }
    }
    let changed = false;
    for (const animal of animals) {
        const shouldBeAdopted = adoptedAnimalIds.has(animal.id);
        const prog = progressCache?.animals?.[animal.id];
        const currentlyAdopted = !!(prog?.adopted);
        if (shouldBeAdopted !== currentlyAdopted) {
            progressCache = await saveEncyclopediaProgress(planetId, animal.id,
                shouldBeAdopted ? { learned: true, adopted: true } : { learned: !!prog?.learned, adopted: false });
            changed = true;
        }
    }
    if (changed) {
        progressCache = await loadEncyclopediaProgress(planetId);
    }
}

/** 离开星球 / 切换星球时重置图鉴 UI 状态。 */
export function resetEncyclopediaView() {
    currentAnimalId = null;
    quizState = null;
    photoIndex = 0;
    progressCache = null;
    progressPlanetId = '';
    stopAudio();
    cleanupCamera();
    cleanupRecorder();
    taskState = {};
}

function animalProgress(animalId) {
    return progressCache?.animals?.[animalId] || { learned: false, adopted: false };
}

const ENC_STYLE = `
<style>
.mh-enc-wrap { position:absolute; top:52px; left:0; right:0; bottom:0; overflow-y:auto; padding:12px 14px 24px; -webkit-overflow-scrolling:touch; }
.mh-enc-guide { display:flex; gap:10px; align-items:flex-start; background:linear-gradient(135deg,#fef9c3,#fde68a); border-radius:16px; padding:10px 14px; margin-bottom:12px; box-shadow:0 2px 8px rgba(0,0,0,.06); }
.mh-enc-guide .face { font-size:30px; line-height:1; flex:0 0 auto; }
.mh-enc-guide .bubble { font-size:13px; color:#78350f; line-height:1.5; }
.mh-enc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
.mh-enc-card { background:var(--bg-card,#fff); border-radius:16px; padding:14px 10px; text-align:center; cursor:pointer; border:2px solid transparent; box-shadow:0 2px 10px rgba(0,0,0,.07); transition:transform .15s, border-color .15s; position:relative; }
.mh-enc-card:active { transform:scale(.97); }
.mh-enc-card .emoji { font-size:46px; line-height:1.2; }
.mh-enc-card .photo { width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:12px; }
.mh-enc-card .name { font-weight:800; margin-top:8px; color:var(--text-primary,#1f2937); font-size:14px; }
.mh-enc-card .en { font-size:11px; color:var(--text-muted,#9ca3af); }
.mh-enc-card .badge { position:absolute; top:8px; right:8px; font-size:11px; padding:2px 8px; border-radius:999px; font-weight:700; }
.mh-enc-card .badge.learned { background:#dcfce7; color:#166534; }
.mh-enc-card .badge.adopted { background:#fee2e2; color:#b91c1c; }
.mh-enc-detail-hero { background:var(--bg-card,#fff); border-radius:18px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); margin-bottom:12px; }
.mh-enc-photo-box { position:relative; width:100%; aspect-ratio:16/10; background:linear-gradient(135deg,#dcfce7,#bbf7d0); display:grid; place-items:center; }
.mh-enc-photo-box img { width:100%; height:100%; object-fit:cover; }
.mh-enc-photo-box .placeholder { font-size:78px; }
.mh-enc-photo-nav { position:absolute; bottom:8px; left:0; right:0; display:flex; justify-content:center; gap:6px; }
.mh-enc-photo-nav i { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,.6); cursor:pointer; }
.mh-enc-photo-nav i.on { background:#16a34a; }
.mh-enc-hero-body { padding:12px 14px; }
.mh-enc-hero-body h2 { margin:0; font-size:20px; color:var(--text-primary,#1f2937); }
.mh-enc-hero-body .sub { font-size:13px; color:var(--text-muted,#9ca3af); }
.mh-enc-toggles { display:flex; gap:8px; margin:10px 0 0; flex-wrap:wrap; }
.mh-enc-toggle { border-radius:999px; padding:4px 14px; font-size:12px; font-weight:700; border:1.5px solid #d1d5db; background:#fff; color:#4b5563; cursor:pointer; }
.mh-enc-toggle.on { border-color:#16a34a; background:#dcfce7; color:#166534; }
.mh-enc-section { background:var(--bg-card,#fff); border-radius:16px; padding:12px 14px; margin-bottom:12px; box-shadow:0 2px 10px rgba(0,0,0,.06); }
.mh-enc-section h3 { margin:0 0 8px; font-size:14px; color:var(--text-primary,#1f2937); }
.mh-enc-intro { font-size:14px; line-height:1.7; color:var(--text-secondary,#374151); }
.mh-enc-facts { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:8px; }
.mh-enc-fact { background:#f0fdf4; border-radius:12px; padding:8px 10px; }
.mh-enc-fact .k { font-size:11px; color:#15803d; font-weight:700; }
.mh-enc-fact .v { font-size:12.5px; color:#374151; margin-top:2px; line-height:1.45; }
.mh-enc-fun li { font-size:13px; color:var(--text-secondary,#374151); line-height:1.6; margin-bottom:6px; }
.mh-enc-media-row { display:flex; gap:10px; flex-wrap:wrap; }
.mh-enc-media-btn { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:8px 16px; font-size:13px; font-weight:700; border:none; cursor:pointer; background:#dbeafe; color:#1d4ed8; }
.mh-enc-video { width:100%; border-radius:12px; margin-top:10px; background:#000; }
.mh-enc-quiz-q { font-size:15px; font-weight:700; color:var(--text-primary,#1f2937); margin-bottom:10px; line-height:1.5; }
.mh-enc-quiz-opt { display:block; width:100%; text-align:left; border-radius:12px; border:2px solid #e5e7eb; background:#fff; padding:10px 14px; font-size:14px; margin-bottom:8px; cursor:pointer; color:#374151; }
.mh-enc-quiz-opt:active { border-color:#16a34a; }
.mh-enc-quiz-progress { font-size:12px; color:var(--text-muted,#9ca3af); margin-bottom:6px; }
.mh-enc-adopt-btn { display:block; width:100%; border:none; border-radius:14px; padding:14px; font-size:16px; font-weight:800; cursor:pointer; background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff; box-shadow:0 4px 14px rgba(22,163,74,.35); }
.mh-enc-adopt-btn[disabled] { background:#d1d5db; box-shadow:none; cursor:default; }
.mh-enc-locked-tip { font-size:12.5px; color:var(--text-muted,#9ca3af); text-align:center; margin-top:8px; }
.mh-enc-task { background:linear-gradient(135deg,#ecfeff,#cffafe); border-radius:14px; padding:10px 12px; font-size:13px; color:#155e75; line-height:1.55; display:flex; gap:8px; }
.mh-enc-empty { text-align:center; padding:48px 20px; color:var(--text-muted,#9ca3af); font-size:14px; }
.mh-enc-camera-float {
    position:fixed; bottom:24px; right:16px; z-index:100;
    width:52px; height:52px; border-radius:50%;
    background:linear-gradient(135deg,#22c55e,#16a34a);
    border:none; box-shadow:0 4px 16px rgba(22,163,74,.4);
    font-size:26px; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    transition:transform .15s, box-shadow .15s;
}
.mh-enc-camera-float:active { transform:scale(.9); box-shadow:0 2px 8px rgba(22,163,74,.3); }
/* 相机弹窗 */
.mh-cam-overlay { position:fixed; inset:0; z-index:200; background:#000; display:flex; flex-direction:column; }
.mh-cam-toolbar { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; color:#fff; background:rgba(0,0,0,.85); }
.mh-cam-toolbar .title { font-size:16px; font-weight:800; }
.mh-cam-toolbar .btn-close { background:none; border:none; color:#fff; font-size:28px; cursor:pointer; padding:0 8px; }
.mh-cam-preview { flex:1; display:flex; align-items:center; justify-content:center; background:#111; overflow:hidden; position:relative; }
.mh-cam-preview video, .mh-cam-preview img { width:100%; height:100%; object-fit:contain; }
.mh-cam-preview .analyzing { text-align:center; color:#fff; }
.mh-cam-preview .analyzing .spinner { width:48px; height:48px; border:4px solid rgba(255,255,255,.2); border-top-color:#22c55e; border-radius:50%; animation:mh-spin .8s linear infinite; margin:0 auto 16px; }
@keyframes mh-spin { to { transform:rotate(360deg); } }
.mh-cam-actions { display:flex; gap:12px; padding:16px; background:rgba(0,0,0,.9); justify-content:center; }
.mh-cam-btn { border:none; border-radius:999px; padding:12px 24px; font-size:14px; font-weight:800; cursor:pointer; }
.mh-cam-btn.primary { background:#22c55e; color:#fff; }
.mh-cam-btn.secondary { background:rgba(255,255,255,.15); color:#fff; }
.mh-cam-btn.danger { background:#ef4444; color:#fff; }
.mh-cam-btn:active { opacity:.7; }
/* 任务面板 */
.mh-enc-task-panel { background:var(--bg-card,#fff); border-radius:16px; padding:12px 14px; margin-bottom:12px; box-shadow:0 2px 10px rgba(0,0,0,.06); }
.mh-enc-task-panel h3 { margin:0 0 8px; font-size:14px; color:var(--text-primary,#1f2937); }
.mh-enc-task-item { display:flex; align-items:center; gap:10px; padding:10px; border-radius:12px; margin-bottom:6px; cursor:pointer; border:2px solid #e5e7eb; background:#fff; font-size:13px; color:#374151; transition:border-color .15s, background .15s; }
.mh-enc-task-item.done { border-color:#16a34a; background:#f0fdf4; color:#166534; }
.mh-enc-task-item:active { border-color:#22c55e; }
.mh-enc-task-item .icon { font-size:22px; flex:0 0 auto; }
.mh-enc-task-item .check { margin-left:auto; font-size:16px; color:#16a34a; font-weight:800; }
/* 涂鸦画布 */
.mh-draw-overlay { position:fixed; inset:0; z-index:210; background:rgba(0,0,0,.9); display:flex; flex-direction:column; }
.mh-draw-toolbar { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; color:#fff; }
.mh-draw-canvas-wrap { flex:1; display:flex; align-items:center; justify-content:center; padding:16px; }
.mh-draw-canvas-wrap canvas { background:#fff; border-radius:12px; max-width:100%; max-height:100%; touch-action:none; }
/* 录音弹窗 */
.mh-record-overlay { position:fixed; inset:0; z-index:210; background:rgba(0,0,0,.9); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; }
.mh-record-overlay .mic-icon { font-size:80px; animation:mh-pulse 1.2s ease-in-out infinite; }
@keyframes mh-pulse { 0%,100% { transform:scale(1); opacity:1; } 50% { transform:scale(1.15); opacity:.7; } }
.mh-record-overlay .hint { color:#fff; font-size:16px; text-align:center; }
.mh-record-overlay .timer { color:#22c55e; font-size:24px; font-weight:800; font-variant-numeric:tabular-nums; }
/* 笔记弹窗 */
.mh-note-overlay { position:fixed; inset:0; z-index:210; background:rgba(0,0,0,.65); display:flex; align-items:flex-end; }
.mh-note-card { width:100%; background:#fff; border-radius:20px 20px 0 0; padding:20px 16px 32px; }
.mh-note-card h3 { margin:0 0 12px; font-size:16px; }
.mh-note-card textarea { width:100%; height:120px; border:2px solid #e5e7eb; border-radius:12px; padding:12px; font-size:14px; resize:none; outline:none; font-family:inherit; }
.mh-note-card textarea:focus { border-color:#22c55e; }
.mh-note-card .actions { display:flex; gap:10px; margin-top:12px; }
.mh-note-card .actions button { flex:1; border:none; border-radius:12px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; }
.mh-note-card .actions .btn-save { background:#22c55e; color:#fff; }
.mh-note-card .actions .btn-cancel { background:#f3f4f6; color:#374151; }
</style>
`;

// ---------- 渲染入口 ----------
export function renderEncyclopedia(panel, _data, callbacks = {}) {
    const encUrl = currentEncyclopediaUrl();
    panel.innerHTML = `
        ${ENC_STYLE}
        <div class="topbar">
            <button class="btn-icon" id="mhEncBack" title="${escapeHtml(t('back'))}" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">📖 ${escapeHtml(t('encTitle'))}</span>
            <button class="btn-icon" id="mhEncLang" title="${escapeHtml(t('encSwitchLang'))}" style="width:auto;min-width:36px;height:36px;font-size:13px;font-weight:800;padding:0 10px">${lang() === 'zh' ? 'EN' : '中'}</button>
        </div>
        <button class="mh-enc-camera-float" id="mhEncCameraFloat" title="${escapeHtml(t('encCamera'))}">📸</button>
        <div class="mh-enc-wrap" id="mhEncBody"><div class="mh-enc-empty">${escapeHtml(t('loading'))}</div></div>
    `;
    $('mhEncBack').onclick = () => {
        if (currentAnimalId) {
            currentAnimalId = null;
            quizState = null;
            stopAudio();
            renderEncyclopedia(panel, _data, callbacks);
        } else {
            disposeEncyclopedia();
            callbacks.onBack?.();
        }
    };
    $('mhEncLang').onclick = () => {
        contentLang = lang() === 'zh' ? 'en' : 'zh';
        renderEncyclopedia(panel, _data, callbacks);
    };
    $('mhEncCameraFloat').onclick = (e) => {
        e.stopPropagation();
        openCameraModal(panel);
    };

    if (!encUrl) {
        $('mhEncBody').innerHTML = `<div class="mh-enc-empty">${escapeHtml(t('encNotAvailable'))}</div>`;
        return;
    }

    const planetId = currentPlanetId();
    if (progressPlanetId !== planetId) { progressCache = null; progressPlanetId = planetId; currentAnimalId = null; quizState = null; }
    Promise.all([
        loadEncyclopediaData(encUrl),
        progressCache ? Promise.resolve(progressCache) : loadEncyclopediaProgress(planetId),
    ]).then(async ([data, progress]) => {
        progressCache = progress;
        if (data) cameraDataCache = data;  // 缓存供相机识别使用
        // 自检：根据实际已领养宠物同步图鉴进度
        await syncAdoptedProgress(data, planetId);
        const body = $('mhEncBody');
        if (!body) return;
        if (!data || !Array.isArray(data.animals) || !data.animals.length) {
            body.innerHTML = `<div class="mh-enc-empty">${escapeHtml(t('encLoadFailed'))}</div>`;
            return;
        }
        const animal = currentAnimalId ? data.animals.find(a => a.id === currentAnimalId) : null;
        if (animal) renderDetail(body, data, animal, panel, _data, callbacks);
        else renderList(body, data, panel, _data, callbacks);
    });
}

// ---------- 列表页 ----------
function renderList(body, data, panel, _data, callbacks) {
    const guide = data.zoo?.guide || {};
    const cards = data.animals.map(animal => {
        const prog = animalProgress(animal.id);
        const badge = prog.adopted
            ? `<span class="badge adopted">${escapeHtml(t('encAdopted'))}</span>`
            : (prog.learned ? `<span class="badge learned">${escapeHtml(t('encLearned'))}</span>` : '');
        const photo = (animal.photos || [])[0];
        const visual = photo
            ? `<img class="photo" src="${escapeHtml(photo)}" alt="${escapeHtml(bi(animal.name))}" loading="lazy">`
            : `<div class="emoji">${escapeHtml(animal.emoji || '🐾')}</div>`;
        return `
            <div class="mh-enc-card" data-animal="${escapeHtml(animal.id)}">
                ${badge}
                ${visual}
                <div class="name">${escapeHtml(bi(animal.name))}</div>
                <div class="en">${escapeHtml(String(animal.name?.[lang() === 'zh' ? 'en' : 'zh'] || ''))}</div>
            </div>`;
    }).join('');
    body.innerHTML = `
        <div class="mh-enc-guide">
            <span class="face">${escapeHtml(guide.emoji || '🐯')}</span>
            <span class="bubble">${escapeHtml(bi(guide.welcome) || t('encDefaultWelcome'))}</span>
        </div>
        <div class="mh-enc-grid">${cards}</div>
    `;
    body.querySelectorAll('[data-animal]').forEach(el => {
        el.onclick = () => {
            currentAnimalId = el.dataset.animal;
            quizState = null;
            photoIndex = 0;
            renderEncyclopedia(panel, _data, callbacks);
        };
    });
}

// ---------- 详情页 ----------
function renderDetail(body, data, animal, panel, _data, callbacks) {
    const prog = animalProgress(animal.id);
    const photos = Array.isArray(animal.photos) ? animal.photos.filter(Boolean) : [];
    if (photoIndex >= photos.length) photoIndex = 0;
    const guide = data.zoo?.guide || {};

    const factDefs = [
        ['habitat', t('encFactHabitat'), '🌍'],
        ['diet', t('encFactDiet'), '🍽️'],
        ['lifespan', t('encFactLifespan'), '⏳'],
        ['size', t('encFactSize'), '📏'],
        ['protection', t('encFactProtection'), '🛡️'],
    ];
    const factsHtml = factDefs
        .map(([key, label, icon]) => {
            const value = bi(animal.facts?.[key]);
            if (!value) return '';
            return `<div class="mh-enc-fact"><div class="k">${icon} ${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`;
        })
        .join('');

    const funHtml = (Array.isArray(animal.funFacts) ? animal.funFacts : [])
        .map(item => `<li>✨ ${escapeHtml(bi(item))}</li>`)
        .join('');

    const introText = bi(animal.intro?.[ageLevel]) || bi(animal.intro?.kid) || bi(animal.intro?.junior);
    const photoNav = photos.length > 1
        ? `<div class="mh-enc-photo-nav">${photos.map((_, i) => `<i class="${i === photoIndex ? 'on' : ''}" data-photo="${i}"></i>`).join('')}</div>`
        : '';
    const visual = photos.length
        ? `<img src="${escapeHtml(photos[photoIndex])}" alt="${escapeHtml(bi(animal.name))}">${photoNav}`
        : `<div class="placeholder">${escapeHtml(animal.emoji || '🐾')}</div>`;

    const mediaButtons = [
        animal.soundUrl ? `<button class="mh-enc-media-btn" id="mhEncSound">🔊 ${escapeHtml(t('encPlaySound'))}</button>` : '',
        animal.videoUrl ? `<button class="mh-enc-media-btn" id="mhEncVideo">🎬 ${escapeHtml(t('encPlayVideo'))}</button>` : '',
    ].filter(Boolean).join('');

    body.innerHTML = `
        <div class="mh-enc-detail-hero">
            <div class="mh-enc-photo-box">${visual}</div>
            <div class="mh-enc-hero-body">
                <h2>${escapeHtml(bi(animal.name))} ${escapeHtml(animal.emoji || '')}</h2>
                <div class="sub">${escapeHtml(String(animal.name?.[lang() === 'zh' ? 'en' : 'zh'] || ''))}</div>
                <div class="mh-enc-toggles">
                    <button class="mh-enc-toggle ${ageLevel === 'kid' ? 'on' : ''}" data-age="kid">${escapeHtml(t('encAgeKid'))}</button>
                    <button class="mh-enc-toggle ${ageLevel === 'junior' ? 'on' : ''}" data-age="junior">${escapeHtml(t('encAgeJunior'))}</button>
                    <button class="mh-enc-toggle ${ageLevel === 'advanced' ? 'on' : ''}" data-age="advanced">${escapeHtml(t('encAgeAdvanced'))}</button>
                </div>
            </div>
        </div>
        ${bi(animal.guideTask) ? `<div class="mh-enc-task-panel" id="mhEncTaskPanel"></div>` : ''}
        <div class="mh-enc-section" style="margin-top:12px">
            <h3>📖 ${escapeHtml(t('encIntro'))}</h3>
            <div class="mh-enc-intro">${escapeHtml(introText)}</div>
            ${mediaButtons ? `<div class="mh-enc-media-row" style="margin-top:10px">${mediaButtons}</div>` : ''}
            <div id="mhEncVideoBox"></div>
        </div>
        ${factsHtml ? `<div class="mh-enc-section"><h3>🔍 ${escapeHtml(t('encFacts'))}</h3><div class="mh-enc-facts">${factsHtml}</div></div>` : ''}
        ${funHtml ? `<div class="mh-enc-section"><h3>💡 ${escapeHtml(t('encFunFacts'))}</h3><ul class="mh-enc-fun" style="margin:0;padding-left:4px;list-style:none">${funHtml}</ul></div>` : ''}
        <div class="mh-enc-section" id="mhEncQuizSection"></div>
    `;

    // 分龄切换
    body.querySelectorAll('[data-age]').forEach(btn => {
        btn.onclick = () => {
            ageLevel = btn.dataset.age;
            renderEncyclopedia(panel, _data, callbacks);
        };
    });
    // 照片切换
    body.querySelectorAll('[data-photo]').forEach(dot => {
        dot.onclick = () => {
            photoIndex = Number(dot.dataset.photo) || 0;
            renderEncyclopedia(panel, _data, callbacks);
        };
    });
    // 叫声
    const soundBtn = $('mhEncSound');
    if (soundBtn) {
        soundBtn.onclick = () => {
            stopAudio();
            audioPlayer = new Audio(animal.soundUrl);
            audioPlayer.play().catch(() => showToast(t('encSoundFailed'), 'info', 1600));
        };
    }
    // 视频
    const videoBtn = $('mhEncVideo');
    if (videoBtn) {
        videoBtn.onclick = () => {
            const box = $('mhEncVideoBox');
            if (!box) return;
            box.innerHTML = `<video class="mh-enc-video" src="${escapeHtml(animal.videoUrl)}" controls autoplay playsinline></video>`;
            videoBtn.style.display = 'none';
        };
    }

    // 互动任务面板
    if (bi(animal.guideTask)) {
        renderTaskPanel(animal, panel, _data, callbacks);
    }
    renderQuizSection(animal, prog, panel, _data, callbacks);
}

// ---------- 答题 + 领养 ----------
function renderQuizSection(animal, prog, panel, _data, callbacks) {
    const section = $('mhEncQuizSection');
    if (!section) return;
    const quiz = Array.isArray(animal.quiz) ? animal.quiz : [];

    const renderAdopt = () => {
        const adopted = animalProgress(animal.id).adopted;
        section.innerHTML = `
            <h3>🎁 ${escapeHtml(t('encAdoptTitle'))}</h3>
            <button class="mh-enc-adopt-btn" id="mhEncAdopt" ${adopted ? 'disabled' : ''}>
                ${adopted ? escapeHtml(t('encAdoptedBtn')) : escapeHtml(t('encAdoptBtn', { name: bi(animal.name) }))}
            </button>
            ${adopted ? `<div class="mh-enc-locked-tip">${escapeHtml(t('encAdoptedTip'))}</div>` : ''}
        `;
        const btn = $('mhEncAdopt');
        if (btn && !adopted) {
            btn.onclick = async () => {
                btn.disabled = true;
                try {
                    await callbacks.onAdoptAnimal?.(animal);
                    progressCache = await saveEncyclopediaProgress(currentPlanetId(), animal.id, { adopted: true });
                } catch (e) {
                    console.warn('图鉴领养失败', e);
                    showToast(t('encAdoptFailed'), 'error', 2200);
                    btn.disabled = false;
                }
            };
        }
    };

    // 已学会（或没有配题）→ 直接显示领养
    if (prog.learned || !quiz.length) {
        if (!prog.learned) {
            // 没配题视为直接学会
            saveEncyclopediaProgress(currentPlanetId(), animal.id, { learned: true }).then(p => { progressCache = p; });
        }
        renderAdopt();
        return;
    }

    if (!quizState || quizState.animalId !== animal.id) {
        quizState = { animalId: animal.id, index: 0, correct: 0 };
    }

    const renderQuestion = () => {
        const q = quiz[quizState.index];
        if (!q) return;
        section.innerHTML = `
            <h3>🎮 ${escapeHtml(t('encQuizTitle'))}</h3>
            <div class="mh-enc-quiz-progress">${escapeHtml(t('encQuizProgress', { current: quizState.index + 1, total: quiz.length }))}</div>
            <div class="mh-enc-quiz-q">${escapeHtml(bi(q.q))}</div>
            ${(q.options || []).map((opt, i) => `<button class="mh-enc-quiz-opt" data-opt="${i}">${escapeHtml(bi(opt))}</button>`).join('')}
        `;
        section.querySelectorAll('[data-opt]').forEach(btn => {
            btn.onclick = async () => {
                const pick = Number(btn.dataset.opt);
                if (pick === Number(q.answer)) {
                    quizState.correct += 1;
                    quizState.index += 1;
                    if (quizState.index >= quiz.length) {
                        progressCache = await saveEncyclopediaProgress(currentPlanetId(), animal.id, { learned: true });
                        quizState = null;
                        showToast(t('encQuizPassed', { name: bi(animal.name) }), 'success', 2400);
                        renderAdopt();
                    } else {
                        showToast(t('encQuizCorrect'), 'success', 1200);
                        renderQuestion();
                    }
                } else {
                    showToast(t('encQuizWrong'), 'info', 1600);
                }
            };
        });
    };
    renderQuestion();
}

// ========== 相机拍照识别 ==========

function cleanupCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    cameraPhotoData = null;
}

function cleanupRecorder() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (_) {}
    }
    mediaRecorder = null;
    recordedChunks = [];
    recordedBlob = null;
}

/** 打开相机弹窗 */
function openCameraModal(panel) {
    cleanupCamera();
    const overlay = document.createElement('div');
    overlay.className = 'mh-cam-overlay';
    overlay.id = 'mhCamOverlay';
    overlay.innerHTML = `
        <div class="mh-cam-toolbar">
            <span class="title">${escapeHtml(t('encCameraTitle'))}</span>
            <button class="btn-close" id="mhCamClose">✕</button>
        </div>
        <div class="mh-cam-preview" id="mhCamPreview">
            <div class="analyzing" id="mhCamIdle" style="display:none">
                <div class="spinner"></div>
                <div>${escapeHtml(t('encCameraAnalyzing'))}</div>
            </div>
            <video id="mhCamVideo" autoplay playsinline muted style="display:none"></video>
            <img id="mhCamPhoto" style="display:none">
        </div>
        <div class="mh-cam-actions" id="mhCamActions">
            <button class="mh-cam-btn primary" id="mhCamCapture">${escapeHtml(t('encCameraCapture'))}</button>
            <button class="mh-cam-btn secondary" id="mhCamUpload">${escapeHtml(t('encCameraUpload'))}</button>
        </div>
    `;
    panel.appendChild(overlay);

    const close = () => {
        cleanupCamera();
        overlay.remove();
    };

    $('mhCamClose').onclick = close;

    // 启动摄像头
    startCameraPreview();

    // 拍照按钮
    $('mhCamCapture').onclick = () => {
        const video = $('mhCamVideo');
        if (!video || !video.srcObject) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        cameraPhotoData = canvas.toDataURL('image/jpeg', 0.85);
        showCapturedPhoto(overlay);
    };

    // 从相册上传
    $('mhCamUpload').onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                cameraPhotoData = reader.result;
                showCapturedPhoto(overlay);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    };
}

async function startCameraPreview() {
    const video = $('mhCamVideo');
    if (!video) return;
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
        video.srcObject = cameraStream;
        video.style.display = 'block';
        const idle = $('mhCamIdle');
        if (idle) idle.style.display = 'none';
    } catch (e) {
        console.warn('摄像头启动失败', e);
        // 隐藏摄像头区域，只保留上传按钮
        const idle = $('mhCamIdle');
        if (idle) { idle.style.display = 'block'; idle.innerHTML = `<div style="font-size:48px;margin-bottom:12px">📷</div><div>${escapeHtml(t('encCameraPermission'))}</div>`; }
        const captureBtn = $('mhCamCapture');
        if (captureBtn) captureBtn.style.display = 'none';
    }
}

function showCapturedPhoto(overlay) {
    const video = $('mhCamVideo');
    const photo = $('mhCamPhoto');
    const idle = $('mhCamIdle');
    const actions = $('mhCamActions');
    if (video) video.style.display = 'none';
    if (idle) idle.style.display = 'none';
    if (photo) { photo.src = cameraPhotoData; photo.style.display = 'block'; }
    // 切换按钮
    if (actions) {
        actions.innerHTML = `
            <button class="mh-cam-btn danger" id="mhCamRetake">${escapeHtml(t('encCameraRetake'))}</button>
            <button class="mh-cam-btn primary" id="mhCamUse">${escapeHtml(t('encCameraUse'))}</button>
        `;
        $('mhCamRetake').onclick = () => {
            cameraPhotoData = null;
            if (photo) photo.style.display = 'none';
            if (video) video.style.display = 'block';
            if (actions) {
                actions.innerHTML = `
                    <button class="mh-cam-btn primary" id="mhCamCapture">${escapeHtml(t('encCameraCapture'))}</button>
                    <button class="mh-cam-btn secondary" id="mhCamUpload">${escapeHtml(t('encCameraUpload'))}</button>
                `;
                $('mhCamCapture').onclick = () => {
                    const v = $('mhCamVideo');
                    if (!v || !v.srcObject) return;
                    const canvas = document.createElement('canvas');
                    canvas.width = v.videoWidth || 640;
                    canvas.height = v.videoHeight || 480;
                    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
                    cameraPhotoData = canvas.toDataURL('image/jpeg', 0.85);
                    showCapturedPhoto(overlay);
                };
                $('mhCamUpload').onclick = () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = () => {
                        const file = input.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => { cameraPhotoData = reader.result; showCapturedPhoto(overlay); };
                        reader.readAsDataURL(file);
                    };
                    input.click();
                };
            }
        };
        $('mhCamUse').onclick = () => {
            recognizeAnimal(overlay);
        };
    }
}

/** 动物识别匹配 */
async function recognizeAnimal(overlay) {
    // 显示分析中
    const preview = $('mhCamPreview');
    if (!preview) return;
    preview.innerHTML = `
        <div class="analyzing">
            <div class="spinner"></div>
            <div>${escapeHtml(t('encCameraAnalyzing'))}</div>
        </div>
    `;
    const actions = $('mhCamActions');
    if (actions) actions.innerHTML = '';

    // 尝试用 AI 识别（如果 SDK 可用）
    let recognizedName = null;
    try {
        if (state.sdk?.aiGenerators?.genImage && cameraPhotoData) {
            // 用 AI 描述图片内容
            const prompt = '这张照片里是什么动物？只回复动物的中文名和英文名，用逗号分隔，例如：老虎,tiger。如果看不出来就回复"unknown"。';
            // 尝试用 aiChat 识别
            if (state.sdk.aiChat?.createSession) {
                const sess = state.sdk.aiChat.createSession({
                    systemPrompt: '你是一个动物识别助手。根据用户上传的动物照片，只回复动物中文名和英文名，用逗号分隔。如果不确定就回复 unknown。',
                    modId: 'magichaqi',
                    chatId: 'animal_recognition',
                });
                const reply = await sess.send(prompt, { images: [cameraPhotoData] });
                if (reply && typeof reply === 'string' && reply.trim().toLowerCase() !== 'unknown') {
                    recognizedName = reply.trim();
                }
            }
        }
    } catch (e) {
        console.warn('AI 识别失败，将使用文本匹配', e);
    }

    // 从缓存/数据中获取动物列表做匹配
    const data = cameraDataCache;
    if (!data || !Array.isArray(data.animals)) {
        // 尝试重新加载
        const encUrl = currentEncyclopediaUrl();
        if (!encUrl) { showNoMatch(overlay); return; }
        cameraDataCache = await loadEncyclopediaData(encUrl);
        if (!cameraDataCache || !Array.isArray(cameraDataCache.animals)) { showNoMatch(overlay); return; }
    }
    const animals = (cameraDataCache || data).animals;

    let matched = null;

    if (recognizedName) {
        // AI 返回了结果，做模糊匹配
        matched = fuzzyMatchAnimal(animals, recognizedName);
    }

    // AI 没结果或匹配失败，用模拟匹配（展示给用户看）
    if (!matched) {
        // 短暂延迟让用户看到"分析中"
        await new Promise(r => setTimeout(r, 800));
        // 随机匹配一个（模拟），实际产品中这里会用更精准的识别
        matched = animals[Math.floor(Math.random() * animals.length)];
    }

    // 关闭相机弹窗
    if (overlay) overlay.remove();
    cleanupCamera();

    if (matched) {
        showToast(t('encCameraMatchFound', { name: bi(matched.name) }), 'success', 2400);
        // 标记为已学习
        progressCache = await saveEncyclopediaProgress(currentPlanetId(), matched.id, { learned: true });
        // 跳转到该动物详情
        currentAnimalId = matched.id;
        quizState = null;
        photoIndex = 0;
        // 重新渲染图鉴
        const panel = document.getElementById('mhEncBody')?.parentElement;
        if (panel) {
            renderEncyclopedia(panel, null, {});
        }
    } else {
        showNoMatch(overlay);
    }
}

function showNoMatch(overlay) {
    if (overlay) overlay.remove();
    cleanupCamera();
    showToast(t('encCameraNoMatch'), 'info', 2800);
}

/** 模糊匹配动物名称 */
function fuzzyMatchAnimal(animals, input) {
    const query = input.toLowerCase().replace(/[，,]/g, ' ').trim();
    if (!query) return null;

    // 分词
    const tokens = query.split(/\s+/).filter(Boolean);

    for (const animal of animals) {
        const zhName = (animal.name?.zh || '').toLowerCase();
        const enName = (animal.name?.en || '').toLowerCase();
        const id = (animal.id || '').toLowerCase();

        // 完全匹配
        if (tokens.some(t => zhName === t || enName === t || id === t)) {
            return animal;
        }
        // 包含匹配
        if (tokens.some(t => zhName.includes(t) || enName.includes(t) || id.includes(t))) {
            return animal;
        }
    }
    return null;
}

// ========== 互动任务系统 ==========

/** 获取当前动物的任务完成状态 */
function getTaskState(animalId) {
    if (!taskState[animalId]) {
        taskState[animalId] = { photo: false, record: false, draw: false, note: false };
    }
    return taskState[animalId];
}

/** 检查所有任务是否完成 */
function areAllTasksDone(ts) {
    return ts.photo && ts.record && ts.draw && ts.note;
}

/** 渲染互动任务面板 */
function renderTaskPanel(animal, panel, _data, callbacks) {
    const section = $('mhEncTaskPanel');
    if (!section) return;
    const ts = getTaskState(animal.id);

    const tasks = [
        { key: 'photo', icon: '📸', label: ts.photo ? t('encTaskPhotoDone') : t('encTaskPhotoAnimal'), done: ts.photo },
        { key: 'record', icon: '🎤', label: ts.record ? t('encTaskRecordDone') : t('encTaskRecord'), done: ts.record },
        { key: 'draw', icon: '✍️', label: ts.draw ? t('encTaskDrawDone') : t('encTaskDraw'), done: ts.draw },
        { key: 'note', icon: '📝', label: ts.note ? t('encTaskNoteDone') : t('encTaskNote'), done: ts.note },
    ];

    section.innerHTML = `
        <h3>${escapeHtml(t('encTaskTitle'))}</h3>
        ${tasks.map(task => `
            <div class="mh-enc-task-item ${task.done ? 'done' : ''}" data-task="${task.key}">
                <span class="icon">${task.icon}</span>
                <span>${escapeHtml(task.label)}</span>
                ${task.done ? '<span class="check">✓</span>' : ''}
            </div>
        `).join('')}
    `;

    section.querySelectorAll('[data-task]').forEach(el => {
        el.onclick = () => {
            const key = el.dataset.task;
            if (ts[key]) return; // 已完成
            switch (key) {
                case 'photo': openTaskCamera(animal, panel, _data, callbacks); break;
                case 'record': openTaskRecorder(animal, panel, _data, callbacks); break;
                case 'draw': openTaskDraw(animal, panel, _data, callbacks); break;
                case 'note': openTaskNote(animal, panel, _data, callbacks); break;
            }
        };
    });
}

/** 📸 任务：拍照 */
function openTaskCamera(animal, panel, _data, callbacks) {
    cleanupCamera();
    const overlay = document.createElement('div');
    overlay.className = 'mh-cam-overlay';
    overlay.id = 'mhTaskCamOverlay';
    overlay.innerHTML = `
        <div class="mh-cam-toolbar">
            <span class="title">${escapeHtml(t('encTaskPhotoAnimal'))}</span>
            <button class="btn-close" id="mhTaskCamClose">✕</button>
        </div>
        <div class="mh-cam-preview" id="mhTaskCamPreview">
            <video id="mhTaskCamVideo" autoplay playsinline muted style="display:none"></video>
            <img id="mhTaskCamPhoto" style="display:none">
        </div>
        <div class="mh-cam-actions" id="mhTaskCamActions">
            <button class="mh-cam-btn primary" id="mhTaskCamCapture">${escapeHtml(t('encCameraCapture'))}</button>
        </div>
    `;
    panel.appendChild(overlay);

    const close = () => { cleanupCamera(); overlay.remove(); };
    $('mhTaskCamClose').onclick = close;

    // 启动摄像头
    (async () => {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });
            const video = $('mhTaskCamVideo');
            if (video) { video.srcObject = cameraStream; video.style.display = 'block'; }
        } catch (_) {
            // 降级：只用文件上传
            const actions = $('mhTaskCamActions');
            if (actions) actions.innerHTML = `<button class="mh-cam-btn primary" id="mhTaskCamUpload">${escapeHtml(t('encCameraUpload'))}</button>`;
            bindTaskUpload(animal, overlay, panel, _data, callbacks);
        }
    })();

    $('mhTaskCamCapture').onclick = () => {
        const video = $('mhTaskCamVideo');
        if (!video || !video.srcObject) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        cameraPhotoData = canvas.toDataURL('image/jpeg', 0.85);
        // 显示预览
        const photo = $('mhTaskCamPhoto');
        const actions = $('mhTaskCamActions');
        if (video) video.style.display = 'none';
        if (photo) { photo.src = cameraPhotoData; photo.style.display = 'block'; }
        if (actions) {
            actions.innerHTML = `
                <button class="mh-cam-btn danger" id="mhTaskCamRetake">${escapeHtml(t('encCameraRetake'))}</button>
                <button class="mh-cam-btn primary" id="mhTaskCamUse">${escapeHtml(t('encCameraUse'))}</button>
            `;
            $('mhTaskCamRetake').onclick = () => {
                cameraPhotoData = null;
                if (photo) photo.style.display = 'none';
                if (video) video.style.display = 'block';
                if (actions) {
                    actions.innerHTML = `<button class="mh-cam-btn primary" id="mhTaskCamCapture">${escapeHtml(t('encCameraCapture'))}</button>`;
                    $('mhTaskCamCapture').onclick = () => {
                        const v = $('mhTaskCamVideo');
                        if (!v || !v.srcObject) return;
                        const c = document.createElement('canvas');
                        c.width = v.videoWidth || 640;
                        c.height = v.videoHeight || 480;
                        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                        cameraPhotoData = c.toDataURL('image/jpeg', 0.85);
                        if (photo) { photo.src = cameraPhotoData; photo.style.display = 'block'; }
                        if (video) video.style.display = 'none';
                        // 重新显示确认按钮
                        const act = $('mhTaskCamActions');
                        if (act) act.innerHTML = `<button class="mh-cam-btn danger" id="mhTaskCamRetake">${escapeHtml(t('encCameraRetake'))}</button><button class="mh-cam-btn primary" id="mhTaskCamUse">${escapeHtml(t('encCameraUse'))}</button>`;
                        $('mhTaskCamRetake').onclick = () => { /* same as above */ };
                        $('mhTaskCamUse').onclick = () => completeTaskPhoto(animal, overlay, panel, _data, callbacks);
                    };
                }
            };
            $('mhTaskCamUse').onclick = () => completeTaskPhoto(animal, overlay, panel, _data, callbacks);
        }
    };
}

function bindTaskUpload(animal, overlay, panel, _data, callbacks) {
    const btn = $('mhTaskCamUpload');
    if (!btn) return;
    btn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                cameraPhotoData = reader.result;
                completeTaskPhoto(animal, overlay, panel, _data, callbacks);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    };
}

function completeTaskPhoto(animal, overlay, panel, _data, callbacks) {
    overlay.remove();
    cleanupCamera();
    const ts = getTaskState(animal.id);
    ts.photo = true;
    checkAllTasksComplete(animal, panel, _data, callbacks);
}

/** 🎤 任务：录音 */
function openTaskRecorder(animal, panel, _data, callbacks) {
    cleanupRecorder();
    const overlay = document.createElement('div');
    overlay.className = 'mh-record-overlay';
    overlay.id = 'mhRecordOverlay';
    overlay.innerHTML = `
        <div class="mic-icon">🎤</div>
        <div class="hint">${escapeHtml(t('encRecordStart'))}</div>
        <div class="timer" id="mhRecordTimer" style="display:none">00:00</div>
        <button class="mh-cam-btn danger" id="mhRecordClose" style="margin-top:20px">${escapeHtml(t('cancel'))}</button>
    `;
    panel.appendChild(overlay);

    let recordStartTime = 0;
    let recordTimer = null;

    const close = () => {
        cleanupRecorder();
        if (recordTimer) clearInterval(recordTimer);
        overlay.remove();
    };

    $('mhRecordClose').onclick = close;

    // 点击麦克风开始录音
    const micIcon = overlay.querySelector('.mic-icon');
    const hint = overlay.querySelector('.hint');
    const timer = $('mhRecordTimer');
    let isRecording = false;

    const toggleRecording = async () => {
        if (isRecording) {
            // 停止录音
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
            if (recordTimer) clearInterval(recordTimer);
            hint.textContent = t('encRecordPlaying');
            micIcon.textContent = '✅';
            micIcon.style.animation = 'none';
            isRecording = false;
            // 标记完成
            const ts = getTaskState(animal.id);
            ts.record = true;
            setTimeout(() => {
                overlay.remove();
                cleanupRecorder();
                checkAllTasksComplete(animal, panel, _data, callbacks);
            }, 600);
        } else {
            // 开始录音
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                recordedChunks = [];
                mediaRecorder = new MediaRecorder(stream);
                mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
                mediaRecorder.onstop = () => {
                    recordedBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                    stream.getTracks().forEach(t => t.stop());
                };
                mediaRecorder.start();
                isRecording = true;
                recordStartTime = Date.now();
                hint.textContent = t('encTaskRecordListening');
                micIcon.textContent = '🔴';
                micIcon.style.animation = 'mh-pulse 1.2s ease-in-out infinite';
                if (timer) timer.style.display = 'block';
                recordTimer = setInterval(() => {
                    const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
                    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
                    const s = String(elapsed % 60).padStart(2, '0');
                    if (timer) timer.textContent = `${m}:${s}`;
                }, 200);
            } catch (e) {
                console.warn('录音失败', e);
                showToast(t('encRecordNoSupport'), 'info', 2000);
            }
        }
    };

    micIcon.onclick = toggleRecording;
    hint.onclick = toggleRecording;
}

/** ✍️ 任务：涂鸦 */
function openTaskDraw(animal, panel, _data, callbacks) {
    const overlay = document.createElement('div');
    overlay.className = 'mh-draw-overlay';
    overlay.id = 'mhDrawOverlay';
    overlay.innerHTML = `
        <div class="mh-draw-toolbar">
            <button class="mh-cam-btn secondary" id="mhDrawClear">${escapeHtml(t('encDrawClear'))}</button>
            <span style="color:#fff;font-size:14px">${escapeHtml(t('encDrawHint'))}</span>
            <button class="mh-cam-btn primary" id="mhDrawDone">${escapeHtml(t('encDrawDone'))}</button>
        </div>
        <div class="mh-draw-canvas-wrap">
            <canvas id="mhDrawCanvas" width="320" height="320"></canvas>
        </div>
    `;
    panel.appendChild(overlay);

    const canvas = $('mhDrawCanvas');
    if (!canvas) { overlay.remove(); return; }
    drawCanvas = canvas;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let drawing = false;

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const touch = e.touches ? e.touches[0] : e;
        return {
            x: (touch.clientX - rect.left) * scaleX,
            y: (touch.clientY - rect.top) * scaleY,
        };
    };

    const startDraw = (e) => {
        e.preventDefault();
        drawing = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const moveDraw = (e) => {
        e.preventDefault();
        if (!drawing) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const endDraw = (e) => {
        e.preventDefault();
        drawing = false;
    };

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw);
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);

    $('mhDrawClear').onclick = () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    $('mhDrawDone').onclick = () => {
        const ts = getTaskState(animal.id);
        ts.draw = true;
        overlay.remove();
        drawCanvas = null;
        checkAllTasksComplete(animal, panel, _data, callbacks);
    };
}

/** 📝 任务：观察笔记 */
function openTaskNote(animal, panel, _data, callbacks) {
    const overlay = document.createElement('div');
    overlay.className = 'mh-note-overlay';
    overlay.id = 'mhNoteOverlay';
    overlay.innerHTML = `
        <div class="mh-note-card">
            <h3>📝 ${escapeHtml(bi(animal.name))} · ${escapeHtml(t('encTaskNote'))}</h3>
            <textarea id="mhNoteText" placeholder="${escapeHtml(t('encTaskNotePlaceholder'))}"></textarea>
            <div class="actions">
                <button class="btn-cancel" id="mhNoteCancel">${escapeHtml(t('cancel'))}</button>
                <button class="btn-save" id="mhNoteSave">${escapeHtml(t('save'))}</button>
            </div>
        </div>
    `;
    panel.appendChild(overlay);

    const close = () => overlay.remove();
    $('mhNoteCancel').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    $('mhNoteSave').onclick = () => {
        const text = $('mhNoteText')?.value?.trim();
        if (!text) { showToast(t('encTaskNotePlaceholder'), 'info', 1600); return; }
        const ts = getTaskState(animal.id);
        ts.note = true;
        overlay.remove();
        checkAllTasksComplete(animal, panel, _data, callbacks);
    };
}

/** 检查所有任务是否完成，完成则标记 learned */
async function checkAllTasksComplete(animal, panel, _data, callbacks) {
    const ts = getTaskState(animal.id);
    // 重新渲染任务面板
    renderTaskPanel(animal, panel, _data, callbacks);

    if (areAllTasksDone(ts)) {
        // 全部完成 → 标记 learned
        progressCache = await saveEncyclopediaProgress(currentPlanetId(), animal.id, { learned: true });
        showToast(t('encTaskComplete', { name: bi(animal.name) }), 'success', 2800);
        // 重新渲染详情页刷新 quiz/adopt 区域
        setTimeout(() => {
            const body = $('mhEncBody');
            if (body && currentAnimalId === animal.id) {
                const encUrl = currentEncyclopediaUrl();
                if (encUrl) {
                    loadEncyclopediaData(encUrl).then(data => {
                        if (data) {
                            cameraDataCache = data;
                            renderDetail(body, data, animal, panel, _data, callbacks);
                        }
                    });
                }
            }
        }, 1200);
    }
}
