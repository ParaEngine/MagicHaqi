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
}

/** 离开星球 / 切换星球时重置图鉴 UI 状态。 */
export function resetEncyclopediaView() {
    currentAnimalId = null;
    quizState = null;
    photoIndex = 0;
    progressCache = null;
    progressPlanetId = '';
    stopAudio();
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

    if (!encUrl) {
        $('mhEncBody').innerHTML = `<div class="mh-enc-empty">${escapeHtml(t('encNotAvailable'))}</div>`;
        return;
    }

    const planetId = currentPlanetId();
    if (progressPlanetId !== planetId) { progressCache = null; progressPlanetId = planetId; currentAnimalId = null; quizState = null; }
    Promise.all([
        loadEncyclopediaData(encUrl),
        progressCache ? Promise.resolve(progressCache) : loadEncyclopediaProgress(planetId),
    ]).then(([data, progress]) => {
        progressCache = progress;
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
                </div>
            </div>
        </div>
        ${bi(animal.guideTask) ? `<div class="mh-enc-task"><span>${escapeHtml(guide.emoji || '🐯')}</span><span>${escapeHtml(bi(animal.guideTask))}</span></div>` : ''}
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
