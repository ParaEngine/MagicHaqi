// 故事场景创作视图：为 story maker 选择预设背景、粒子效果，或由 VIP 生成背景图。
import { escapeHtml, showToast } from './utils.js';
import { state } from './state.js';
import { CONFIG } from './config.js';

export const PRESET_SCENE_PATH = 'pet-story/presets/scenes.json';
export const DEFAULT_SCENE_TAGS = [
    'indoor', 'outdoor', 'land', 'sky', 'ocean', 'playground', 'bathroom', 'living room',
    'shop', 'school', 'spring', 'winter', 'seaside', 'haqi', 'townhall', 'forest', 'sand', 'hospital',
];
export const SCENE_TAG_PROMPT_HINT = DEFAULT_SCENE_TAGS.join(', ');

export const PARTICLE_EFFECTS = [
    { id: 'sparkle', label: '星光' },
    { id: 'snow', label: '雪花' },
    { id: 'rain', label: '细雨' },
    { id: 'mist', label: '薄雾' },
    { id: 'bubbles', label: '泡泡' },
    { id: 'petals', label: '花瓣' },
    { id: 'embers', label: '暖光' },
];

const TAG_ALIASES = {
    indoors: 'indoor', outside: 'outdoor', outdoors: 'outdoor', sea: 'ocean', beach: 'seaside',
    room: 'living room', livingroom: 'living room', bath: 'bathroom', town: 'townhall', woods: 'forest',
    playgrounds: 'playground', clinic: 'hospital', snow: 'winter', warm: 'spring', home: 'living room',
    室内: 'indoor', 户外: 'outdoor', 室外: 'outdoor', 陆地: 'land', 天空: 'sky', 海洋: 'ocean',
    操场: 'playground', 浴室: 'bathroom', 客厅: 'living room', 商店: 'shop', 学校: 'school',
    春天: 'spring', 冬天: 'winter', 海边: 'seaside', 哈奇: 'haqi', 镇大厅: 'townhall', 森林: 'forest',
    沙滩: 'sand', 沙子: 'sand', 医院: 'hospital', 家: 'living room', 小店: 'shop', 水: 'ocean', 雪: 'winter',
};

let presetCache = null;

function unique(items) {
    return [...new Set(items.filter(Boolean))];
}

function splitTagText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[，、；;|/]/g, ',')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeTag(tag) {
    const text = String(tag || '').trim().toLowerCase();
    if (!text) return '';
    return TAG_ALIASES[text] || text.replace(/[_-]+/g, ' ');
}

export function normalizeSceneTags(value) {
    const raw = Array.isArray(value) ? value : splitTagText(value);
    return unique(raw.map(normalizeTag));
}

export function sceneTagsFromText(text) {
    const lower = String(text || '').toLowerCase();
    const tags = [];
    [...DEFAULT_SCENE_TAGS, ...Object.keys(TAG_ALIASES)].forEach(tag => {
        const normalized = normalizeTag(tag);
        if (!normalized) return;
        if (lower.includes(tag.toLowerCase()) || lower.includes(normalized)) tags.push(normalized);
    });
    return unique(tags);
}

function normalizeParticleList(value) {
    const ids = new Set(PARTICLE_EFFECTS.map(item => item.id));
    return normalizeSceneTags(value).filter(tag => ids.has(tag));
}

export function normalizeScenePreset(scene = {}, index = 0) {
    const tags = normalizeSceneTags(scene.tags || scene.sceneTags || scene.keywords || []);
    return {
        id: String(scene.id || `scene_preset_${index + 1}`),
        title: String(scene.title || scene.name || `场景 ${index + 1}`),
        imageUrl: String(scene.imageUrl || scene.url || scene.src || ''),
        color: String(scene.color || scene.bgColor || '#bae6fd'),
        tags,
        particles: normalizeParticleList(scene.particles || scene.effects || []),
        prompt: String(scene.prompt || scene.description || ''),
    };
}

export async function loadScenePresets({ force = false } = {}) {
    if (presetCache && !force) return presetCache;
    try {
        const res = await fetch(PRESET_SCENE_PATH, { cache: force ? 'reload' : 'no-cache' });
        if (!res.ok) throw new Error(`场景预设加载失败 (${res.status})`);
        const data = await res.json();
        const scenes = Array.isArray(data?.scenes) ? data.scenes : (Array.isArray(data) ? data : []);
        presetCache = scenes.map(normalizeScenePreset);
    } catch (e) {
        console.warn('场景预设加载失败', e);
        presetCache = [];
    }
    return presetCache;
}

export function scoreScenePreset(inputTags, preset) {
    const wanted = normalizeSceneTags(inputTags);
    const tags = new Set(normalizeSceneTags(preset?.tags || []));
    if (!wanted.length || !tags.size) return 0;
    return wanted.reduce((score, tag) => score + (tags.has(tag) ? 3 : [...tags].some(item => item.includes(tag) || tag.includes(item)) ? 1 : 0), 0);
}

export function rankScenePresets(inputTags, presets = presetCache || []) {
    return presets
        .map(scene => ({ scene, score: scoreScenePreset(inputTags, scene) }))
        .sort((a, b) => b.score - a.score || a.scene.title.localeCompare(b.scene.title, 'zh-Hans'));
}

export function pickScenePresetByTags(inputTags, presets = presetCache || [], avoidIds = new Set()) {
    const ranked = rankScenePresets(inputTags, presets).filter(item => !avoidIds.has(item.scene.id));
    return (ranked.find(item => item.score > 0) || ranked[0])?.scene || null;
}

function inferSceneTags(scene) {
    const explicit = normalizeSceneTags(scene?.sceneTags || scene?.tags || scene?.background?.tags || []);
    if (explicit.length) return explicit;
    const timeline = Array.isArray(scene?.timeline) ? scene.timeline : [];
    const text = [
        scene?.title, scene?.subtitle,
        ...timeline.map(item => `${item?.text || item?.say || ''} ${item?.title || ''}`),
    ].join(' ');
    return sceneTagsFromText(text);
}

export function applyScenePreset(scene, preset, index = 0) {
    const currentBg = scene?.background || {};
    const tags = inferSceneTags(scene);
    const sourceParticles = Array.isArray(scene?.particles) && scene.particles.length
        ? scene.particles
        : (preset?.particles || (index % 3 === 0 ? ['sparkle'] : []));
    return {
        ...(scene || {}),
        sceneTags: tags.length ? tags : preset?.tags || [],
        background: {
            type: preset?.imageUrl ? 'image' : 'color',
            color: preset?.color || currentBg.color || '#bae6fd',
            imageUrl: preset?.imageUrl || currentBg.imageUrl || '',
            presetId: preset?.id || currentBg.presetId || '',
            title: preset?.title || currentBg.title || '',
            tags: preset?.tags || tags,
        },
        particles: normalizeParticleList(sourceParticles),
    };
}

export async function assignPresetScenesToStory(story, { force = false } = {}) {
    if (!story || !Array.isArray(story.scenes)) return story;
    const presets = await loadScenePresets({ force });
    if (!presets.length) return story;
    const used = new Set();
    story.scenes = story.scenes.map((scene, index) => {
        const tags = inferSceneTags(scene);
        const preset = pickScenePresetByTags(tags, presets, used) || pickScenePresetByTags(tags, presets);
        if (preset?.id) used.add(preset.id);
        return applyScenePreset(scene, preset, index);
    });
    return story;
}

export function sceneBackgroundStyle(scene = {}, fallbackColor = '#bae6fd') {
    const bg = scene.background || scene;
    const color = bg.color || scene.color || fallbackColor;
    const imageUrl = bg.imageUrl || scene.imageUrl || '';
    if (imageUrl) return `linear-gradient(rgba(255,255,255,.1),rgba(255,255,255,.1)), url("${String(imageUrl).replace(/"/g, '%22')}") center/cover no-repeat`;
    return `radial-gradient(circle at 50% 14%,rgba(255,255,255,.82),transparent 34%), linear-gradient(180deg, ${color}, #ffffff)`;
}

export function renderSceneParticles(scene = {}) {
    const effects = normalizeParticleList(scene.particles || scene.effects || []);
    if (!effects.length) return '';
    return effects.map(effect => `
        <div class="mh-scene-particles is-${escapeHtml(effect)}" aria-hidden="true">
            ${Array.from({ length: 12 }, (_, index) => `<span style="--i:${index}"></span>`).join('')}
        </div>`).join('');
}

export function sceneParticleCss() {
    return `
        .mh-scene-particles { position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:1; }
        .mh-scene-particles span { position:absolute; left:calc((var(--i) * 17%) - 8%); top:-12%; width:8px; height:8px; border-radius:999px; opacity:.72; animation:mhSceneParticleFall 5.8s linear infinite; animation-delay:calc(var(--i) * -.43s); }
        .mh-scene-particles.is-sparkle span { background:#fff7ad; box-shadow:0 0 10px rgba(255,255,255,.95); animation-name:mhSceneParticleFloat; }
        .mh-scene-particles.is-snow span { background:rgba(255,255,255,.92); width:7px; height:7px; }
        .mh-scene-particles.is-rain span { width:2px; height:18px; border-radius:999px; background:rgba(219,234,254,.72); animation-duration:1.6s; }
        .mh-scene-particles.is-mist span { width:36px; height:12px; background:rgba(255,255,255,.28); filter:blur(4px); animation-name:mhSceneParticleFloat; }
        .mh-scene-particles.is-bubbles span { width:13px; height:13px; border:2px solid rgba(255,255,255,.78); background:rgba(186,230,253,.18); animation-name:mhSceneParticleRise; top:100%; }
        .mh-scene-particles.is-petals span { width:11px; height:7px; border-radius:999px 999px 999px 2px; background:#f9a8d4; transform:rotate(25deg); }
        .mh-scene-particles.is-embers span { width:6px; height:6px; background:#fbbf24; box-shadow:0 0 8px rgba(251,191,36,.8); animation-name:mhSceneParticleRise; top:100%; }
        @keyframes mhSceneParticleFall { from { transform:translate3d(0,-14%,0); } to { transform:translate3d(28px,122%,0); } }
        @keyframes mhSceneParticleRise { from { transform:translate3d(0,12%,0) scale(.72); opacity:.2; } 45% { opacity:.75; } to { transform:translate3d(18px,-126%,0) scale(1.15); opacity:0; } }
        @keyframes mhSceneParticleFloat { from { transform:translate3d(0,14%,0) scale(.8); opacity:.2; } 50% { opacity:.82; } to { transform:translate3d(18px,92%,0) scale(1.05); opacity:.12; } }
    `;
}

export function buildSceneImagePrompt(promptText, tags = [], referenceCount = 0) {
    return [
        '为儿童向虚拟宠物互动故事生成一张 9:16 竖版背景图，只要场景背景，不要角色，不要文字，不要水印。',
        `场景描述：${promptText || '温暖的哈奇星球冒险场景'}`,
        `场景标签：${normalizeSceneTags(tags).join(', ') || 'haqi, spring, outdoor'}`,
        referenceCount ? `参考图数量：${referenceCount}。请提取构图、颜色和材质作为参考，不要复制文字或人物。` : '',
        '风格：明亮、干净、童话感、适合手机故事播放器，画面中央保留宠物角色站立空间。',
    ].filter(Boolean).join('\n');
}

export async function generateSceneBackgroundImage({ promptText = '', tags = [], referenceImages = [] } = {}) {
    if (!state.isPaid) throw new Error('只有 VIP 用户可以生成自定义背景图');
    if (!state.sdk?.aiGenerators?.genImage) throw new Error('AI 图片生成不可用');
    const images = referenceImages
        .map(url => String(url || '').trim())
        .filter(Boolean)
        .slice(0, 4)
        .map(url => ({ url, role: 'reference' }));
    return await state.sdk.aiGenerators.genImage(buildSceneImagePrompt(promptText, tags, images.length), {
        width: CONFIG.imageWidth,
        height: CONFIG.imageHeight,
        images: images.length ? images : undefined,
    });
}

function tagButtonsHtml(tags, selected) {
    const active = new Set(normalizeSceneTags(selected));
    return tags.map(tag => `<button type="button" class="${active.has(tag) ? 'is-active' : ''}" data-scene-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
}

function presetCardHtml(scene, selectedId) {
    const selected = scene.id === selectedId;
    return `
        <button type="button" class="mh-scene-preset ${selected ? 'is-selected' : ''}" data-preset-id="${escapeHtml(scene.id)}">
            <span class="mh-scene-preset-art" style="background:${escapeHtml(sceneBackgroundStyle(scene, scene.color))}">${renderSceneParticles(scene)}</span>
            <span class="mh-scene-preset-title">${escapeHtml(scene.title)}</span>
            <small>${escapeHtml(scene.tags.slice(0, 4).join(' · '))}</small>
        </button>`;
}

export async function renderStorySceneMaker(panel, data = {}, { onBack, onApplyScene } = {}) {
    let presets = await loadScenePresets();
    let query = String(data.query || '').trim();
    let selectedTags = normalizeSceneTags(data.tags || []);
    let selectedPresetId = data.scene?.background?.presetId || data.scene?.id || presets[0]?.id || '';
    let generating = false;
    let promptText = '';
    let referenceText = '';

    const currentPreset = () => presets.find(scene => scene.id === selectedPresetId) || presets[0] || null;
    const visiblePresets = () => {
        const tags = selectedTags.length ? selectedTags : sceneTagsFromText(query);
        const base = tags.length ? rankScenePresets(tags, presets).map(item => item.scene) : presets;
        if (!query) return base;
        const lower = query.toLowerCase();
        return base.filter(scene => [scene.title, scene.id, scene.tags.join(' ')].join(' ').toLowerCase().includes(lower));
    };

    const applySelected = () => {
        const preset = currentPreset();
        if (!preset) return;
        onApplyScene?.(applyScenePreset(data.scene || {}, preset));
        showToast('已应用场景', 'success', 1400);
    };

    const draw = () => {
        const visible = visiblePresets();
        const preset = currentPreset();
        panel.innerHTML = `
            <style>
                ${sceneParticleCss()}
                .mh-scene-maker-root { position:absolute; inset:0; display:flex; flex-direction:column; background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 48%,#fef3c7 100%); color:var(--text-primary); }
                .mh-scene-maker-body { flex:1; min-height:0; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
                .mh-scene-maker-search { display:flex; flex-direction:column; gap:9px; }
                .mh-scene-tag-row { display:flex; gap:7px; overflow-x:auto; padding-bottom:2px; }
                .mh-scene-tag-row button { flex:0 0 auto; border:1.5px solid rgba(14,165,233,.28); border-radius:999px; background:rgba(255,255,255,.82); color:var(--text-secondary); font-size:12px; font-weight:900; padding:6px 10px; }
                .mh-scene-tag-row button.is-active { background:var(--accent); border-color:var(--accent); color:white; }
                .mh-scene-preset-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
                .mh-scene-preset { border:1.5px solid rgba(125,211,252,.75); border-radius:14px; background:rgba(255,255,255,.9); padding:8px; display:flex; flex-direction:column; gap:6px; text-align:left; color:var(--text-primary); }
                .mh-scene-preset.is-selected { border-color:var(--accent); box-shadow:0 0 0 3px rgba(14,165,233,.16); }
                .mh-scene-preset-art { position:relative; overflow:hidden; border-radius:12px; aspect-ratio:9/13; display:block; border:2px solid rgba(255,255,255,.84); }
                .mh-scene-preset-title { font-size:13px; font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .mh-scene-preset small { color:var(--text-muted); font-size:11px; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .mh-scene-preview-card { border:1.5px solid rgba(125,211,252,.78); border-radius:16px; background:rgba(255,255,255,.9); padding:10px; display:flex; flex-direction:column; gap:9px; }
                .mh-scene-preview-art { position:relative; overflow:hidden; border-radius:14px; min-height:260px; border:2px solid rgba(255,255,255,.82); background:var(--mh-scene-preview-bg); }
                .mh-scene-preview-meta { display:flex; flex-direction:column; gap:4px; }
                .mh-scene-preview-meta strong { color:var(--text-primary); font-size:15px; }
                .mh-scene-preview-meta small { color:var(--text-secondary); font-size:12px; font-weight:800; line-height:1.4; }
                .mh-scene-generator { display:flex; flex-direction:column; gap:8px; }
                .mh-scene-generator-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
                .mh-scene-empty { border:1.5px dashed rgba(14,165,233,.38); border-radius:14px; color:var(--text-muted); background:rgba(255,255,255,.54); padding:12px; font-size:13px; line-height:1.45; }
                @media (min-width: 640px) { .mh-scene-maker-body { display:grid; grid-template-columns:minmax(0,1fr) 280px; align-items:start; } .mh-scene-preset-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
            </style>
            <div class="mh-scene-maker-root">
                <div class="topbar">
                    <button class="btn-icon" id="mhSceneMakerBack" style="width:36px;height:36px;font-size:18px">‹</button>
                    <span class="font-bold" style="color:var(--text-primary)">场景素材</span>
                    <button id="mhSceneMakerApply" class="btn-primary" style="width:64px;height:34px;padding:0 10px;border-radius:12px;font-size:13px">应用</button>
                </div>
                <div class="mh-scene-maker-body">
                    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
                        <div class="card-flat mh-scene-maker-search">
                            <input id="mhSceneSearch" class="modal-input" value="${escapeHtml(query)}" placeholder="搜索：forest, school, 海边, 浴室...">
                            <div class="mh-scene-tag-row">${tagButtonsHtml(DEFAULT_SCENE_TAGS, selectedTags)}</div>
                        </div>
                        <div class="mh-scene-preset-grid">${visible.length ? visible.map(scene => presetCardHtml(scene, selectedPresetId)).join('') : '<div class="mh-scene-empty">没有匹配的场景。</div>'}</div>
                    </div>
                    <div class="mh-scene-preview-card">
                        <div class="mh-scene-preview-art" style="--mh-scene-preview-bg:${escapeHtml(sceneBackgroundStyle(preset || {}, preset?.color || '#bae6fd'))}">${preset ? renderSceneParticles(preset) : ''}</div>
                        <div class="mh-scene-preview-meta">
                            <strong>${escapeHtml(preset?.title || '未选择场景')}</strong>
                            <small>${escapeHtml((preset?.tags || []).join(', '))}</small>
                        </div>
                        <div class="mh-scene-generator">
                            <textarea id="mhScenePrompt" class="modal-input" style="min-height:74px" placeholder="VIP 自定义背景描述，例如：冬天的哈奇学校操场，有柔软积雪和远处彩旗。">${escapeHtml(promptText)}</textarea>
                            <textarea id="mhSceneRefs" class="modal-input" style="min-height:54px" placeholder="参考图 URL，每行一个（可选）">${escapeHtml(referenceText)}</textarea>
                            <div class="mh-scene-generator-actions">
                                <button type="button" class="btn-secondary" id="mhSceneRefresh">刷新预设</button>
                                <button type="button" class="btn-primary" id="mhSceneGenerate" ${state.isPaid && !generating ? '' : 'disabled'}>${generating ? '生成中...' : state.isPaid ? 'AI 生成' : 'VIP 可生成'}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        bindEvents();
    };

    async function runGenerate() {
        if (generating) return;
        promptText = panel.querySelector('#mhScenePrompt')?.value || '';
        referenceText = panel.querySelector('#mhSceneRefs')?.value || '';
        if (!promptText.trim()) { showToast('先写一句场景描述', 'info'); return; }
        generating = true;
        draw();
        try {
            const referenceImages = referenceText.split(/\n+/).map(item => item.trim()).filter(Boolean);
            const imageUrl = await generateSceneBackgroundImage({ promptText, tags: selectedTags, referenceImages });
            const custom = normalizeScenePreset({
                id: `custom_scene_${Date.now()}`,
                title: promptText.slice(0, 24) || '自定义场景',
                imageUrl,
                color: currentPreset()?.color || '#bae6fd',
                tags: selectedTags.length ? selectedTags : sceneTagsFromText(promptText),
                particles: currentPreset()?.particles || [],
                prompt: promptText,
            });
            presets = [custom, ...presets];
            selectedPresetId = custom.id;
            showToast('场景已生成', 'success');
        } catch (e) {
            showToast('生成失败：' + (e?.message || e), 'error');
        } finally {
            generating = false;
            draw();
        }
    }

    function bindEvents() {
        panel.querySelector('#mhSceneMakerBack').onclick = () => onBack?.();
        panel.querySelector('#mhSceneMakerApply').onclick = applySelected;
        panel.querySelector('#mhSceneSearch').oninput = (e) => { query = e.target.value || ''; draw(); };
        panel.querySelector('#mhSceneRefresh').onclick = async () => { presets = await loadScenePresets({ force: true }); selectedPresetId = presets[0]?.id || ''; draw(); };
        panel.querySelector('#mhSceneGenerate').onclick = runGenerate;
        panel.querySelectorAll('[data-scene-tag]').forEach(btn => {
            btn.onclick = () => {
                const tag = normalizeTag(btn.dataset.sceneTag);
                selectedTags = selectedTags.includes(tag) ? selectedTags.filter(item => item !== tag) : [...selectedTags, tag];
                const ranked = rankScenePresets(selectedTags, presets);
                if (ranked[0]) selectedPresetId = ranked[0].scene.id;
                draw();
            };
        });
        panel.querySelectorAll('[data-preset-id]').forEach(btn => {
            btn.onclick = () => { selectedPresetId = btn.dataset.presetId; draw(); };
        });
    }

    draw();
}