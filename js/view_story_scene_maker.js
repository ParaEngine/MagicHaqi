// 故事场景创作视图：为 story maker 选择预设背景、粒子效果，或由 VIP 生成背景图。
import { escapeHtml, showToast } from './utils.js';
import { state } from './state.js';
import { CONFIG, getDefaultSceneImageSize, getSceneImageSizes } from './config.js';
import SoundManager from './soundManager.js';
import ParticleEffects, { particleEffectsCss, renderParticleCanvasHtml } from './particleEffects.js';

export const PRESET_SCENE_PATH = 'pet-story/presets/scenes.json';
export const DEFAULT_SCENE_TAGS = [
    'indoor', 'outdoor', 'land', 'sky', 'ocean', 'playground', 'bathroom', 'living room',
    'shop', 'school', 'spring', 'winter', 'seaside', 'haqi', 'townhall', 'forest', 'sand', 'hospital',
    'night', 'mountain', 'spaceship', 'castle', 'farm', 'park', 'zoo', 'underwater', 'jungle', 'candy',
];
export const SCENE_TAG_PROMPT_HINT = DEFAULT_SCENE_TAGS.join(', ');

export const SCENE_TAG_LABELS = {
    indoor: '室内',
    outdoor: '户外',
    land: '陆地',
    sky: '天空',
    ocean: '海洋',
    playground: '操场',
    bathroom: '浴室',
    'living room': '客厅',
    shop: '商店',
    school: '学校',
    spring: '春天',
    winter: '冬天',
    seaside: '海边',
    haqi: '哈奇',
    townhall: '镇大厅',
    forest: '森林',
    sand: '沙滩',
    hospital: '医院',
    night: '夜晚',
    mountain: '山地',
    spaceship: '飞船',
    castle: '城堡',
    farm: '农场',
    park: '公园',
    zoo: '动物园',
    underwater: '海底',
    jungle: '丛林',
    candy: '糖果',
};

export const PARTICLE_EFFECTS = [
    { id: 'sparkle', label: '星光' },
    { id: 'snow', label: '雪花' },
    { id: 'rain', label: '细雨' },
    { id: 'mist', label: '薄雾' },
    { id: 'bubbles', label: '泡泡' },
    { id: 'petals', label: '花瓣' },
    { id: 'embers', label: '暖光' },
];

export const BG_MUSIC_LABELS = {
    selector: '选择',
    square: '广场',
    forest: '森林',
    farm: '农场',
    mountain: '山地',
    park: '公园',
    playground: '游乐场',
    ship: '飞船',
    haqiLoop: '哈奇循环',
};

export const TAG_ALIASES = {
    indoors: 'indoor', outside: 'outdoor', outdoors: 'outdoor', sea: 'ocean', beach: 'seaside',
    room: 'living room', livingroom: 'living room', bath: 'bathroom', town: 'townhall', woods: 'forest',
    playgrounds: 'playground', clinic: 'hospital', snow: 'winter', warm: 'spring', home: 'living room',
    evening: 'night', nighttime: 'night', hills: 'mountain', hill: 'mountain', mountains: 'mountain',
    space: 'spaceship', rocket: 'spaceship', starship: 'spaceship', palace: 'castle', farms: 'farm',
    garden: 'park', animals: 'zoo', aquarium: 'underwater', undersea: 'underwater', rainforest: 'jungle',
    sweets: 'candy', dessert: 'candy',
    室内: 'indoor', 户外: 'outdoor', 室外: 'outdoor', 陆地: 'land', 天空: 'sky', 海洋: 'ocean',
    操场: 'playground', 浴室: 'bathroom', 客厅: 'living room', 商店: 'shop', 学校: 'school',
    春天: 'spring', 冬天: 'winter', 海边: 'seaside', 哈奇: 'haqi', 镇大厅: 'townhall', 森林: 'forest',
    沙滩: 'sand', 沙子: 'sand', 医院: 'hospital', 家: 'living room', 小店: 'shop', 水: 'ocean', 雪: 'winter',
    夜晚: 'night', 夜里: 'night', 晚上: 'night', 山地: 'mountain', 高山: 'mountain', 山: 'mountain',
    飞船: 'spaceship', 太空: 'spaceship', 火箭: 'spaceship', 城堡: 'castle', 宫殿: 'castle',
    农场: 'farm', 牧场: 'farm', 公园: 'park', 花园: 'park', 动物园: 'zoo', 动物: 'zoo',
    海底: 'underwater', 水下: 'underwater', 丛林: 'jungle', 雨林: 'jungle', 糖果: 'candy', 甜点: 'candy',
};

let presetCache = null;
let generationPromptsPromise = null;
const soundManager = SoundManager.getInstance();

function loadGenerationPrompts() {
    generationPromptsPromise ||= import('./generationPrompts.js');
    return generationPromptsPromise;
}

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

function parseParticleList(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[，,、\s]+/);
    return unique(raw.map(item => String(item || '').trim()).filter(Boolean));
}

function normalizeHistoryUrls(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[，,\n]+/);
    return [...new Set(raw.map(url => String(url || '').trim()).filter(Boolean))];
}

export function bgMusicOptions() {
    return Object.keys(CONFIG.assets?.bgSounds || {}).map(key => ({
        id: key,
        label: BG_MUSIC_LABELS[key] || key,
    }));
}

export function normalizeBgMusic(value) {
    if (!value) return '';
    const music = typeof value === 'object' ? (value.id || value.key || value.name || value.src || value.url || '') : value;
    return String(music || '').trim();
}

export function bgMusicLabel(value) {
    const music = normalizeBgMusic(value);
    if (!music) return '无音乐';
    return BG_MUSIC_LABELS[music] || music;
}

export function normalizeScenePreset(scene = {}, index = 0) {
    const tags = normalizeSceneTags(scene.tags || scene.sceneTags || scene.keywords || []);
    return {
        id: String(scene.id || `scene_preset_${index + 1}`),
        title: String(scene.title || scene.name || `场景 ${index + 1}`),
        imageUrl: String(scene.imageUrl || scene.url || scene.src || ''),
        historyUrls: normalizeHistoryUrls(scene.historyUrls || scene.historyUrl || scene.imageHistoryUrls || []),
        color: String(scene.color || scene.bgColor || '#bae6fd'),
        tags,
        particles: parseParticleList(scene.particles || scene.effects || []),
        bgMusic: normalizeBgMusic(scene.bgMusic || scene.music || scene.bgm || scene.background?.bgMusic),
        prompt: String(scene.prompt || scene.description || ''),
    };
}

export async function loadScenePresets({ force = false } = {}) {
    if (presetCache && !force) return presetCache;
    const fromDevTool = /(^|\/)dev_tools\//.test(window.location.pathname || '');
    const url = fromDevTool ? `../${PRESET_SCENE_PATH}` : PRESET_SCENE_PATH;
    try {
        const res = await fetch(url, { cache: force ? 'reload' : 'no-cache' });
        if (!res.ok) throw new Error(`场景预设加载失败 (${res.status})`);
        const data = await res.json();
        const scenes = Array.isArray(data?.scenes) ? data.scenes : (Array.isArray(data) ? data : []);
        presetCache = scenes.map(normalizeScenePreset);
        return presetCache;
    } catch (e) {
        console.warn('场景预设加载失败', e);
    }
    presetCache = [];
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
        particles: parseParticleList(sourceParticles),
        bgMusic: normalizeBgMusic(scene?.bgMusic || scene?.background?.bgMusic || preset?.bgMusic),
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
    const base = /gradient\s*\(/i.test(color) ? color : `linear-gradient(180deg, ${color}, #ffffff)`;
    return `radial-gradient(circle at 50% 14%,rgba(255,255,255,.82),transparent 34%), ${base}`;
}

export function sceneBackgroundPlaceholderStyle(scene = {}, fallbackColor = '#bae6fd') {
    const bg = scene.background || scene;
    const color = bg.color || scene.color || fallbackColor;
    const base = /gradient\s*\(/i.test(color) ? color : `linear-gradient(180deg, ${color}, #ffffff)`;
    return `radial-gradient(circle at 50% 14%,rgba(255,255,255,.82),transparent 34%), ${base}`;
}

export function lazySceneBackgroundAttrs(scene = {}, fallbackColor = '#bae6fd') {
    const bg = scene.background || scene;
    const imageUrl = bg.imageUrl || scene.imageUrl || '';
    const style = imageUrl ? sceneBackgroundPlaceholderStyle(scene, fallbackColor) : sceneBackgroundStyle(scene, fallbackColor);
    const lazyStyle = imageUrl ? ` data-mh-scene-bg-style="${escapeHtml(sceneBackgroundStyle(scene, fallbackColor))}"` : '';
    return `style="background:${escapeHtml(style)}"${lazyStyle}`;
}

export function setupLazySceneBackgrounds(root) {
    const scope = root || document;
    const targets = [...scope.querySelectorAll('[data-mh-scene-bg-style]')]
        .filter(el => el.dataset.mhSceneBgLoaded !== '1');
    if (!targets.length) return;

    const load = (el) => {
        if (!el || el.dataset.mhSceneBgLoaded === '1') return;
        const style = el.dataset.mhSceneBgStyle || '';
        if (!style) return;
        el.style.background = style;
        el.dataset.mhSceneBgLoaded = '1';
        el.removeAttribute('data-mh-scene-bg-style');
    };

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
                load(entry.target);
                obs.unobserve(entry.target);
            });
        }, { root: null, rootMargin: '0px', threshold: 0.01 });
        targets.forEach(el => observer.observe(el));
        return;
    }

    const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const width = window.innerWidth || document.documentElement?.clientWidth || 0;
        const height = window.innerHeight || document.documentElement?.clientHeight || 0;
        return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
    };
    const check = () => {
        targets.forEach(el => { if (isVisible(el)) load(el); });
        if (targets.every(el => el.dataset.mhSceneBgLoaded === '1')) {
            window.removeEventListener('scroll', check, true);
            window.removeEventListener('resize', check);
        }
    };
    window.addEventListener('scroll', check, true);
    window.addEventListener('resize', check);
    requestAnimationFrame(check);
}

export function renderSceneParticles(scene = {}, { density = 'scene' } = {}) {
    const effects = parseParticleList(scene.particles || scene.effects || []);
    return renderParticleCanvasHtml(effects, { density, seed: `${scene?.id || scene?.background?.presetId || scene?.background?.title || effects.join('-')}` });
}

export function sceneParticleCss() {
    return particleEffectsCss();
}

export async function buildSceneImagePrompt(promptText, tags = [], referenceCount = 0) {
    const { buildSceneImagePrompt: buildSceneImagePromptBase } = await loadGenerationPrompts();
    return buildSceneImagePromptBase(promptText, tags, referenceCount, { normalizeTags: normalizeSceneTags });
}

export async function generateSceneBackgroundImage({ promptText = '', tags = [], referenceImages = [], imageSize = '' } = {}) {
    if (!state.isPaid) throw new Error('只有 VIP 用户可以生成自定义背景图');
    if (!state.sdk?.aiGenerators?.genImage) throw new Error('AI 图片生成不可用');
    const images = referenceImages
        .map(url => String(url || '').trim())
        .filter(Boolean)
        .slice(0, 4)
        .map(url => ({ url, role: 'reference' }));
    const { width, height } = getDefaultSceneImageSize(CONFIG, imageSize);
    const prompt = await buildSceneImagePrompt(promptText, tags, images.length);
    return await state.sdk.aiGenerators.genImage(prompt, {
        width,
        height,
        images: images.length ? images : undefined,
    });
}

function tagButtonsHtml(tags, selected) {
    const active = new Set(normalizeSceneTags(selected));
    return tags.map(tag => `<button type="button" class="${active.has(tag) ? 'is-active' : ''}" data-scene-tag="${escapeHtml(tag)}">${escapeHtml(SCENE_TAG_LABELS[tag] || tag)}</button>`).join('');
}

function presetCardHtml(scene, selectedId) {
    const selected = scene.id === selectedId;
    return `
        <button type="button" class="mh-scene-preset ${selected ? 'is-selected' : ''}" data-preset-id="${escapeHtml(scene.id)}">
            <span class="mh-scene-preset-art" ${lazySceneBackgroundAttrs(scene, scene.color)}>${renderSceneParticles(scene, { density: 'thumbnail' })}</span>
            <span class="mh-scene-preset-title">${escapeHtml(scene.title)}</span>
            <small>${escapeHtml(scene.tags.slice(0, 4).join(' · '))}</small>
        </button>`;
}

export async function renderStorySceneMaker(panel, data = {}, { onBack, onApplyScene } = {}) {
    let presets = await loadScenePresets();
    let query = String(data.query || '').trim();
    let draftScene = normalizeEditableScene(data.scene || {}, presets[0]);
    let filterTags = normalizeSceneTags(draftScene.sceneTags || draftScene.background?.tags || [])
        .filter(tag => DEFAULT_SCENE_TAGS.includes(tag));
    let selectedPresetId = draftScene.background?.presetId || data.scene?.id || presets[0]?.id || '';
    let activeTool = 'image';
    let imageMode = 'presets';
    let generating = false;
    let promptText = '';
    let referenceText = '';
    let selectedImageSize = getDefaultSceneImageSize(CONFIG).value;

    const currentPreset = () => presets.find(scene => scene.id === selectedPresetId) || presets[0] || null;
    const visiblePresets = () => {
        const tags = filterTags.length ? filterTags : sceneTagsFromText(query);
        const base = tags.length ? rankScenePresets(tags, presets).filter(item => item.score > 0).map(item => item.scene) : presets;
        if (!query) return base;
        const lower = query.toLowerCase();
        return base.filter(scene => [scene.title, scene.id, scene.tags.join(' ')].join(' ').toLowerCase().includes(lower));
    };

    function normalizeEditableScene(scene = {}, fallbackPreset = null) {
        const bg = scene.background || {};
        const fallbackColor = bg.color || scene.bgColor || fallbackPreset?.color || '#bae6fd';
        const imageUrl = bg.imageUrl || scene.imageUrl || '';
        return {
            ...(scene || {}),
            sceneTags: normalizeSceneTags(scene.sceneTags || scene.tags || bg.tags || fallbackPreset?.tags || []),
            background: {
                type: imageUrl ? 'image' : 'color',
                color: fallbackColor,
                imageUrl,
                presetId: bg.presetId || '',
                title: bg.title || '',
                tags: normalizeSceneTags(bg.tags || scene.sceneTags || fallbackPreset?.tags || []),
            },
            particles: parseParticleList(scene.particles || scene.effects || []),
            bgMusic: normalizeBgMusic(scene.bgMusic || bg.bgMusic || fallbackPreset?.bgMusic || ''),
        };
    }

    function setDraftScene(nextScene) {
        draftScene = normalizeEditableScene(nextScene || draftScene, currentPreset());
    }

    function sceneForPreview() {
        return {
            ...draftScene,
            effects: draftScene.particles,
        };
    }

    const applySelected = () => {
        onApplyScene?.({
            ...draftScene,
            sceneTags: draftScene.sceneTags || [],
            background: {
                ...draftScene.background,
                bgMusic: draftScene.bgMusic || '',
            },
        });
        showToast('已应用场景', 'success', 1400);
    };

    function applyPresetToDraft(preset) {
        if (!preset) return;
        const previousMusic = draftScene.bgMusic;
        const nextScene = applyScenePreset(draftScene, preset);
        setDraftScene({
            ...nextScene,
            bgMusic: previousMusic || nextScene.bgMusic || '',
        });
        selectedPresetId = preset.id;
    }

    function toolButtonHtml(id, label) {
        return `<button type="button" class="${activeTool === id ? 'is-active' : ''}" data-scene-tool="${id}">${label}</button>`;
    }

    function imageModeButtonHtml(id, label) {
        return `<button type="button" class="${imageMode === id ? 'is-active' : ''}" data-image-mode="${id}">${label}</button>`;
    }

    function particleButtonHtml(effect) {
        const active = draftScene.particles.includes(effect.id);
        return `<button type="button" class="${active ? 'is-active' : ''}" data-particle-id="${escapeHtml(effect.id)}">${escapeHtml(effect.label)}</button>`;
    }

    function musicButtonHtml(option) {
        const active = draftScene.bgMusic === option.id;
        return `<button type="button" class="${active ? 'is-active' : ''}" data-bg-music="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>`;
    }

    function musicToggleButtonHtml(track) {
        if (!track) return '';
        const muted = soundManager.isBgMusicMuted?.();
        return `<button type="button" class="mh-scene-music-toggle ${muted ? 'is-muted' : ''}" data-scene-music-toggle aria-label="${muted ? '开启音乐' : '静音'}" title="${muted ? '开启音乐' : '静音'}">${muted ? '♪' : '♫'}</button>`;
    }

    function imageSizeOptionsHtml() {
        return getSceneImageSizes(CONFIG).map(option => `<option value="${escapeHtml(option.value)}" ${option.value === selectedImageSize ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
    }

    function toolPanelHtml(visible) {
        if (activeTool === 'color') {
            const color = draftScene.background?.color || '#bae6fd';
            const swatches = ['#bae6fd', '#fef3c7', '#bbf7d0', '#fde68a', '#f9a8d4', '#c4b5fd', '#fed7aa', '#e0f2fe'];
            return `
                <div class="mh-scene-tool-panel">
                    <label class="mh-scene-tool-row"><span>背景色</span><input id="mhSceneBgColor" type="color" value="${escapeHtml(color)}"></label>
                    <div class="mh-scene-chip-grid">${swatches.map(item => `<button type="button" class="mh-color-chip ${item.toLowerCase() === color.toLowerCase() ? 'is-active' : ''}" style="--chip:${escapeHtml(item)}" data-bg-color="${escapeHtml(item)}"></button>`).join('')}</div>
                </div>`;
        }
        if (activeTool === 'particles') {
            return `
                <div class="mh-scene-tool-panel">
                    <div class="mh-scene-chip-grid">${PARTICLE_EFFECTS.map(particleButtonHtml).join('')}</div>
                    <button type="button" class="btn-secondary" id="mhSceneClearParticles">清空粒子</button>
                </div>`;
        }
        if (activeTool === 'music') {
            const options = bgMusicOptions();
            return `
                <div class="mh-scene-tool-panel">
                    <div class="mh-scene-chip-grid">
                        <button type="button" class="${draftScene.bgMusic ? '' : 'is-active'}" data-bg-music="">无音乐</button>
                        ${options.map(musicButtonHtml).join('')}
                    </div>
                </div>`;
        }
        const imageTools = imageMode === 'generate'
            ? `
                <div class="mh-scene-generator">
                    <textarea id="mhScenePrompt" class="modal-input" placeholder="冬天的哈奇学校操场，有柔软积雪和远处彩旗。">${escapeHtml(promptText)}</textarea>
                    <textarea id="mhSceneRefs" class="modal-input" placeholder="参考图 URL，每行一个（可选）">${escapeHtml(referenceText)}</textarea>
                    <label class="mh-scene-tool-row"><span>尺寸</span><select id="mhSceneImageSize" class="modal-input">${imageSizeOptionsHtml()}</select></label>
                    <button type="button" class="btn-primary" id="mhSceneGenerate" ${state.isPaid && !generating ? '' : 'disabled'}>${generating ? '生成中...' : state.isPaid ? 'AI 生成背景' : 'VIP 可生成'}</button>
                </div>`
            : `
                <div class="mh-scene-maker-search">
                    <div class="mh-scene-search-box">
                        <input id="mhSceneSearch" class="modal-input" value="${escapeHtml(query)}" placeholder="搜索：forest, school, 海边, 浴室...">
                        <button type="button" id="mhSceneSearchClear" class="mh-scene-search-clear ${query ? '' : 'is-hidden'}">清空</button>
                    </div>
                    <div class="mh-scene-tag-row">${tagButtonsHtml(DEFAULT_SCENE_TAGS, filterTags)}</div>
                </div>
                <div class="mh-scene-preset-scroll">
                    <div class="mh-scene-preset-grid">${visible.length ? visible.map(scene => presetCardHtml(scene, selectedPresetId)).join('') : '<div class="mh-scene-empty">没有匹配的场景。</div>'}</div>
                </div>`;
        return `
            <div class="mh-scene-tool-panel">
                <div class="mh-scene-mode-row">
                    ${imageModeButtonHtml('presets', '选择预设')}
                    ${imageModeButtonHtml('generate', 'AI 生成')}
                </div>
                ${imageTools}
            </div>`;
    }

    const draw = () => {
        const visible = visiblePresets();
        const previewScene = sceneForPreview();
        const bg = draftScene.background || {};
        const imageName = bg.imageUrl ? (bg.title || bg.presetId || '自定义图片') : '无图片';
        const particlesText = draftScene.particles.length ? draftScene.particles.map(id => PARTICLE_EFFECTS.find(item => item.id === id)?.label || id).join('、') : '无粒子';
        panel.innerHTML = `
            <style>
                ${sceneParticleCss()}
                .mh-scene-maker-root { position:absolute; inset:0; display:flex; flex-direction:column; background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 48%,#fef3c7 100%); color:var(--text-primary); }
                .mh-scene-maker-body { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:14px; display:flex; flex-direction:column; gap:12px; }
                .mh-scene-maker-search { display:flex; flex-direction:column; gap:9px; }
                .mh-scene-search-box { position:relative; display:flex; align-items:center; }
                .mh-scene-search-box .modal-input { padding-right:66px; }
                .mh-scene-search-clear { position:absolute; right:5px; top:5px; bottom:5px; min-width:54px; border:1.5px solid rgba(14,165,233,.32); border-radius:10px; background:rgba(255,255,255,.9); color:var(--accent-dark); font-size:13px; font-weight:900; }
                .mh-scene-search-clear.is-hidden { display:none; }
                .mh-scene-tag-row { display:flex; gap:7px; overflow-x:auto; padding-bottom:2px; }
                .mh-scene-tag-row button { flex:0 0 auto; border:1.5px solid rgba(14,165,233,.28); border-radius:999px; background:rgba(255,255,255,.82); color:var(--text-secondary); font-size:12px; font-weight:900; padding:6px 10px; }
                .mh-scene-tag-row button.is-active { background:var(--accent); border-color:var(--accent); color:white; }
                .mh-scene-preset-scroll { height:70dvh; min-height:70dvh; overflow-y:auto; overscroll-behavior:contain; padding:2px 3px 3px 0; }
                .mh-scene-preset-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; align-content:start; align-items:start; }
                .mh-scene-preset { border:1.5px solid rgba(125,211,252,.75); border-radius:14px; background:rgba(255,255,255,.9); padding:8px; display:flex; flex-direction:column; gap:6px; text-align:left; color:var(--text-primary); }
                .mh-scene-preset.is-selected { border-color:var(--accent); box-shadow:0 0 0 3px rgba(14,165,233,.16); }
                .mh-scene-preset-art { position:relative; overflow:hidden; border-radius:12px; aspect-ratio:1/1; display:block; border:2px solid rgba(255,255,255,.84); }
                .mh-scene-preset-title { font-size:13px; font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .mh-scene-preset small { color:var(--text-muted); font-size:11px; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .mh-scene-preview-card { border:1.5px solid rgba(125,211,252,.78); border-radius:16px; background:rgba(255,255,255,.9); padding:10px; display:flex; flex-direction:column; gap:9px; }
                .mh-scene-preview-art { position:relative; overflow:hidden; border-radius:14px; min-height:260px; border:2px solid rgba(255,255,255,.82); background:var(--mh-scene-preview-bg); background-size:cover; background-position:center; }
                .mh-scene-music-toggle { position:absolute; top:8px; right:8px; z-index:5; width:34px; height:34px; border-radius:11px; border:2px solid rgba(255,255,255,.92); background:rgba(14,165,233,.92); color:white; font-size:18px; font-weight:900; line-height:1; display:grid; place-items:center; box-shadow:0 4px 0 rgba(37,99,235,.34),0 8px 18px rgba(15,39,71,.16); }
                .mh-scene-music-toggle.is-muted { background:rgba(255,255,255,.92); color:var(--accent-dark); }
                .mh-scene-preview-meta { display:flex; flex-direction:column; gap:4px; }
                .mh-scene-preview-meta strong { color:var(--text-primary); font-size:15px; }
                .mh-scene-preview-meta small { color:var(--text-secondary); font-size:12px; font-weight:800; line-height:1.4; }
                .mh-scene-status-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
                .mh-scene-status-grid span { border-radius:12px; background:#effaff; color:var(--text-secondary); font-size:12px; font-weight:900; padding:7px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .mh-scene-tool-tabs, .mh-scene-mode-row, .mh-scene-chip-grid { display:grid; gap:8px; }
                .mh-scene-tool-tabs { grid-template-columns:repeat(4,minmax(0,1fr)); }
                .mh-scene-mode-row { grid-template-columns:1fr 1fr; }
                .mh-scene-tool-tabs button, .mh-scene-mode-row button, .mh-scene-chip-grid button { border:1.5px solid rgba(14,165,233,.32); border-radius:12px; background:rgba(255,255,255,.86); color:var(--text-secondary); min-height:38px; padding:7px 8px; font-size:12px; font-weight:900; }
                .mh-scene-tool-tabs button.is-active, .mh-scene-mode-row button.is-active, .mh-scene-chip-grid button.is-active { background:var(--accent); border-color:var(--accent); color:white; }
                .mh-scene-tool-panel { border:1.5px solid rgba(125,211,252,.55); border-radius:14px; background:rgba(255,255,255,.74); padding:10px; display:flex; flex-direction:column; gap:10px; min-height:0; }
                .mh-scene-tool-row { display:grid; grid-template-columns:72px minmax(0,1fr); gap:10px; align-items:center; color:var(--text-secondary); font-size:13px; font-weight:900; }
                .mh-scene-tool-row input[type="color"] { width:100%; height:42px; border:1.5px solid rgba(14,165,233,.28); border-radius:12px; background:white; padding:4px; }
                .mh-scene-chip-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
                .mh-color-chip { min-height:42px; background:var(--chip) !important; color:transparent !important; }
                .mh-scene-generator { display:flex; flex-direction:column; gap:8px; }
                .mh-scene-generator textarea:first-child { min-height:82px; }
                .mh-scene-generator textarea:nth-child(2) { min-height:58px; }
                .mh-scene-empty { border:1.5px dashed rgba(14,165,233,.38); border-radius:14px; color:var(--text-muted); background:rgba(255,255,255,.54); padding:12px; font-size:13px; line-height:1.45; }
                @media (min-width: 640px) { .mh-scene-maker-body { display:grid; grid-template-columns:320px minmax(0,1fr); align-items:start; } .mh-scene-preset-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .mh-scene-chip-grid { grid-template-columns:repeat(4,minmax(0,1fr)); } }
            </style>
            <div class="mh-scene-maker-root">
                <div class="topbar">
                    <button class="btn-icon" id="mhSceneMakerBack" style="width:36px;height:36px;font-size:18px">‹</button>
                    <span class="font-bold" style="color:var(--text-primary)">场景设置</span>
                    <button id="mhSceneMakerApply" class="btn-primary" style="width:64px;height:34px;padding:0 10px;border-radius:12px;font-size:13px">应用</button>
                </div>
                <div class="mh-scene-maker-body">
                    <div class="mh-scene-preview-card">
                        <div class="mh-scene-preview-art" style="--mh-scene-preview-bg:${escapeHtml(sceneBackgroundStyle(previewScene, bg.color || '#bae6fd'))}">${renderSceneParticles(previewScene)}${musicToggleButtonHtml(draftScene.bgMusic)}</div>
                        <div class="mh-scene-preview-meta">
                            <strong>${escapeHtml(bg.title || '当前场景')}</strong>
                        </div>
                        <div class="mh-scene-status-grid">
                            <span>图片：${escapeHtml(imageName)}</span>
                            <span>颜色：${escapeHtml(bg.color || '#bae6fd')}</span>
                            <span>粒子：${escapeHtml(particlesText)}</span>
                            <span>音乐：${escapeHtml(bgMusicLabel(draftScene.bgMusic))}</span>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
                        <div class="mh-scene-tool-tabs">
                            ${toolButtonHtml('image', '图片')}
                            ${toolButtonHtml('color', '颜色')}
                            ${toolButtonHtml('particles', '粒子')}
                            ${toolButtonHtml('music', '音乐')}
                        </div>
                        ${toolPanelHtml(visible)}
                    </div>
                </div>
            </div>`;
        ParticleEffects.getInstance().mountAll(panel);
        setupLazySceneBackgrounds(panel);
        bindEvents();
    };

    async function runGenerate() {
        if (generating) return;
        promptText = panel.querySelector('#mhScenePrompt')?.value || '';
        referenceText = panel.querySelector('#mhSceneRefs')?.value || '';
        selectedImageSize = panel.querySelector('#mhSceneImageSize')?.value || selectedImageSize;
        if (!promptText.trim()) { showToast('先写一句场景描述', 'info'); return; }
        generating = true;
        draw();
        try {
            const referenceImages = referenceText.split(/\n+/).map(item => item.trim()).filter(Boolean);
            const imageUrl = await generateSceneBackgroundImage({ promptText, tags: filterTags, referenceImages, imageSize: selectedImageSize });
            const custom = normalizeScenePreset({
                id: `custom_scene_${Date.now()}`,
                title: promptText.slice(0, 24) || '自定义场景',
                imageUrl,
                color: draftScene.background?.color || currentPreset()?.color || '#bae6fd',
                tags: filterTags.length ? filterTags : sceneTagsFromText(promptText),
                particles: currentPreset()?.particles || [],
                prompt: promptText,
            });
            presets = [custom, ...presets];
            selectedPresetId = custom.id;
            applyPresetToDraft(custom);
            showToast('场景已生成', 'success');
        } catch (e) {
            showToast('生成失败：' + (e?.message || e), 'error');
        } finally {
            generating = false;
            draw();
        }
    }

    function refreshPresetList() {
        const grid = panel.querySelector('.mh-scene-preset-grid');
        if (!grid) return;
        const visible = visiblePresets();
        grid.innerHTML = visible.length ? visible.map(scene => presetCardHtml(scene, selectedPresetId)).join('') : '<div class="mh-scene-empty">没有匹配的场景。</div>';
        setupLazySceneBackgrounds(grid);
        bindPresetEvents();
    }

    function syncTagButtons() {
        const active = new Set(normalizeSceneTags(filterTags));
        panel.querySelectorAll('[data-scene-tag]').forEach(btn => {
            btn.classList.toggle('is-active', active.has(normalizeTag(btn.dataset.sceneTag)));
        });
    }

    function syncSearchClearButton() {
        panel.querySelector('#mhSceneSearchClear')?.classList.toggle('is-hidden', !query && !filterTags.length);
    }

    function bindPresetEvents() {
        panel.querySelectorAll('[data-preset-id]').forEach(btn => {
            btn.onclick = () => {
                selectedPresetId = btn.dataset.presetId;
                applyPresetToDraft(currentPreset());
                draw();
            };
        });
    }

    function bindEvents() {
        panel.querySelector('#mhSceneMakerBack').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            onBack?.();
        };
        panel.querySelector('#mhSceneMakerApply').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            applySelected();
        };
        panel.querySelector('[data-scene-music-toggle]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!draftScene.bgMusic) return;
            const muted = soundManager.toggleBgMusicMuted?.({ fadeMs: 220 });
            if (!muted) soundManager.playBgMusic(draftScene.bgMusic, { fadeMs: 260, volume: 0.3 });
            draw();
        });
        panel.querySelectorAll('[data-scene-tool]').forEach(btn => {
            btn.onclick = () => { activeTool = btn.dataset.sceneTool || 'image'; draw(); };
        });
        panel.querySelectorAll('[data-image-mode]').forEach(btn => {
            btn.onclick = () => { imageMode = btn.dataset.imageMode || 'presets'; activeTool = 'image'; draw(); };
        });
        const search = panel.querySelector('#mhSceneSearch');
        if (search) search.oninput = (e) => {
            query = e.target.value || '';
            syncSearchClearButton();
            refreshPresetList();
        };
        panel.querySelector('#mhSceneSearchClear')?.addEventListener('click', () => {
            query = '';
            filterTags = [];
            if (search) search.value = '';
            syncSearchClearButton();
            syncTagButtons();
            refreshPresetList();
            search?.focus();
        });
        const generateButton = panel.querySelector('#mhSceneGenerate');
        if (generateButton) generateButton.onclick = runGenerate;
        const imageSizeSelect = panel.querySelector('#mhSceneImageSize');
        if (imageSizeSelect) imageSizeSelect.onchange = (e) => { selectedImageSize = e.target.value || selectedImageSize; };
        const colorInput = panel.querySelector('#mhSceneBgColor');
        if (colorInput) colorInput.oninput = (e) => {
            draftScene.background = { ...(draftScene.background || {}), color: e.target.value || '#bae6fd' };
            draw();
        };
        panel.querySelectorAll('[data-bg-color]').forEach(btn => {
            btn.onclick = () => {
                draftScene.background = { ...(draftScene.background || {}), color: btn.dataset.bgColor || '#bae6fd' };
                draw();
            };
        });
        panel.querySelector('#mhSceneClearParticles')?.addEventListener('click', () => {
            draftScene.particles = [];
            draw();
        });
        panel.querySelectorAll('[data-particle-id]').forEach(btn => {
            btn.onclick = () => {
                const id = btn.dataset.particleId || '';
                draftScene.particles = draftScene.particles.includes(id)
                    ? draftScene.particles.filter(item => item !== id)
                    : [...draftScene.particles, id];
                draw();
            };
        });
        panel.querySelectorAll('[data-bg-music]').forEach(btn => {
            btn.onclick = () => {
                draftScene.bgMusic = normalizeBgMusic(btn.dataset.bgMusic || '');
                draftScene.background = { ...(draftScene.background || {}), bgMusic: draftScene.bgMusic };
                if (draftScene.bgMusic) {
                    soundManager.setBgMusicMuted?.(false, { fadeMs: 120 });
                    soundManager.playBgMusic(draftScene.bgMusic, { fadeMs: 320, volume: 0.3, restart: true });
                } else {
                    soundManager.stopBgMusic({ fadeMs: 320 });
                }
                draw();
            };
        });
        panel.querySelectorAll('[data-scene-tag]').forEach(btn => {
            btn.onclick = () => {
                const tag = normalizeTag(btn.dataset.sceneTag);
                filterTags = filterTags.length === 1 && filterTags[0] === tag ? [] : [tag];
                const ranked = rankScenePresets(filterTags, presets).filter(item => item.score > 0);
                if (ranked[0]) selectedPresetId = ranked[0].scene.id;
                syncTagButtons();
                syncSearchClearButton();
                refreshPresetList();
            };
        });
        bindPresetEvents();
    }

    draw();
}