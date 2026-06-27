// 故事创作视图：移动端优先的轻量 AI story JSON maker。
import { $, confirm as confirmDialog, dockDisabledAttrs, escapeHtml, isDockButtonDisabled, showDockDisabledToast, showToast } from './utils.js';
import { t, getLang } from './i18n.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { petArtHtml, scanAndMount } from './pet.js';
import { displayPetName } from './dna.js';
import { loadPet, saveWorkspaceStory } from './storage.js';
import { renderPetList } from './view_petList.js';
import { assignPresetScenesToStory, renderSceneParticles, renderStorySceneMaker, sceneParticleCss, SCENE_TAG_PROMPT_HINT } from './view_story_scene_maker.js';
import { buildStoryPrompt } from './generationPrompts.js';
import { loadMinigameIndex } from './view_minigames.js';
import SoundManager from './soundManager.js';
import ParticleEffects from './particleEffects.js';

const DEFAULT_SCENE_COUNT = 5;
const SCENE_BG_COLORS = ['#bae6fd', '#fde68a', '#bbf7d0', '#fecdd3', '#ddd6fe', '#fed7aa', '#ccfbf1', '#e0e7ff'];
const ACTIVITY_TYPES = [
    { value: 'feed', get label() { return t('mkFeed'); } },
    { value: 'bath', get label() { return t('mkBath'); } },
    { value: 'tap', get label() { return t('mkTap'); } },
    { value: 'minigame', get label() { return t('mkMinigame'); } },
];
// 小游戏清单以 minigames/_minigame_index.json 为唯一数据源，按需加载一次后缓存（复用 view_minigames 的加载函数）。
// 标题优先走 i18n（mg_<id>），未命中时回退到索引里的 title。
const DEFAULT_MINIGAME_ID = 'pet_tower_defense';
let MINIGAMES = [];

function minigameTitle(id, fallback = '') {
    const key = 'mg_' + id;
    const localized = t(key);
    return localized !== key ? localized : (fallback || id);
}

async function ensureMinigamesLoaded() {
    if (MINIGAMES.length) return MINIGAMES;
    const list = await loadMinigameIndex().catch(() => []);
    MINIGAMES = (Array.isArray(list) ? list : []).map(item => {
        const id = item?.id;
        const fallback = item?.title || id;
        return { id, get title() { return minigameTitle(id, fallback); } };
    });
    return MINIGAMES;
}
const REVIEW_LINE_REVEAL_MS = 38;
const soundManager = SoundManager.getInstance();
let activeStoryMakerCleanup = null;

export function disposeStoryMaker() {
    if (activeStoryMakerCleanup) activeStoryMakerCleanup();
    activeStoryMakerCleanup = null;
}

function sceneBg(index = 0, value = null) {
    const color = typeof value === 'string' && value ? value : SCENE_BG_COLORS[index % SCENE_BG_COLORS.length];
    if (value && typeof value === 'object') {
        return { type: value.type || 'color', color: value.color || color, imageUrl: value.imageUrl || '' };
    }
    return { type: 'color', color, imageUrl: '' };
}

function normalizeActivity(activity = {}) {
    const rawType = String(activity.type || '').trim().toLowerCase();
    const type = rawType === 'clean' ? 'bath' : ['feed', 'bath', 'tap', 'minigame'].includes(rawType) ? rawType : 'tap';
    const def = ACTIVITY_TYPES.find(item => item.value === type) || ACTIVITY_TYPES[2];
    const gameId = activity.gameId || DEFAULT_MINIGAME_ID;
    const game = MINIGAMES.find(item => item.id === gameId);
    const target = String(activity.target || activity.actor || activity.actorId || '').trim();
    const result = {
        kind: 'activity',
        type: def.value,
        title: activity.title || (def.value === 'minigame' ? game?.title : def.label) || t('mkDefaultActivity'),
        count: Math.max(1, Number(activity.count ?? activity.times ?? 1) || 1),
        successText: activity.successText || '',
    };
    if (def.value !== 'minigame' && target) result.target = target;
    if (def.value === 'minigame') {
        result.gameId = gameId;
        result.gameTitle = activity.gameTitle || game?.title || result.title;
    }
    return result;
}

function sceneTimeline(scene = {}) {
    const legacySubtitle = (scene.subtitle || '').trim();
    const legacySubtitleLine = legacySubtitle ? [{ kind: 'line', actor: '$narrator', text: legacySubtitle }] : [];
    if (Array.isArray(scene.timeline) && scene.timeline.length) {
        const timeline = scene.timeline.map(item => item?.kind === 'activity'
            ? normalizeActivity(item)
            : { kind: 'line', actor: item?.actor || '$selected', text: item?.text || item?.say || '' });
        if (legacySubtitle && !timeline.some(item => item.kind === 'line' && item.actor === '$narrator' && (item.text || '').trim() === legacySubtitle)) {
            return [...legacySubtitleLine, ...timeline];
        }
        return timeline;
    }
    return [
        ...legacySubtitleLine,
        ...(Array.isArray(scene.lines) ? scene.lines.map(line => ({ kind: 'line', actor: line.actor || '$selected', text: line.text || line.say || '' })) : []),
        ...(Array.isArray(scene.activities) ? scene.activities.map(activity => normalizeActivity(activity)) : []),
    ];
}

function sceneFromTimeline(scene, index) {
    const timeline = sceneTimeline(scene).filter(item => item.kind === 'activity' || (item.text || '').trim());
    return {
        id: scene?.id || `scene_${index + 1}`,
        subtitle: '',
        sceneTags: Array.isArray(scene?.sceneTags) ? scene.sceneTags : (Array.isArray(scene?.tags) ? scene.tags : []),
        background: sceneBg(index, scene?.background || scene?.bgColor),
        particles: Array.isArray(scene?.particles) ? scene.particles : [],
        bgMusic: scene?.bgMusic || scene?.background?.bgMusic || '',
        timeline,
        lines: timeline.filter(item => item.kind === 'line').map(({ actor, text }) => ({ actor, text })),
        activities: timeline.filter(item => item.kind === 'activity').map(item => {
            const { kind, ...activity } = item;
            return activity;
        }),
        nextSceneId: scene?.nextSceneId || undefined,
    };
}

function petListRecords() {
    return (state.petOrder || []).map(id => state.pets?.[id] || { id, lazyPetRecord: true });
}

function actorFromPet(pet, selectable = false) {
    return {
        id: `actor_${pet.id}`,
        name: displayPetName(pet),
        sourcePetId: pet.id,
        allowUserSelection: !!selectable,
        petTemplate: {
            id: pet.id,
            name: pet.name,
            dna: pet.dna,
            imageSheetUrl: pet.imageSheetUrl || '',
            traits: pet.traits || {},
            stage: pet.stage || 'adult',
        },
    };
}

function fallbackStory(promptText, count, actors) {
    const mainActor = actors.find(actor => actor.isMainActor) || actors[0];
    const partner = actors.find(actor => actor.id !== mainActor?.id) || mainActor;
    const scenes = Array.from({ length: count }, (_, index) => ({
        id: `scene_${index + 1}`,
        subtitle: '',
        background: sceneBg(index),
        timeline: [
            { kind: 'line', actor: '$narrator', text: index === 0 ? t('mkStoryStart') : t('mkSceneAdvance', { n: index + 1 }) },
            { kind: 'line', actor: mainActor?.id || '$selected', text: index === 0 ? (promptText || '我们一起出发吧。') : '我会勇敢一点。' },
            index % 2 === 0
                ? normalizeActivity({ type: 'tap', title: '轻拍鼓励', count: 3, successText: '谢谢你陪着我。' })
                : normalizeActivity({ type: 'feed', title: '喂养', count: 2, successText: '又有力气啦！' }),
            { kind: 'line', actor: partner?.id || '$selected', text: '我陪着你。' },
        ],
    }));
    scenes.forEach((scene, index) => Object.assign(scene, sceneFromTimeline(scene, index)));
    return {
        id: `story_${Date.now()}`,
        title: promptText ? promptText.slice(0, 18) : t('mkDefaultTitle'),
        version: 1,
        selectionPrompt: t('mkSelectMainActor'),
        actors,
        startSceneId: scenes[0]?.id || 'scene_1',
        scenes,
        ending: { subtitle: t('mkEndingSubtitle'), text: t('mkEndingText') },
    };
}

function extractJson(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch (_) { return null; }
}

function actorMatchKey(value) {
    return String(value || '').trim().toLowerCase();
}

function petIdFromActor(actor = {}) {
    const direct = actor.sourcePetId || actor.petTemplate?.id || actor.pet?.id || '';
    if (direct) return direct;
    const actorId = String(actor.id || '').trim();
    const match = actorId.match(/^actor_(pet_[a-z0-9_-]+)$/i);
    return match ? match[1] : '';
}

function petTemplateFromPet(pet) {
    if (!pet) return null;
    return {
        id: pet.id,
        name: pet.name,
        dna: pet.dna,
        imageSheetUrl: pet.imageSheetUrl || '',
        traits: pet.traits || {},
        stage: pet.stage || 'adult',
    };
}

function findPetForActor(actor = {}) {
    const petId = petIdFromActor(actor);
    if (petId && state.pets?.[petId]) return state.pets[petId];
    const actorName = String(actor.name || '').trim();
    if (!actorName) return null;
    return Object.values(state.pets || {}).find(pet => displayPetName(pet) === actorName || pet?.name === actorName) || null;
}

function mergeStoryActors(storyActors, selectedActors) {
    const selected = Array.isArray(selectedActors) ? selectedActors : [];
    const generated = Array.isArray(storyActors) ? storyActors : [];
    if (!generated.length) return selected;
    const selectedById = new Map(selected.map(actor => [actorMatchKey(actor.id), actor]));
    const selectedByName = new Map(selected.map(actor => [actorMatchKey(actor.name), actor]));
    const usedSelectedIds = new Set();
    const merged = generated.map((actor, index) => {
        const matched = selectedById.get(actorMatchKey(actor?.id))
            || selectedByName.get(actorMatchKey(actor?.name))
            || selected[index]
            || null;
        if (matched?.id) usedSelectedIds.add(matched.id);
        const baseActor = { ...(matched || {}), ...(actor || {}) };
        const matchedPet = findPetForActor(baseActor) || findPetForActor(matched) || findPetForActor(actor);
        const sourcePetId = baseActor.sourcePetId || matchedPet?.id || petIdFromActor(baseActor);
        return {
            ...baseActor,
            id: actor?.id || matched?.id || `actor_${index + 1}`,
            name: actor?.name || matched?.name || t('mkRoleN', { n: index + 1 }),
            sourcePetId,
            petTemplate: baseActor.petTemplate || baseActor.pet || petTemplateFromPet(matchedPet),
        };
    });
    selected.forEach(actor => {
        if (!usedSelectedIds.has(actor.id) && !merged.some(item => item.id === actor.id)) merged.push(actor);
    });
    if (!merged.some(actor => actor.isMainActor) && merged[0]) merged[0].isMainActor = true;
    return merged;
}

function normalizeStoryForSave(story, actors) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    const mergedActors = mergeStoryActors(story?.actors, actors);
    return {
        id: story?.id || `story_${Date.now()}`,
        title: story?.title || t('mkDefaultTitle'),
        version: 1,
        selectionPrompt: story?.selectionPrompt || t('mkSelectMainActor'),
        actors: mergedActors,
        startSceneId: story?.startSceneId || scenes[0]?.id || 'scene_1',
        scenes: scenes.map(sceneFromTimeline),
        ending: story?.ending || { subtitle: t('mkEndingSubtitle'), text: t('mkEndingText') },
    };
}

function isAbortError(error) {
    return error?.name === 'AbortError' || error?.message === 'AI_GENERATION_ABORTED';
}

function createAbortError() {
    const error = new Error('AI_GENERATION_ABORTED');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw createAbortError();
}

function waitWithAbort(promise, signal) {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(createAbortError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

function textFromStreamPayload(value, payload) {
    if (typeof value === 'string' && value) return value;
    if (typeof payload === 'string' && payload) return payload;
    if (payload && typeof payload === 'object') {
        if (typeof payload.result === 'string') return payload.result;
        if (typeof payload.text === 'string') return payload.text;
        if (typeof payload.content === 'string') return payload.content;
        if (typeof payload.choices?.[0]?.message?.content === 'string') return payload.choices[0].message.content;
        if (typeof payload.choices?.[0]?.delta?.content === 'string') return payload.choices[0].delta.content;
    }
    return '';
}

async function generateStoryWithAI(promptText, count, actors, { onChunk, signal, abortController } = {}) {
    const sdk = state.sdk || window.keepwork;
    await ensureMinigamesLoaded();
    const userPrompt = buildStoryPrompt(promptText, count, actors, {
        sceneTagPromptHint: SCENE_TAG_PROMPT_HINT,
        bgMusicKeys: Object.keys(CONFIG.assets?.bgSounds || {}),
        minigames: MINIGAMES,
        lang: getLang(),
    });
    let text = '';
    const appendChunk = (delta) => {
        throwIfAborted(signal);
        if (typeof delta !== 'string' || !delta) return;
        text += delta;
        onChunk?.(delta, text);
    };
    const handleMessage = (value, payload) => {
        throwIfAborted(signal);
        const nextText = textFromStreamPayload(value, payload);
        if (!nextText) return;
        const delta = nextText.startsWith(text) ? nextText.slice(text.length) : nextText;
        text = nextText;
        onChunk?.(delta, text);
    };
    throwIfAborted(signal);

    if (sdk?.aiChat?.createSession) {
        const session = sdk.aiChat.createSession({ modId: 'magichaqi-story-maker', chatId: `story-maker-${Date.now()}`, skipHistory: true });
        try {
            const sendPromise = session.send(userPrompt, { stream: true, abortController, onMessage: handleMessage, onChunk: appendChunk });
            sendPromise.catch(() => {});
            const result = await waitWithAbort(sendPromise, signal);
            if (!text) text = (result?.text || result?.result || result || '').toString();
        } finally {
            try { session.destroy?.(); } catch (_) {}
        }
    } else if (sdk?.aiChat?.chat) {
        const chatPromise = sdk.aiChat.chat({ messages: [{ role: 'user', content: userPrompt }], modId: 'magichaqi-story-maker', stream: true, abortController, onMessage: handleMessage, onChunk: appendChunk });
        chatPromise.catch(() => {});
        const result = await waitWithAbort(chatPromise, signal);
        if (!text) text = (result?.text || result?.result || result || '').toString();
    } else if (sdk?.aiGenerators?.chat) {
        const genPromise = sdk.aiGenerators.chat({ messages: [{ role: 'user', content: userPrompt }], stream: true, abortController, onMessage: handleMessage, onChunk: appendChunk });
        genPromise.catch(() => {});
        const result = await waitWithAbort(genPromise, signal);
        if (!text) text = (result?.text || result?.choices?.[0]?.message?.content || '').toString();
    } else {
        throw new Error('AI 故事生成不可用');
    }

    throwIfAborted(signal);
    const story = extractJson(text);
    if (!story) throw new Error('AI 返回内容不是有效 JSON');
    return { story: { ...story, actors: story.actors?.length ? story.actors : actors }, rawText: text };
}

function selectedActorsFromPanel(panel) {
    const actors = [];
    panel.querySelectorAll('[data-maker-pet]').forEach(card => {
        const pet = state.pets?.[card.dataset.makerPet];
        if (!pet) return;
        const actor = actorFromPet(pet, false);
        const customName = (card.querySelector('[data-maker-name]')?.value || '').trim();
        if (customName) actor.name = customName.slice(0, 24);
        actor.isMainActor = card.dataset.makerMain === '1';
        actors.push(actor);
    });
    if (!actors.some(actor => actor.isMainActor) && actors[0]) actors[0].isMainActor = true;
    return actors;
}

function optionList(items, selected, { valueKey = 'value', labelKey = 'label' } = {}) {
    return items.map(item => {
        const value = item[valueKey];
        const label = item[labelKey];
        return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}

function actorOptions(actors, selected) {
    const opts = [{ id: '$selected', name: t('mkPlayerHero') }, { id: '$narrator', name: t('mkNarrator') }, ...actors];
    return optionList(opts.map(actor => ({ value: actor.id, label: actor.name || actor.id })), selected || '$selected');
}

function activityTargetOptions(actors, selected) {
    const opts = [{ value: '', label: t('mkAnyRole') }, { value: '$selected', label: t('mkPlayerHero') }, ...actors.map(actor => ({ value: actor.id, label: actor.name || actor.id }))];
    return optionList(opts, selected || '');
}

function splitStageText(text = '') {
    const raw = String(text || '');
    const match = raw.match(/^\s*[（(]([^）)]+)[）)]\s*/);
    if (!match) return { cue: '', text: raw };
    return { cue: match[1].trim(), text: raw.slice(match[0].length) };
}

function visibleLineText(text = '') {
    return splitStageText(text).text;
}

function revealText(text = '', count = Infinity) {
    return Array.from(String(text || '')).slice(0, Math.max(0, count)).join('');
}

function moveIcon(direction) {
    const path = direction === 'up' ? 'M12 5l-6 6h4v8h4v-8h4z' : 'M12 19l6-6h-4V5h-4v8H6z';
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
}

function renderTimelineMoveButtons(itemIndex) {
    return `
        <div class="mh-scene-row-tools" aria-label="${escapeHtml(t('mkReorder'))}">
            <button type="button" class="mh-maker-icon-btn" data-move-timeline="up" data-timeline-move-index="${itemIndex}" aria-label="${escapeHtml(t('mkMoveUp'))}" title="${escapeHtml(t('mkMoveUp'))}">${moveIcon('up')}</button>
            <button type="button" class="mh-maker-icon-btn" data-move-timeline="down" data-timeline-move-index="${itemIndex}" aria-label="${escapeHtml(t('mkMoveDown'))}" title="${escapeHtml(t('mkMoveDown'))}">${moveIcon('down')}</button>
        </div>`;
}

function renderLineEditor(line, itemIndex, actors) {
    return `
        <div class="mh-scene-row" data-timeline-index="${itemIndex}" data-timeline-kind="line">
            <div class="mh-scene-row-head">
                <span class="mh-scene-row-kind">${itemIndex + 1}. ${escapeHtml(t('mkLineKind'))}</span>
                <div class="mh-scene-row-actions">
                    ${renderTimelineMoveButtons(itemIndex)}
                    <button type="button" class="mh-maker-mini danger" data-remove-timeline="${itemIndex}">${escapeHtml(t('mkRemove'))}</button>
                </div>
            </div>
            <select class="modal-input" data-line-actor>${actorOptions(actors, line?.actor)}</select>
            <textarea class="modal-input" data-line-text placeholder="${escapeHtml(t('mkLinePlaceholder'))}">${escapeHtml(line?.text || line?.say || '')}</textarea>
        </div>`;
}

function renderActivityEditor(activity, itemIndex, actors) {
    const rawType = activity?.type || 'tap';
    const type = ACTIVITY_TYPES.some(item => item.value === rawType) ? rawType : 'tap';
    const def = ACTIVITY_TYPES.find(item => item.value === type) || ACTIVITY_TYPES[2];
    const target = activity?.target || activity?.actor || activity?.actorId || '';
    return `
        <div class="mh-scene-row is-activity" data-timeline-index="${itemIndex}" data-timeline-kind="activity">
            <div class="mh-scene-row-head">
                <span class="mh-scene-row-kind">${itemIndex + 1}. ${escapeHtml(t('mkActivityKind'))} · ${escapeHtml(def.label)}</span>
                <div class="mh-scene-row-actions">
                    ${renderTimelineMoveButtons(itemIndex)}
                    <button type="button" class="mh-maker-mini danger" data-remove-timeline="${itemIndex}">${escapeHtml(t('mkRemove'))}</button>
                </div>
            </div>
            <div class="mh-maker-row-2">
                <select class="modal-input" data-activity-type>${optionList(ACTIVITY_TYPES, type)}</select>
                <input class="modal-input" data-activity-count type="number" min="1" max="20" value="${Math.max(1, Number(activity?.count ?? activity?.times ?? 1) || 1)}" aria-label="${escapeHtml(t('mkCount'))}">
            </div>
            <input class="modal-input" data-activity-title placeholder="${escapeHtml(t('mkActivityTitle'))}" value="${escapeHtml(activity?.title || activity?.gameTitle || '')}">
            <div class="mh-maker-target-fields" style="display:${type === 'minigame' ? 'none' : 'grid'};gap:8px">
                <select class="modal-input" data-activity-target>${activityTargetOptions(actors, target)}</select>
            </div>
            <div class="mh-maker-game-fields" style="display:${type === 'minigame' ? 'grid' : 'none'};gap:8px">
                <select class="modal-input" data-activity-game>${optionList(MINIGAMES.map(game => ({ value: game.id, label: game.title })), activity?.gameId || DEFAULT_MINIGAME_ID)}</select>
            </div>
            <input class="modal-input" data-activity-success placeholder="${escapeHtml(t('mkSuccessHint'))}" value="${escapeHtml(activity?.successText || '')}">
        </div>`;
}

function renderSceneEditorHtml(story, { onlySceneIndex = null } = {}) {
    if (!story?.scenes?.length) {
        return `<div class="mh-maker-empty">${escapeHtml(t('mkTimelineEmptyHint'))}</div>`;
    }
    const actors = Array.isArray(story.actors) ? story.actors : [];
    return story.scenes.map((scene, sceneIndex) => ({ scene, sceneIndex }))
        .filter(({ sceneIndex }) => onlySceneIndex === null || sceneIndex === onlySceneIndex)
        .map(({ scene, sceneIndex }) => `
        <section class="mh-scene-card" data-scene-index="${sceneIndex}">
            <div class="mh-scene-titlebar">
                <div>
                    <strong>${escapeHtml(t('mkSceneN', { n: sceneIndex + 1 }))}</strong>
                </div>
                <div class="mh-scene-actions">
                    <button type="button" class="mh-maker-mini" data-open-scene-maker>${escapeHtml(t('mkBackground'))}</button>
                    <button type="button" class="mh-maker-mini" data-add-line>${escapeHtml(t('mkAddLine'))}</button>
                    <button type="button" class="mh-maker-mini" data-add-activity>${escapeHtml(t('mkAddActivity'))}</button>
                </div>
            </div>
            <div class="mh-maker-row-2" style="grid-template-columns:88px minmax(0,1fr)">
                <label class="mh-maker-label" style="margin:0;align-self:center">${escapeHtml(t('mkBgColor'))}</label>
                <input class="modal-input mh-scene-color-input" data-scene-bg-color type="color" value="${escapeHtml(sceneBg(sceneIndex, scene.background).color || SCENE_BG_COLORS[sceneIndex % SCENE_BG_COLORS.length])}" aria-label="${escapeHtml(t('mkBgColor'))}">
            </div>
            <input class="modal-input" data-scene-bg-image placeholder="${escapeHtml(t('mkBgImagePlaceholder'))}" value="${escapeHtml(sceneBg(sceneIndex, scene.background).imageUrl || '')}">
            <input class="modal-input" data-scene-tags placeholder="${escapeHtml(t('mkSceneTagsPlaceholder'))}" value="${escapeHtml((scene.sceneTags || scene.tags || []).join(', '))}">
            <input class="modal-input" data-scene-particles placeholder="${escapeHtml(t('mkParticlesPlaceholder'))}" value="${escapeHtml((scene.particles || []).join(', '))}">
            <input type="hidden" data-scene-bg-music value="${escapeHtml(scene.bgMusic || scene.background?.bgMusic || '')}">
            <div class="mh-scene-preview" style="background:${escapeHtml(sceneBg(sceneIndex, scene.background).color || '#bae6fd')};color:#0f2747">${renderSceneParticles(scene)}<span>${escapeHtml(t('mkBgPreview'))}</span></div>
            <div class="mh-scene-timeline">
                ${sceneTimeline(scene).map((item, itemIndex) => item.kind === 'activity'
                    ? renderActivityEditor(item, itemIndex, actors)
                    : renderLineEditor(item, itemIndex, actors)).join('')}
            </div>
        </section>`).join('');
}

function storyPetForActor(actor) {
    if (!actor) return null;
    if (actor.sourcePetId && state.pets?.[actor.sourcePetId]) return state.pets[actor.sourcePetId];
    const actorName = String(actor.name || '').trim();
    if (actorName) {
        const matchedPet = Object.values(state.pets || {}).find(pet => displayPetName(pet) === actorName || pet?.name === actorName);
        if (matchedPet) return matchedPet;
    }
    const template = actor.petTemplate || actor.pet || null;
    if (!template) return null;
    return {
        id: template.id || actor.id || 'story_pet',
        name: template.name || actor.name || '抱抱龙',
        stage: template.stage || 'adult',
        imageSheetUrl: template.imageSheetUrl || '',
        dna: template.dna || '',
        traits: template.traits || {},
        anim: 'idle',
    };
}

function timelineActorId(story, actorId) {
    if (actorId === '$selected') return mainStoryActor(story)?.id || '';
    if (actorId === '$narrator') return '';
    return actorId || '';
}

function stageCueStyle(cue, index, total, isActive = false) {
    const text = String(cue || '').toLowerCase();
    let left = total <= 1 ? 50 : 28 + (44 * index / Math.max(1, total - 1));
    let bottom = 19;
    let scale = 1;
    let mood = '';
    if (/左/.test(text)) left = 28;
    if (/中|中央|middle|center/.test(text)) left = 50;
    if (/右/.test(text)) left = 72;
    if (/近/.test(text)) { bottom = 12; scale = 1.12; }
    if (/远/.test(text)) { bottom = 40; scale = 0.78; }
    if (/开心|happy/.test(text)) mood = 'happy';
    if (/伤心|sad/.test(text)) mood = 'sad';
    if (/睡|sleep/.test(text)) mood = 'sleep';
    if (isActive) { left = 50; bottom = 26; scale = Math.max(scale, 1.16); }
    return { left, bottom, scale, mood };
}

function reviewActiveSpeechText(item) {
    if (!item || isTimelineActivity(item)) return '';
    return visibleLineText(item.text || item.say || '');
}

function reviewActiveNarratorText(item, revealedChars = Infinity) {
    if (!item || isTimelineActivity(item) || item.actor !== '$narrator') return '';
    return revealText(reviewActiveSpeechText(item), revealedChars);
}

function isNarratorLine(item) {
    return !!item && !isTimelineActivity(item) && item.actor === '$narrator';
}

function renderStoryStageActorsHtml(story, timeline, activeItemIndex, revealedChars = Infinity) {
    const actors = Array.isArray(story?.actors) ? story.actors : [];
    const activeItem = timeline?.[activeItemIndex] || null;
    const activeActorId = !isTimelineActivity(activeItem) ? timelineActorId(story, activeItem?.actor) : '';
    const activeCue = !isTimelineActivity(activeItem) ? splitStageText(activeItem?.text || activeItem?.say || '').cue : '';
    const speechText = !isTimelineActivity(activeItem) ? revealText(reviewActiveSpeechText(activeItem), revealedChars) : '';
    const cast = actors.map((actor, index) => {
        const speaking = actor.id === activeActorId;
        const cue = speaking ? activeCue : '';
        const style = stageCueStyle(cue, index, actors.length, speaking);
        const pet = storyPetForActor(actor);
        if (!pet) return '';
        return `
            <div class="mh-story-stage-actor pet-sprite ${speaking ? 'is-speaking' : ''} ${activeActorId && !speaking ? 'is-listening' : ''} ${style.mood ? `is-${style.mood}` : ''}" data-story-actor-stage="${escapeHtml(actor.id)}" style="left:${style.left}%;bottom:${style.bottom}%;--stage-scale:${style.scale}">
                ${speaking ? `<div class="mh-story-speech-bubble"><span data-story-speech-text>${escapeHtml(speechText)}</span></div>` : ''}
                ${petArtHtml(pet, { alt: actor.name || pet.name || '', extraClass: speaking ? 'pop-in' : 'floaty', requireProcessedTexture: true })}
                <div class="mh-story-actor-foot-name">${escapeHtml(actor.name || pet.name || '角色')}</div>
            </div>`;
    }).join('');
    return `<div class="mh-story-stage-cast ${activeActorId ? 'is-zooming is-interaction-locked' : ''}">${cast}</div>`;
}

function mainStoryActor(story) {
    return story?.actors?.find(actor => actor.isMainActor) || story?.actors?.[0] || null;
}

function actorNameForTimeline(story, actorId) {
    if (actorId === '$narrator') return t('mkNarrator');
    const actor = actorId === '$selected' ? mainStoryActor(story) : story?.actors?.find(item => item.id === actorId);
    return actor?.name || t('mkMainRole');
}

function isTimelineActivity(item) {
    return item?.kind === 'activity' || !!item?.type;
}

function activityTotal(activity) {
    const count = Number(activity?.count ?? activity?.times ?? 1);
    return Math.max(1, Number.isFinite(count) ? Math.round(count) : 1);
}

function activityTitle(activity) {
    const typeDef = ACTIVITY_TYPES.find(type => type.value === activity?.type) || ACTIVITY_TYPES[2];
    return activity?.type === 'minigame'
        ? (activity.gameTitle || activity.title || typeDef.label)
        : (activity?.title || typeDef.label);
}

function activityIcon(activity) {
    const type = activity?.type || 'tap';
    if (type === 'feed') return '🍪';
    if (type === 'bath' || type === 'clean') return '🫧';
    if (type === 'tap') return '👆';
    if (type === 'minigame') return '🎾';
    return '✨';
}

function sceneBgMusic(scene) {
    return String(scene?.bgMusic || scene?.background?.bgMusic || '').trim();
}

function renderMusicToggleButton(track, className = 'mh-review-music-toggle') {
    if (!track) return '';
    const muted = soundManager.isBgMusicMuted?.();
    return `<button type="button" class="${className} ${muted ? 'is-muted' : ''}" data-review-music-toggle aria-label="${muted ? escapeHtml(t('mkMusicOn')) : escapeHtml(t('mkMute'))}" title="${muted ? escapeHtml(t('mkMusicOn')) : escapeHtml(t('mkMute'))}">${muted ? '♪' : '♫'}</button>`;
}

function reviewActivityProgressKey(sceneIndex, itemIndex, activity) {
    return `${sceneIndex}:${itemIndex}:${activity?.type || 'activity'}`;
}

function reviewPlaybackState(sceneIndex, timeline, playback) {
    if (!playback || playback.sceneIndex !== sceneIndex) {
        return { stepIndex: timeline.length, activeItem: null, actionProgress: {}, revealedChars: Infinity };
    }
    const stepIndex = Math.max(0, Math.min(Number(playback.stepIndex) || 0, timeline.length));
    return { stepIndex, activeItem: timeline[stepIndex] || null, actionProgress: playback.actionProgress || {}, revealedChars: Number(playback.revealedChars) || 0 };
}

function reviewLineText(story, item) {
    if (!item || isTimelineActivity(item)) return '';
    return `${actorNameForTimeline(story, item.actor)}：${visibleLineText(item.text || item.say || '')}`;
}

function storyStats(story) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    let lines = 0;
    let activities = 0;
    let minigames = 0;
    scenes.forEach(scene => sceneTimeline(scene).forEach(item => {
        if (item.kind === 'activity') {
            activities += 1;
            if (item.type === 'minigame') minigames += 1;
        } else if ((item.text || '').trim()) {
            lines += 1;
        }
    }));
    return { scenes: scenes.length, actors: story?.actors?.length || 0, lines, activities, minigames };
}

function renderStoryHealthHtml(story, titleText = null) {
    if (!story) return `<div class="mh-maker-empty">${escapeHtml(t('mkHealthEmpty'))}</div>`;
    const stats = storyStats(story);
    const ready = stats.scenes > 0 && stats.actors > 0 && stats.lines > 0;
    const title = titleText || (ready ? t('mkReady') : t('mkNeedMore'));
    return `
        <div class="mh-maker-health">
            <div class="mh-maker-health-title">${escapeHtml(t('mkHealthTitle', { title, n: stats.scenes }))}</div>
            <div class="mh-maker-health-grid">
                <span>${escapeHtml(t('mkStatActors', { n: stats.actors }))}</span>
                <span>${escapeHtml(t('mkStatLines', { n: stats.lines }))}</span>
                <span>${escapeHtml(t('mkStatActivities', { n: stats.activities }))}</span>
                <span>${escapeHtml(t('mkStatMinigames', { n: stats.minigames }))}</span>
            </div>
        </div>`;
}

function sceneBackgroundStyle(scene, sceneIndex) {
    const bg = sceneBg(sceneIndex, scene?.background || scene?.bgColor);
    const image = bg.imageUrl ? `url(&quot;${escapeHtml(bg.imageUrl).replace(/&quot;/g, '%22')}&quot;) center/cover no-repeat` : '';
    if (image) return `linear-gradient(rgba(255,255,255,.1),rgba(255,255,255,.1)), ${image}`;
    return `radial-gradient(circle at 50% 12%,rgba(255,255,255,.86),transparent 35%), linear-gradient(180deg, ${escapeHtml(bg.color || SCENE_BG_COLORS[sceneIndex % SCENE_BG_COLORS.length])}, #ffffff)`;
}

function renderBeatHtml(story, item, itemIndex, active = false) {
    if (item.kind === 'activity') {
        const typeDef = ACTIVITY_TYPES.find(type => type.value === item.type) || ACTIVITY_TYPES[3];
        const title = activityTitle(item);
        return `
            <button type="button" class="mh-review-beat is-activity ${active ? 'is-active' : ''}" data-edit-scene data-edit-item="${itemIndex}">
                <span class="mh-review-beat-icon">${item.type === 'minigame' ? '🎮' : '✨'}</span>
                <span><b>${escapeHtml(title)} × ${activityTotal(item)}</b><small>${escapeHtml(active ? t('mkWaitingInteraction') : typeDef.label)}</small></span>
            </button>`;
    }
    return `
        <button type="button" class="mh-review-beat ${active ? 'is-active' : ''}" data-edit-scene data-edit-item="${itemIndex}">
            <span class="mh-review-beat-icon">💬</span>
            <span><b>${escapeHtml(actorNameForTimeline(story, item.actor))}</b><small>${escapeHtml(visibleLineText(item.text || t('mkNewLine')))}</small></span>
        </button>`;
}

function renderReviewActionButton(sceneIndex, timelineIndex, activity, activityIndex, current, actionProgress) {
    if (!activity) return '';
    const total = activityTotal(activity);
    const done = Math.min(total, actionProgress[reviewActivityProgressKey(sceneIndex, timelineIndex, activity)] || 0);
    const left = Math.max(0, total - done);
    const badge = left <= 0 ? '✓' : String(left);
    return `
        <button type="button" class="btn-secondary action-btn dock-icon-btn mh-story-dock-action ${current ? 'is-current' : ''} ${left <= 0 ? 'is-complete' : ''}" data-review-action="${timelineIndex}">
            <span class="mh-story-action-badge" aria-hidden="true">${badge}</span>
            <span class="dock-icon">${activityIcon(activity)}</span>
            <span class="dock-label">${escapeHtml(activityTitle(activity))}</span>
        </button>`;
}

function renderReviewActionDock(story, sceneIndex, timeline, playbackState, activeItemIndex) {
    const reachedActivities = timeline
        .map((item, timelineIndex) => ({ item, timelineIndex }))
        .filter(({ item, timelineIndex }) => isTimelineActivity(item) && timelineIndex <= (playbackState.stepIndex || 0));
    const actionButtons = reachedActivities
        .map(({ item, timelineIndex }, activityIndex) => renderReviewActionButton(sceneIndex, timelineIndex, item, activityIndex, timelineIndex === activeItemIndex, playbackState.actionProgress || {}))
        .join('');
    const canContinue = (playbackState.stepIndex || 0) >= timeline.length;
    const hasPrevious = sceneIndex > 0;
    const isLastScene = sceneIndex >= (story?.scenes?.length || 0) - 1;
    const nextLabel = isLastScene ? '完成故事' : '下一页';
    const rightControl = canContinue
        ? `<button type="button" class="btn-primary dock-icon-btn mh-story-page-arrow is-next" data-review-next-page aria-label="${nextLabel}" title="${nextLabel}">›</button>`
        : '<span class="mh-story-page-arrow mh-story-page-arrow-placeholder"></span>';
    return `
        <div class="mh-story-actions">
            <button type="button" class="btn-secondary dock-icon-btn mh-story-page-arrow" data-review-prev-page${dockDisabledAttrs(!hasPrevious, t('mkFirstPage'))} aria-label="${escapeHtml(t('mkPrevPage'))}" title="${escapeHtml(t('mkPrevPage'))}">‹</button>
            <div class="mh-story-action-strip">
                ${actionButtons || '<span class="mh-story-action-placeholder"> </span>'}
            </div>
            ${rightControl}
        </div>`;
}

function renderReviewContinueButton(activeItem) {
    if (!activeItem || isTimelineActivity(activeItem)) return '';
    return `
        <div class="mh-story-hero-continue">
            <button type="button" class="mh-story-continue-hit" data-review-continue aria-label="${escapeHtml(t('mkTapContinue'))}" title="${escapeHtml(t('mkTapContinue'))}">
                <span>${escapeHtml(t('mkTapContinue'))}</span>
            </button>
        </div>`;
}

function reviewSubtitleText(story, scene, timeline, playbackState) {
    const active = playbackState.activeItem;
    if (!active) return scene?.subtitle || '这一幕播放完成。';
    if (isTimelineActivity(active)) {
        return scene?.subtitle || '';
    }
    return revealText(reviewLineText(story, active), playbackState.revealedChars);
}

function defaultReviewLayout() {
    return 'landscape';
}

function renderReviewLayoutToggle(layout) {
    const next = layout === 'portrait' ? 'landscape' : 'portrait';
    const iconPath = next === 'portrait'
        ? '<rect x="8" y="3" width="8" height="18" rx="2.4"></rect><path d="M11 18h2"></path>'
        : '<rect x="3" y="8" width="18" height="8" rx="2.4"></rect><path d="M18 11v2"></path>';
    return `
        <button type="button" class="mh-review-layout-icon" data-review-layout-toggle="${next}" aria-label="${escapeHtml(t('mkToggleLayout'))}" title="${escapeHtml(t('mkToggleLayout'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconPath}</svg>
        </button>`;
}

function renderReviewSceneBadge(sceneIndex) {
    return `
        <div class="mh-review-scene-badge">
            <span>${escapeHtml(t('mkSceneN', { n: sceneIndex + 1 }))}</span>
        </div>`;
}

function renderReviewBgEditButton(sceneIndex) {
    return `<button type="button" class="mh-review-bg-edit" data-open-scene-maker data-scene-maker-index="${sceneIndex}" aria-label="${escapeHtml(t('mkEditSceneBg', { n: sceneIndex + 1 }))}" title="${escapeHtml(t('mkEditBg'))}">${escapeHtml(t('mkBackground'))}</button>`;
}

function renderReviewHtml(story, sceneIndex = 0, layout = defaultReviewLayout(), playback = null) {
    const reviewLayout = layout === 'landscape' ? 'landscape' : 'portrait';
    if (!story?.scenes?.length) {
        return `
            <div class="mh-maker-empty">
                ${escapeHtml(t('mkReviewEmptyHint'))}
            </div>
            <button type="button" class="btn-primary" data-maker-mode-to="draft">${escapeHtml(t('mkGoGenerate'))}</button>`;
    }
    if (sceneIndex < 0) {
        const actor = mainStoryActor(story);
        const pet = storyPetForActor(actor);
        return `
            <div class="mh-review-nav">
                <div class="mh-review-pager">
                    <button type="button" class="is-active mh-review-cover-tab" data-review-scene="-1">${escapeHtml(t('mkCover'))}</button>
                    ${story.scenes.map((item, index) => `<button type="button" data-review-scene="${index}">${index + 1}</button>`).join('')}
                </div>
                ${renderReviewLayoutToggle(reviewLayout)}
            </div>
            <section class="mh-review-cover is-${reviewLayout}">
                <div class="mh-review-cover-main">
                    <div class="mh-review-cover-art">
                        ${pet ? `<div class="mh-review-pet">${petArtHtml(pet, { alt: pet.name || '', extraClass: 'floaty', requireProcessedTexture: false })}</div>` : ''}
                    </div>
                    <div class="mh-review-cover-info">
                        <div class="mh-review-cover-title">${escapeHtml(story.title || t('mkDefaultTitle'))}</div>
                        <div class="mh-review-cover-subtitle">${escapeHtml(story.selectionPrompt || t('mkSelectMainActor'))}</div>
                    </div>
                </div>
                ${renderStoryHealthHtml(story, t('mkStorySummary'))}
                <button type="button" class="btn-primary" data-review-scene="0">${escapeHtml(t('mkEnterScene1'))}</button>
            </section>
            <div class="mh-review-ai">
                <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更短、更适合手机快速游玩。">${escapeHtml(t('mkShorter'))}</button>
                <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更温暖，增加照顾宠物的情绪。">${escapeHtml(t('mkWarmer'))}</button>
                <button type="button" class="mh-maker-mini" data-ai-tweak="至少加入一个合适的小游戏互动。">${escapeHtml(t('mkAddGame'))}</button>
                <button type="button" class="mh-maker-mini" data-ai-tweak="让对白更有趣，但保持儿童友好。">${escapeHtml(t('mkFunnier'))}</button>
            </div>`;
    }
    const safeIndex = Math.max(0, Math.min(story.scenes.length - 1, sceneIndex));
    const scene = story.scenes[safeIndex];
    const timeline = sceneTimeline(scene);
    const playbackState = reviewPlaybackState(safeIndex, timeline, playback);
    playbackState.sceneIndex = safeIndex;
    const activeItemIndex = playbackState.stepIndex < timeline.length ? playbackState.stepIndex : -1;
    return `
        <div class="mh-review-nav">
            <div class="mh-review-pager">
                <button type="button" class="mh-review-cover-tab" data-review-scene="-1">${escapeHtml(t('mkCover'))}</button>
                ${story.scenes.map((item, index) => `<button type="button" class="${index === safeIndex ? 'is-active' : ''}" data-review-scene="${index}">${index + 1}</button>`).join('')}
            </div>
            ${renderReviewLayoutToggle(reviewLayout)}
        </div>
        <section class="mh-review-scene is-${reviewLayout}">
            <div class="mh-review-story-stage">
                <div class="mh-story-hero ${isTimelineActivity(playbackState.activeItem) ? 'has-action' : ''}" style="--mh-story-scene-bg:${sceneBackgroundStyle(scene, safeIndex)}">
                    ${renderSceneParticles(scene)}
                    ${renderMusicToggleButton(sceneBgMusic(scene), 'mh-story-music-toggle')}
                    ${renderReviewSceneBadge(safeIndex)}
                    ${renderStoryStageActorsHtml(story, timeline, activeItemIndex, playbackState.revealedChars)}
                    ${isNarratorLine(playbackState.activeItem) ? `<div class="mh-story-narrator-bubble"><span data-story-narrator-text>${escapeHtml(reviewActiveNarratorText(playbackState.activeItem, playbackState.revealedChars))}</span></div>` : ''}
                    ${renderReviewContinueButton(playbackState.activeItem)}
                </div>
                ${renderReviewBgEditButton(safeIndex)}
                ${renderReviewActionDock(story, safeIndex, timeline, playbackState, activeItemIndex)}
            </div>
            <div class="mh-review-scene-detail">
                <div class="mh-review-beats">
                    ${timeline.length ? timeline.map((item, itemIndex) => renderBeatHtml(story, item, itemIndex, itemIndex === activeItemIndex)).join('') : `<div class="mh-maker-empty">${escapeHtml(t('mkSceneNoBeats'))}</div>`}
                </div>
            </div>
        </section>
        <div class="mh-review-ai">
            <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更短、更适合手机快速游玩。">${escapeHtml(t('mkShorter'))}</button>
            <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更温暖，增加照顾宠物的情绪。">${escapeHtml(t('mkWarmer'))}</button>
            <button type="button" class="mh-maker-mini" data-ai-tweak="至少加入一个合适的小游戏互动。">${escapeHtml(t('mkAddGame'))}</button>
            <button type="button" class="mh-maker-mini" data-ai-tweak="让对白更有趣，但保持儿童友好。">${escapeHtml(t('mkFunnier'))}</button>
        </div>`;
}

export function renderStoryMaker(panel, data = {}, { onBack, onPlayStory } = {}) {
    disposeStoryMaker();
    const initialStory = data?.story || null;
    let disposed = false;
    let eventController = null;
    let busy = false;
    let currentStory = initialStory ? normalizeStoryForSave(initialStory, initialStory.actors || []) : null;
    let syncing = false;
    let activeMode = currentStory ? 'review' : 'draft';
    let advancedTab = 'visual';
    let reviewLayout = defaultReviewLayout();
    let reviewSceneIndex = currentStory ? -1 : 0;
    let reviewPlayback = null;
    let reviewPlaybackTimer = null;
    let reviewBgMusicActive = false;
    let generationController = null;
    let actorPress = null;
    let reviewPagerDrag = null;
    let suppressReviewPagerClick = false;
    let actorPetIds = (currentStory?.actors || []).map(actor => actor.sourcePetId || actor.petTemplate?.id || '').filter(Boolean);
    if (!actorPetIds.length) actorPetIds = (state.currentPetId ? [state.currentPetId] : []).filter(Boolean);
    let actorSettings = new Map();
    (currentStory?.actors || []).forEach(actor => {
        const petId = actor.sourcePetId || actor.petTemplate?.id || '';
        if (!petId) return;
        actorSettings.set(petId, { name: actor.name || actor.petTemplate?.name || '', main: !!actor.isMainActor });
    });
    if (!actorPetIds.length && state.petOrder?.[0]) actorPetIds = [state.petOrder[0]];

    const actorPets = () => actorPetIds.map(id => state.pets?.[id]).filter(Boolean);

    const readActorSettings = () => {
        const next = new Map(actorSettings);
        panel.querySelectorAll('[data-maker-pet]').forEach(card => {
            const id = card.dataset.makerPet;
            if (!id) return;
            next.set(id, {
                name: (card.querySelector('[data-maker-name]')?.value || '').trim(),
                main: card.dataset.makerMain === '1',
            });
        });
        actorSettings = next;
    };

    const actorCardsHtml = () => {
        const pets = actorPets();
        const hasMain = pets.some(pet => actorSettings.get(pet.id)?.main);
        const cards = pets.length ? pets.map((pet, index) => {
            const isMain = !!actorSettings.get(pet.id)?.main || (!hasMain && index === 0);
            return `
            <div class="mh-maker-pet ${isMain ? 'mh-maker-pet-main' : ''}" data-maker-pet="${escapeHtml(pet.id)}" data-maker-main="${isMain ? '1' : '0'}">
                <button type="button" class="mh-maker-delete" data-maker-delete-actor="${escapeHtml(pet.id)}" aria-label="${escapeHtml(t('mkDeleteActor'))}" title="${escapeHtml(t('mkDeleteActor'))}">×</button>
                <span class="mh-maker-main-badge" style="display:${isMain ? 'block' : 'none'}">${escapeHtml(t('mkMainRole'))}</span>
                <div class="mh-maker-art">${petArtHtml(pet, { alt: displayPetName(pet), requireProcessedTexture: false })}</div>
                <input class="mh-maker-name-input" data-maker-name maxlength="24" aria-label="${escapeHtml(t('mkActorName'))}" value="${escapeHtml(actorSettings.get(pet.id)?.name || displayPetName(pet))}">
            </div>`;
        }).join('') : '';
        return `${cards}
            <button type="button" class="mh-maker-pet mh-maker-add-card" data-maker-add-actor aria-label="${escapeHtml(t('mkAddActor'))}" title="${escapeHtml(t('mkAddActor'))}">
                <span>+</span>
            </button>`;
    };

    const renderActorCards = (captureCurrent = true) => {
        if (captureCurrent) readActorSettings();
        const host = $('mhMakerActorList');
        if (!host) return;
        host.innerHTML = actorCardsHtml();
        scanAndMount(host);
    };

    const clearReviewPlaybackTimer = () => {
        if (reviewPlaybackTimer) clearTimeout(reviewPlaybackTimer);
        reviewPlaybackTimer = null;
    };

    const syncReviewBgMusic = ({ paused = false } = {}) => {
        const scene = reviewSceneIndex >= 0 ? currentStory?.scenes?.[reviewSceneIndex] : null;
        const track = sceneBgMusic(scene);
        if (paused || !track) {
            if (reviewBgMusicActive) {
                soundManager.stopBgMusic({ fadeMs: 520 });
                reviewBgMusicActive = false;
            }
            return;
        }
        soundManager.playBgMusic(track, { fadeMs: 700, volume: 0.3 });
        reviewBgMusicActive = true;
    };

    activeStoryMakerCleanup = () => {
        disposed = true;
        eventController?.abort?.();
        panel.querySelectorAll?.('.mh-maker-actor-picker, .mh-maker-scene-picker').forEach(el => el.remove());
        document.getElementById('mhMakerStreamModal')?.remove();
        clearReviewPlaybackTimer();
        if (reviewBgMusicActive) {
            soundManager.stopBgMusic({ fadeMs: 520 });
            reviewBgMusicActive = false;
        }
    };

    const startReviewScenePlayback = (sceneIndex) => {
        if (!currentStory?.scenes?.[sceneIndex]) return;
        clearReviewPlaybackTimer();
        reviewSceneIndex = sceneIndex;
        reviewPlayback = { sceneIndex, stepIndex: 0, actionProgress: {}, revealedChars: 0 };
        syncReviewBgMusic();
        renderReviewPanel();
        scheduleReviewPlayback();
    };

    const scheduleReviewPlayback = () => {
        clearReviewPlaybackTimer();
        if (activeMode !== 'review' || !currentStory || !reviewPlayback || reviewPlayback.sceneIndex !== reviewSceneIndex) return;
        const timeline = sceneTimeline(currentStory.scenes[reviewPlayback.sceneIndex]);
        const item = timeline[reviewPlayback.stepIndex];
        if (!item || isTimelineActivity(item)) return;
        const fullText = reviewActiveSpeechText(item);
        if (reviewPlayback.revealedChars >= Array.from(fullText).length) return;
        reviewPlaybackTimer = setTimeout(() => {
            if (!reviewPlayback || reviewPlayback.sceneIndex !== reviewSceneIndex) return;
            reviewPlayback.revealedChars = Math.min(Array.from(fullText).length, (reviewPlayback.revealedChars || 0) + 1);
            updateReviewSpeechText();
            scheduleReviewPlayback();
        }, REVIEW_LINE_REVEAL_MS);
    };

    const continueReviewLine = () => {
        if (!currentStory || !reviewPlayback || reviewPlayback.sceneIndex !== reviewSceneIndex) return;
        const timeline = sceneTimeline(currentStory.scenes[reviewPlayback.sceneIndex]);
        const item = timeline[reviewPlayback.stepIndex];
        if (!item || isTimelineActivity(item)) return;
        const fullLength = Array.from(reviewActiveSpeechText(item)).length;
        if ((reviewPlayback.revealedChars || 0) < fullLength) {
            reviewPlayback.revealedChars = fullLength;
            updateReviewSpeechText();
            scheduleReviewPlayback();
            return;
        } else {
            reviewPlayback.stepIndex = Math.min(timeline.length, reviewPlayback.stepIndex + 1);
            reviewPlayback.revealedChars = 0;
        }
        renderReviewPanel();
        scheduleReviewPlayback();
    };

    const clickReviewAction = (itemIndex) => {
        if (!currentStory || !reviewPlayback || reviewPlayback.sceneIndex !== reviewSceneIndex) return;
        const scene = currentStory.scenes[reviewPlayback.sceneIndex];
        const timeline = sceneTimeline(scene);
        const activity = timeline[itemIndex];
        if (!isTimelineActivity(activity)) return;
        const key = reviewActivityProgressKey(reviewPlayback.sceneIndex, itemIndex, activity);
        const total = activityTotal(activity);
        reviewPlayback.actionProgress[key] = total;
        if (itemIndex === reviewPlayback.stepIndex) {
            reviewPlayback.stepIndex = Math.min(timeline.length, reviewPlayback.stepIndex + 1);
            reviewPlayback.revealedChars = 0;
        }
        renderReviewPanel();
        scheduleReviewPlayback();
    };

    const goReviewPrevPage = () => {
        if (!currentStory || reviewSceneIndex <= 0) return;
        startReviewScenePlayback(reviewSceneIndex - 1);
    };

    const goReviewNextPage = () => {
        if (!currentStory || reviewSceneIndex < 0) return;
        if (reviewSceneIndex < currentStory.scenes.length - 1) {
            startReviewScenePlayback(reviewSceneIndex + 1);
            return;
        }
        showToast(t('mkPreviewDone'), 'success');
    };

    const draw = () => {
        panel.innerHTML = `
            <style>
                ${sceneParticleCss()}
                .mh-maker-root { position:absolute; inset:0; display:flex; flex-direction:column; background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 48%,#fef3c7 100%); color:var(--text-primary); }
                .mh-maker-body { flex:1; min-height:0; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
                .mh-maker-header { position:relative; z-index:8; background:linear-gradient(180deg,rgba(224,247,255,.98) 0%,rgba(186,230,253,.94) 100%); box-shadow:0 8px 18px rgba(15,39,71,.14),0 1px 0 rgba(14,165,233,.26); padding-bottom:8px; }
                .mh-maker-header .topbar { background:transparent; border-bottom:0; }
                .mh-maker-tabs { display:grid; grid-template-columns:1fr 1fr .82fr 1fr; gap:6px; padding:10px 14px 0; }
                .mh-maker-tabs button { border:1.5px solid rgba(14,165,233,.28); border-radius:999px; background:rgba(255,255,255,.72); color:var(--text-secondary); font-size:13px; font-weight:900; padding:8px 6px; }
                .mh-maker-tabs button.is-active { background:var(--accent); border-color:var(--accent); color:white; box-shadow:0 3px 0 rgba(37,99,235,.25); }
                .mh-maker-panel { display:none; flex-direction:column; gap:12px; }
                .mh-maker-panel.is-active { display:flex; }
                .mh-maker-panel[data-maker-panel="advanced"].is-active { flex:1; min-height:0; }
                .mh-maker-pets { display:flex; gap:9px; overflow-x:auto; padding-bottom:4px; }
                .mh-maker-pet { position:relative; flex:0 0 126px; border:1.5px solid var(--border-card); border-radius:14px; background:rgba(255,255,255,.9); padding:8px; display:flex; flex-direction:column; gap:7px; cursor:pointer; }
                .mh-maker-pet-main { border-color:var(--accent); box-shadow:0 0 0 2px rgba(14,165,233,.18) inset; }
                .mh-maker-add-card { min-height:143px; align-items:center; justify-content:center; color:var(--accent-dark); cursor:pointer; box-shadow:none; }
                .mh-maker-add-card span { width:36px; height:36px; border-radius:999px; display:grid; place-items:center; border:1.5px dashed var(--accent); background:#effaff; font-size:24px; font-weight:900; line-height:1; }
                .mh-maker-delete { position:absolute; top:5px; right:5px; width:22px; height:22px; border-radius:999px; border:1.5px solid #fecaca; background:#fff1f2; color:#b91c1c; font-size:16px; font-weight:900; line-height:18px; display:grid; place-items:center; padding:0; }
                .mh-maker-main-badge { position:absolute; top:6px; left:6px; border-radius:999px; background:var(--accent); color:white; font-size:11px; font-weight:900; padding:2px 7px; pointer-events:none; }
                .mh-maker-art { width:76px; height:76px; border-radius:13px; background:var(--bg-pill); overflow:hidden; align-self:center; }
                .mh-maker-name-input { width:100%; height:24px; border:1px solid transparent; border-radius:8px; background:rgba(239,250,255,.8); color:var(--text-primary); font-size:13px; font-weight:900; text-align:center; line-height:1.18; padding:2px 4px; }
                .mh-maker-name-input:focus { outline:2px solid rgba(14,165,233,.32); border-color:var(--accent); background:white; }
                .mh-maker-check { display:flex; align-items:center; gap:5px; color:var(--text-secondary); font-size:12px; font-weight:800; }
                .mh-maker-check input { width:16px; height:16px; }
                .mh-maker-output { min-height:260px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.42; }
                .mh-maker-status { font-size:12px; color:var(--text-muted); min-height:18px; }
                .mh-maker-presets { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
                .mh-maker-presets button { border:1.5px solid var(--border-card); border-radius:13px; background:rgba(255,255,255,.85); color:var(--text-primary); padding:8px 4px; font-size:12px; font-weight:900; }
                .mh-maker-presets button.is-active { border-color:var(--accent); background:#ecfeff; color:var(--accent-dark); }
                .mh-advanced-tabs { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
                .mh-advanced-tabs button { border:1.5px solid rgba(14,165,233,.32); border-radius:999px; background:rgba(255,255,255,.84); color:var(--text-secondary); min-height:38px; padding:8px 10px; font-size:13px; font-weight:900; }
                .mh-advanced-tabs button.is-active { background:var(--accent); border-color:var(--accent); color:white; box-shadow:0 3px 0 rgba(37,99,235,.25); }
                .mh-advanced-panel { display:none; flex-direction:column; gap:9px; }
                .mh-advanced-panel.is-active { display:flex; }
                .mh-advanced-panel[data-advanced-panel="json"].is-active { flex:1; min-height:0; }
                .mh-advanced-panel[data-advanced-panel="json"] .mh-maker-output { flex:1; min-height:0; resize:none; }
                .mh-maker-save-top { width:64px; height:34px; padding:0 10px; border-radius:12px; font-size:13px; }
                .mh-maker-label { display:block; font-size:12px; font-weight:900; color:var(--text-secondary); margin-bottom:5px; }
                .mh-maker-empty { padding:12px; border:1.5px dashed rgba(14,165,233,.38); border-radius:14px; color:var(--text-muted); background:rgba(255,255,255,.54); font-size:13px; line-height:1.45; }
                .mh-maker-health { border:1.5px solid rgba(14,165,233,.32); border-radius:14px; background:rgba(255,255,255,.84); padding:10px; display:flex; flex-direction:column; gap:8px; }
                .mh-maker-health-title { font-size:13px; font-weight:900; color:var(--accent-dark); }
                .mh-maker-health-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
                .mh-maker-health-grid span { border-radius:999px; background:#effaff; color:var(--text-secondary); font-size:12px; font-weight:900; padding:6px 8px; text-align:center; }
                .mh-review-nav { position:relative; z-index:2; display:flex; align-items:center; gap:8px; transform:translateY(-5px); margin-bottom:-5px; }
                .mh-review-pager { flex:1; min-width:0; display:flex; gap:7px; overflow-x:auto; overflow-y:hidden; padding-bottom:2px; cursor:grab; touch-action:pan-x; overscroll-behavior-x:contain; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
                .mh-review-pager::-webkit-scrollbar { display:none; }
                .mh-review-pager.is-dragging { cursor:grabbing; }
                .mh-review-pager button { flex:0 0 36px; height:36px; border-radius:999px; border:1.5px solid var(--border-card); background:white; color:var(--text-secondary); font-weight:900; }
                .mh-review-pager .mh-review-cover-tab { flex:0 0 auto; min-width:54px; padding:0 12px; }
                .mh-review-pager button.is-active { background:var(--accent); border-color:var(--accent); color:white; }
                .mh-review-layout-icon { flex:0 0 44px; width:44px; height:36px; border-radius:9px; border:1.5px solid rgba(14,165,233,.72); background:rgba(255,255,255,.9); color:var(--accent-dark); box-shadow:0 3px 0 rgba(37,99,235,.18); display:grid; place-items:center; padding:0; }
                .mh-review-layout-icon svg { width:20px; height:20px; display:block; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
                .mh-review-cover { display:flex; flex-direction:column; gap:10px; }
                .mh-review-cover-main { position:relative; border:1.5px solid rgba(125,211,252,.78); border-radius:16px; background:rgba(255,255,255,.9); padding:10px; display:flex; flex-direction:column; gap:10px; text-align:center; }
                .mh-review-cover-art { width:min(100%,230px); aspect-ratio:9/16; min-height:0; align-self:center; border-radius:15px; position:relative; overflow:hidden; display:flex; align-items:center; justify-content:center; border:2px solid rgba(255,255,255,.82); background:radial-gradient(circle at 50% 18%,rgba(255,255,255,.92),transparent 36%),linear-gradient(180deg,#bae6fd,#fef3c7); box-shadow:var(--game-shadow-small); }
                .mh-review-cover-info { display:flex; flex-direction:column; gap:5px; padding:0 2px 2px; }
                .mh-review-cover-title { color:var(--text-primary); font-size:18px; line-height:1.25; font-weight:900; word-break:break-word; }
                .mh-review-cover-subtitle { color:var(--text-secondary); font-size:13px; line-height:1.42; font-weight:800; }
                .mh-review-scene { position:relative; border:1.5px solid rgba(125,211,252,.78); border-radius:16px; background:rgba(255,255,255,.9); padding:10px; display:flex; flex-direction:column; align-items:center; gap:10px; }
                .mh-review-story-stage { width:min(100%,230px); aspect-ratio:9/16; min-height:0; align-self:center; border-radius:22px; position:relative; overflow:hidden; display:flex; flex-direction:column; border:3px solid rgba(255,255,255,.9); box-shadow:0 0 0 2px rgba(14,165,233,.3),0 10px 26px rgba(15,39,71,.18),inset 0 0 0 1px rgba(15,39,71,.08); container-type:inline-size; }
                .mh-review-story-stage .mh-story-hero { flex:1; width:100%; min-height:0; border-radius:0; border:0; background:var(--mh-story-scene-bg); background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; box-shadow:none; }
                .mh-review-story-stage .mh-story-hero.has-action { padding-bottom:54px; }
                .mh-review-story-stage .mh-story-music-toggle { position:absolute; top:8px; right:8px; z-index:6; width:28px; height:28px; border-radius:9px; border:2px solid rgba(255,255,255,.92); background:rgba(14,165,233,.92); color:white; font-size:15px; font-weight:900; line-height:1; display:grid; place-items:center; box-shadow:0 3px 0 rgba(37,99,235,.34),0 7px 14px rgba(15,39,71,.16); }
                .mh-review-story-stage .mh-story-music-toggle.is-muted { background:rgba(255,255,255,.92); color:var(--accent-dark); }
                .mh-review-pet { width:min(210px,58vw); height:min(210px,58vw); display:block; position:relative; z-index:2; }
                .mh-review-story-stage .mh-story-stage-cast { position:absolute; inset:0; z-index:2; transform-origin:50% 54%; transition:transform .42s ease; }
                .mh-review-story-stage .mh-story-stage-cast.is-zooming { transform:scale(1.08); }
                .mh-review-story-stage .mh-story-stage-cast.is-interaction-locked .mh-story-stage-actor { pointer-events:none; }
                .mh-review-story-stage .mh-story-stage-actor { position:absolute; width:30cqw; height:30cqw; transform:translateX(-50%) scale(var(--stage-scale,1)); transform-origin:50% 100%; transition:left .38s ease,bottom .38s ease,transform .38s ease,filter .38s ease; }
                .mh-review-story-stage .mh-story-stage-actor [data-mh-pet] { pointer-events:none; }
                .mh-review-story-stage .mh-story-stage-actor.is-speaking { z-index:3; filter:drop-shadow(0 8px 10px rgba(14,116,144,.24)); transform:translateX(-50%) scale(calc(var(--stage-scale,1) * 1.16)); }
                .mh-review-story-stage .mh-story-stage-actor.is-listening { opacity:.82; }
                .mh-review-story-stage .mh-story-stage-actor.is-sleep { opacity:.82; }
                .mh-review-story-stage .mh-story-stage-actor.is-sad { filter:saturate(.84) drop-shadow(0 6px 8px rgba(15,39,71,.18)); }
                .mh-review-story-stage .mh-story-stage-actor.is-happy { filter:saturate(1.14) drop-shadow(0 8px 10px rgba(14,116,144,.22)); }
                .mh-review-story-stage .mh-story-speech-bubble { position:absolute; left:50%; bottom:calc(100% + 8px); z-index:5; min-width:36cqw; max-width:68cqw; transform:translateX(-50%); border-radius:12px; background:rgba(255,255,255,.9); color:#17324d; border:1.5px solid rgba(255,255,255,.78); box-shadow:0 7px 15px rgba(15,39,71,.18); padding:5px 7px; font-size:clamp(9px,4.7cqw,11px); line-height:1.24; font-weight:900; text-align:center; }
                .mh-review-story-stage .mh-story-speech-bubble::after { content:''; position:absolute; left:50%; bottom:-6px; width:12px; height:12px; background:rgba(255,255,255,.9); border-right:1.5px solid rgba(255,255,255,.78); border-bottom:1.5px solid rgba(255,255,255,.78); transform:translateX(-50%) rotate(45deg); }
                .mh-review-story-stage .mh-story-actor-foot-name { position:absolute; left:50%; top:calc(100% + 3px); transform:translateX(-50%); max-width:40cqw; border-radius:999px; background:rgba(15,39,71,.5); color:white; padding:2px 6px; font-size:clamp(8px,3.9cqw,10px); line-height:1; font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 3px 8px rgba(15,39,71,.12); }
                .mh-review-story-stage .mh-story-narrator-bubble { position:absolute; left:50%; top:22%; z-index:4; transform:translateX(-50%); max-width:78cqw; border-radius:15px; background:rgba(255,255,255,.88); color:#17324d; border:1.5px solid rgba(255,255,255,.72); box-shadow:0 9px 20px rgba(15,39,71,.16); padding:8px 11px; font-size:12px; line-height:1.34; font-weight:900; text-align:center; }
                .mh-review-story-stage .mh-story-hero-continue { position:absolute; left:10px; right:10px; bottom:10px; z-index:6; min-height:58px; display:flex; align-items:flex-end; justify-content:center; }
                .mh-review-story-stage .mh-story-continue-hit { width:100%; min-height:54px; border:0; background:transparent; box-shadow:none; padding:0 0 7px; display:flex; align-items:flex-end; justify-content:center; cursor:pointer; }
                .mh-review-story-stage .mh-story-continue-hit span { min-width:92px; border-radius:999px; background:rgba(15,39,71,.52); color:white; border:1px solid rgba(255,255,255,.42); box-shadow:0 4px 12px rgba(15,39,71,.16); padding:7px 14px; font-size:12px; font-weight:900; line-height:1; pointer-events:none; }
                .mh-review-scene-badge { position:absolute; top:12px; left:10px; z-index:8; display:flex; align-items:center; gap:6px; }
                .mh-review-scene-badge span { border-radius:999px; background:rgba(255,255,255,.9); color:var(--accent-dark); font-size:12px; font-weight:900; line-height:1; box-shadow:0 3px 12px rgba(15,39,71,.14); padding:7px 10px; }
                .mh-review-bg-edit { position:absolute; top:8px; right:8px; z-index:9; min-width:52px; height:32px; border:1.5px solid rgba(14,165,233,.72); border-radius:999px; background:rgba(255,255,255,.92); color:var(--accent-dark); padding:0 12px; cursor:pointer; font-size:13px; font-weight:900; line-height:1; box-shadow:0 3px 0 rgba(37,99,235,.18),0 8px 16px rgba(15,39,71,.14); }
                .mh-review-bg-edit:focus-visible { outline:2px solid rgba(14,165,233,.45); outline-offset:2px; }
                .mh-review-story-stage .mh-story-actions { flex:0 0 auto; display:flex; align-items:center; gap:6px; overflow:hidden; padding:7px 8px 9px; background:linear-gradient(180deg,#7dd3fc 0%,#38bdf8 48%,#0ea5e9 100%); border-top:1px solid rgba(255,255,255,.54); box-shadow:inset 0 1px 0 rgba(255,255,255,.42),0 -8px 20px rgba(14,116,144,.16); }
                .mh-review-story-stage .mh-story-action-strip { flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:6px; overflow-x:auto; padding:1px 0 4px; }
                .mh-review-story-stage .mh-story-action-placeholder { flex:1; min-width:24px; }
                .mh-review-story-stage .mh-story-page-arrow { flex:0 0 34px; width:34px; height:34px; min-width:34px; border-radius:13px; font-size:21px; font-weight:900; line-height:1; display:grid; place-items:center; padding:0; background:rgba(239,250,255,.92); border-color:rgba(255,255,255,.74); color:var(--accent-dark); box-shadow:0 3px 0 rgba(14,116,144,.22),0 7px 13px rgba(15,39,71,.14),inset 0 1px 0 rgba(255,255,255,.9); }
                .mh-review-story-stage .mh-story-page-arrow:disabled { opacity:.34; cursor:default; }
                .mh-review-story-stage .mh-story-page-arrow-placeholder { visibility:hidden; }
                .mh-review-story-stage .mh-story-actions .mh-story-dock-action { position:relative; min-width:58px; height:44px; border-radius:12px; border-color:rgba(14,165,233,.48); background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.16)),linear-gradient(135deg,#ecfeff,#bae6fd); box-shadow:0 3px 0 rgba(14,116,144,.24),0 7px 13px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
                .mh-review-story-stage .mh-story-actions .mh-story-dock-action.is-current { border-color:rgba(37,99,235,.74); box-shadow:0 4px 0 rgba(37,99,235,.34),0 0 0 3px rgba(14,165,233,.2),0 8px 16px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
                .mh-review-story-stage .mh-story-actions .mh-story-dock-action.is-complete { background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.2)),linear-gradient(135deg,#ecfdf5,#bbf7d0); border-color:rgba(16,185,129,.55); }
                .mh-review-story-stage .mh-story-actions .mh-story-action-badge { position:absolute; right:2px; top:2px; z-index:2; min-width:17px; height:17px; padding:0 5px; border-radius:999px; display:grid; place-items:center; border:2px solid rgba(255,255,255,.94); background:linear-gradient(180deg,#fef3c7,#f59e0b); color:#7c2d12; font-size:11px; font-weight:1000; line-height:1; box-shadow:0 2px 0 rgba(146,64,14,.28),0 5px 10px rgba(15,39,71,.18); }
                .mh-review-story-stage .mh-story-actions .mh-story-dock-action.is-complete .mh-story-action-badge { background:linear-gradient(180deg,#86efac,#16a34a); color:white; box-shadow:0 3px 0 rgba(22,101,52,.34),0 6px 12px rgba(15,39,71,.18); }
                .mh-review-story-stage .mh-story-actions .mh-story-dock-action .dock-icon { font-size:16px; }
                .mh-review-story-stage .mh-story-actions .mh-story-dock-action .dock-label { max-width:52px; font-size:10px; font-weight:900; color:var(--accent-dark); }
                .mh-review-scene-detail { display:flex; flex-direction:column; gap:10px; min-width:0; width:100%; }
                .mh-review-beats { display:flex; flex-direction:column; gap:7px; max-height:100%; overflow:auto; padding:2px; }
                .mh-review-beat { width:100%; border:1.5px solid rgba(14,165,233,.28); border-radius:13px; background:#f8fdff; padding:9px; display:grid; grid-template-columns:34px minmax(0,1fr); gap:8px; align-items:center; text-align:left; color:var(--text-primary); }
                .mh-review-beat.is-activity { border-color:rgba(245,158,11,.42); background:#fffbeb; }
                .mh-review-beat.is-active { box-shadow:0 0 0 3px rgba(14,165,233,.18); }
                .mh-review-beat-icon { width:34px; height:34px; border-radius:12px; display:grid; place-items:center; background:rgba(255,255,255,.82); font-size:18px; }
                .mh-review-beat b { display:block; font-size:13px; color:var(--accent-dark); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .mh-review-beat small { display:block; font-size:13px; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
                .mh-review-ai { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:14px; }
                .mh-review-cover.is-landscape .mh-review-cover-main { display:grid; grid-template-columns:minmax(0,1.12fr) minmax(150px,.88fr); align-items:stretch; text-align:left; }
                .mh-review-cover.is-landscape .mh-review-cover-art { width:min(100%,220px); justify-self:center; }
                .mh-review-cover.is-landscape .mh-review-cover-info { justify-content:center; padding:8px 4px; }
                .mh-review-scene.is-landscape { display:grid; grid-template-columns:minmax(0,1.18fr) minmax(150px,.82fr); align-items:start; }
                .mh-review-scene.is-landscape .mh-review-story-stage { width:min(100%,220px); align-self:start; justify-self:center; }
                .mh-review-scene.is-landscape .mh-review-scene-detail { align-self:stretch; max-height:420px; }
                .mh-maker-stream-modal { position:absolute; inset:0; z-index:55; background:rgba(15,39,71,.35); display:flex; align-items:flex-end; justify-content:center; padding:14px 12px max(14px,env(safe-area-inset-bottom)); }
                .mh-maker-stream-panel { width:100%; max-height:86%; border-radius:20px 20px 16px 16px; background:linear-gradient(180deg,#effaff 0%,#ffffff 100%); box-shadow:0 16px 40px rgba(15,39,71,.28); border:1.5px solid rgba(125,211,252,.78); padding:12px; display:flex; flex-direction:column; gap:10px; }
                .mh-maker-stream-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
                .mh-maker-stream-head strong { color:var(--text-primary); font-size:15px; }
                .mh-maker-stream-hint { color:var(--text-secondary); font-size:12px; font-weight:800; line-height:1.4; }
                .mh-maker-stream-output { min-height:240px; max-height:46vh; overflow:auto; border:1.5px solid rgba(14,165,233,.28); border-radius:14px; background:#f8fdff; color:#0f2747; padding:10px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.45; white-space:pre-wrap; word-break:break-word; }
                .mh-maker-stream-output.is-empty { color:var(--text-muted); font-family:inherit; font-weight:800; }
                .mh-maker-stream-actions { display:flex; gap:8px; }
                .mh-maker-stream-actions button { flex:1; }
                .mh-maker-sheet { position:absolute; inset:0; z-index:40; display:flex; flex-direction:column; background:rgba(15,39,71,.24); }
                .mh-maker-sheet-panel { margin-top:auto; max-height:88%; overflow:hidden; border-radius:20px 20px 0 0; background:linear-gradient(180deg,#effaff 0%,#ffffff 100%); padding:12px 12px max(14px,env(safe-area-inset-bottom)); box-shadow:0 -14px 34px rgba(15,39,71,.22); display:flex; flex-direction:column; gap:10px; }
                .mh-maker-sheet-head { display:flex; justify-content:space-between; align-items:center; gap:10px; }
                .mh-maker-sheet-head strong { color:var(--text-primary); font-size:15px; }
                .mh-maker-sheet-body { min-height:0; overflow:auto; display:flex; flex-direction:column; gap:10px; padding-right:2px; }
                .mh-scene-stack { display:flex; flex-direction:column; gap:10px; }
                .mh-scene-card { border:1.5px solid rgba(125,211,252,.78); border-radius:14px; padding:10px; background:rgba(255,255,255,.9); display:flex; flex-direction:column; gap:9px; }
                .mh-scene-titlebar { display:flex; justify-content:space-between; align-items:center; gap:8px; }
                .mh-scene-titlebar strong { display:block; color:var(--text-primary); font-size:15px; }
                .mh-scene-titlebar small { display:block; color:var(--text-muted); font-size:11px; margin-top:1px; }
                .mh-scene-actions { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
                .mh-maker-mini { border:1.5px solid var(--border-card); background:#effaff; color:var(--text-secondary); border-radius:999px; padding:5px 9px; font-size:12px; font-weight:900; }
                .mh-maker-mini.danger { border-color:#fecaca; background:#fff1f2; color:#b91c1c; }
                .mh-scene-subtitle { min-height:54px; }
                .mh-scene-preview { position:relative; overflow:hidden; border-radius:13px; padding:8px 10px; background:rgba(15,39,71,.82); color:white; text-align:center; font-size:13px; line-height:1.35; font-weight:800; min-height:42px; display:grid; place-items:center; }
                .mh-scene-preview span { position:relative; z-index:2; }
                .mh-scene-timeline { display:flex; flex-direction:column; gap:8px; }
                .mh-scene-row { border:1px solid rgba(14,165,233,.28); border-left:5px solid #38bdf8; border-radius:12px; padding:9px; background:#f8fdff; display:flex; flex-direction:column; gap:7px; }
                .mh-scene-row.is-focus-flash { box-shadow:0 0 0 3px rgba(14,165,233,.24),0 8px 18px rgba(14,116,144,.16); }
                .mh-scene-row.is-activity { border-left-color:#f59e0b; background:#fffbeb; }
                .mh-scene-row-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
                .mh-scene-row-kind { font-size:12px; font-weight:900; color:var(--accent-dark); }
                .mh-scene-row-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
                .mh-scene-row-tools { display:flex; align-items:center; gap:4px; }
                .mh-maker-icon-btn { width:28px; height:28px; border:1.5px solid rgba(14,165,233,.34); border-radius:999px; background:#effaff; color:var(--accent-dark); display:grid; place-items:center; padding:0; }
                .mh-maker-icon-btn svg { width:16px; height:16px; display:block; fill:currentColor; }
                .mh-maker-row-2 { display:grid; grid-template-columns:minmax(0,1fr) 76px; gap:8px; }
                .mh-scene-color-input { height:28px; min-height:28px; padding:3px; cursor:pointer; overflow:hidden; }
                .mh-scene-color-input::-webkit-color-swatch-wrapper { padding:0; }
                .mh-scene-color-input::-webkit-color-swatch { border:0; border-radius:999px; }
                .mh-scene-color-input::-moz-color-swatch { border:0; border-radius:999px; }
                .mh-scene-row textarea { min-height:58px; }
            </style>
            <div class="mh-maker-root">
                <div class="mh-maker-header">
                <div class="topbar">
                    <button class="btn-icon" id="mhMakerBack" style="width:36px;height:36px;font-size:18px">‹</button>
                    <span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('mkStoryMaker'))}</span>
                    <button id="mhMakerSave" class="btn-primary mh-maker-save-top">${escapeHtml(t('mkSave'))}</button>
                </div>
                <div class="mh-maker-tabs">
                    <button type="button" data-maker-mode="draft">${escapeHtml(t('mkCreate'))}</button>
                    <button type="button" data-maker-mode="review">${escapeHtml(t('mkReview'))}</button>
                    <button type="button" data-maker-play>${escapeHtml(t('mkPlay'))}</button>
                    <button type="button" data-maker-mode="advanced">${escapeHtml(t('mkAdvanced'))}</button>
                </div>
                </div>
                <div class="mh-maker-body">
                    <section class="mh-maker-panel" data-maker-panel="draft">
                    <div class="card-flat">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                            <div style="font-size:14px;font-weight:900">${escapeHtml(t('mkSelectActors'))}</div>
                        </div>
                        <div class="mh-maker-pets" id="mhMakerActorList">
                            ${actorCardsHtml()}
                        </div>
                    </div>
                    <div class="card-flat" style="display:flex;flex-direction:column;gap:9px">
                        <label style="font-size:13px;font-weight:900;color:var(--text-primary)">${escapeHtml(t('mkStoryPrompt'))}</label>
                        <textarea id="mhMakerPrompt" class="modal-input" style="min-height:92px" placeholder="${escapeHtml(t('mkStoryPromptPlaceholder'))}"></textarea>
                        <input id="mhMakerSceneCount" type="hidden" value="${DEFAULT_SCENE_COUNT}">
                        <div class="mh-maker-presets">
                            <button type="button" data-scene-count="3">${escapeHtml(t('mkShortStory'))}</button>
                            <button type="button" class="is-active" data-scene-count="5">${escapeHtml(t('mkStandard'))}</button>
                            <button type="button" data-scene-count="8">${escapeHtml(t('mkLongStory'))}</button>
                        </div>
                        <button id="mhMakerGenerate" class="btn-primary" ${busy ? 'disabled' : ''}>${busy ? escapeHtml(t('mkGenerating')) : escapeHtml(t('mkAiGenerate'))}</button>
                        <div id="mhMakerStatus" class="mh-maker-status">等待生成。</div>
                    </div>
                    <div id="mhMakerDraftSummary">${renderStoryHealthHtml(currentStory)}</div>
                    </section>
                    <section class="mh-maker-panel" data-maker-panel="review">
                        <div id="mhMakerReview">${renderReviewHtml(currentStory, reviewSceneIndex, reviewLayout)}</div>
                    </section>
                    <section class="mh-maker-panel" data-maker-panel="advanced">
                    <div class="mh-advanced-tabs" aria-label="${escapeHtml(t('mkAdvancedTabs'))}">
                        <button type="button" class="${advancedTab === 'visual' ? 'is-active' : ''}" data-advanced-tab="visual">${escapeHtml(t('mkVisualEdit'))}</button>
                        <button type="button" class="${advancedTab === 'json' ? 'is-active' : ''}" data-advanced-tab="json">JSON文本</button>
                    </div>
                    <div class="card-flat mh-advanced-panel ${advancedTab === 'visual' ? 'is-active' : ''}" data-advanced-panel="visual">
                        <div style="font-size:14px;font-weight:900">${escapeHtml(t('mkDetailTimeline'))}</div>
                        <div id="mhMakerSceneEditor" class="mh-scene-stack">${renderSceneEditorHtml(currentStory)}</div>
                    </div>
                    <div class="card-flat mh-advanced-panel ${advancedTab === 'json' ? 'is-active' : ''}" data-advanced-panel="json">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                            <div>
                                <div style="font-size:14px;font-weight:900">JSON 数据</div>
                                <div class="mh-maker-status">完整故事 JSON，可直接编辑、粘贴后保存。</div>
                            </div>
                            <button id="mhMakerFormat" class="btn-primary">${escapeHtml(t('mkSave'))}</button>
                        </div>
                        <textarea id="mhMakerJson" class="modal-input mh-maker-output" spellcheck="false" placeholder="AI 输出会同步到这里；也可以粘贴故事 JSON 后保存。">${currentStory ? escapeHtml(JSON.stringify(currentStory, null, 2)) : ''}</textarea>
                    </div>
                    </section>
                    <div id="mhMakerSaved" style="font-size:12px;color:var(--text-muted);min-height:18px"></div>
                </div>
            </div>`;

        bindEvents();
        setMode(activeMode);
        ParticleEffects.getInstance().mountAll(panel);
        scanAndMount(panel);
    };

    function setMode(mode) {
        activeMode = mode || 'draft';
        if (activeMode === 'review' && currentStory && reviewSceneIndex >= currentStory.scenes.length) reviewSceneIndex = -1;
        panel.querySelectorAll('[data-maker-mode]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.makerMode === activeMode));
        panel.querySelectorAll('[data-maker-panel]').forEach(section => section.classList.toggle('is-active', section.dataset.makerPanel === activeMode));
        if (activeMode === 'review') {
            renderReviewPanel();
            syncReviewBgMusic();
            scheduleReviewPlayback();
        } else {
            clearReviewPlaybackTimer();
            syncReviewBgMusic({ paused: true });
        }
        if (activeMode === 'advanced') {
            renderSceneEditor();
            setAdvancedTab(advancedTab);
        }
    }

    function setStatus(text) {
        const el = $('mhMakerStatus');
        if (el) el.textContent = text || '';
    }

    function setJsonText(text) {
        const textarea = $('mhMakerJson');
        if (!textarea) return;
        textarea.value = text || '';
        textarea.scrollTop = textarea.scrollHeight;
    }

    function renderSceneEditor() {
        const host = $('mhMakerSceneEditor');
        if (!host) return;
        host.innerHTML = renderSceneEditorHtml(currentStory);
    }

    function setAdvancedTab(tab) {
        const nextTab = tab === 'json' ? 'json' : 'visual';
        if (nextTab === 'json') {
            if (currentStory) syncSceneEditorToJson();
        } else if (advancedTab === 'json') {
            const parsed = parseJsonEditor({ quiet: true });
            if (parsed) {
                currentStory = parsed;
                syncJsonFromStory();
                renderSceneEditor();
                refreshStoryPanels();
            } else if (($('mhMakerJson')?.value || '').trim()) {
                showToast(t('mkJsonStayText'), 'error');
                advancedTab = 'json';
                return;
            }
        }
        advancedTab = nextTab;
        panel.querySelectorAll('[data-advanced-tab]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.advancedTab === advancedTab));
        panel.querySelectorAll('[data-advanced-panel]').forEach(section => section.classList.toggle('is-active', section.dataset.advancedPanel === advancedTab));
    }

    function renderReviewPanel() {
        const host = $('mhMakerReview');
        if (!host) return;
        host.innerHTML = renderReviewHtml(currentStory, reviewSceneIndex, reviewLayout, reviewPlayback);
        ParticleEffects.getInstance().mountAll(host);
        scanAndMount(host);
    }

    function updateReviewSpeechText() {
        const host = $('mhMakerReview');
        if (!host || !currentStory || !reviewPlayback || reviewPlayback.sceneIndex !== reviewSceneIndex) return;
        const item = sceneTimeline(currentStory.scenes[reviewPlayback.sceneIndex])[reviewPlayback.stepIndex];
        const text = revealText(reviewActiveSpeechText(item), reviewPlayback.revealedChars || 0);
        host.querySelectorAll('[data-story-speech-text]').forEach(el => { el.textContent = text; });
        const narrator = host.querySelector('[data-story-narrator-text]');
        if (narrator) narrator.textContent = reviewActiveNarratorText(item, reviewPlayback.revealedChars || 0);
    }

    function renderOpenEditSheet() {
        const sheet = document.getElementById('mhMakerEditSheet');
        if (!sheet) return;
        const sceneIndex = Number(sheet.dataset.editSheetIndex);
        if (!Number.isFinite(sceneIndex) || !currentStory?.scenes?.[sceneIndex]) return;
        const body = sheet.querySelector('.mh-maker-sheet-body');
        if (!body) return;
        body.innerHTML = `<div class="mh-scene-stack">${renderSceneEditorHtml(currentStory, { onlySceneIndex: sceneIndex })}</div>`;
        ParticleEffects.getInstance().mountAll(body);
        scanAndMount(body);
    }

    function renderDraftSummary() {
        const host = $('mhMakerDraftSummary');
        if (!host) return;
        host.innerHTML = renderStoryHealthHtml(currentStory);
    }

    function refreshStoryPanels() {
        renderDraftSummary();
        renderReviewPanel();
        renderSceneEditor();
        renderOpenEditSheet();
    }

    function syncJsonFromStory() {
        if (!currentStory) return;
        setJsonText(JSON.stringify(currentStory, null, 2));
    }

    function parseJsonEditor({ quiet = false } = {}) {
        const text = $('mhMakerJson')?.value || '';
        if (!text.trim()) {
            if (!quiet) showToast(t('mkPasteFirst'), 'info');
            return null;
        }
        const parsed = extractJson(text);
        if (!parsed) {
            if (!quiet) showToast(t('mkJsonParseFail'), 'error');
            return null;
        }
        return normalizeStoryForSave(parsed, selectedActorsFromPanel(panel));
    }

    function readStoryFromSceneEditor() {
        if (!currentStory) return null;
        const story = normalizeStoryForSave(currentStory, selectedActorsFromPanel(panel));
        panel.querySelectorAll('[data-scene-index]').forEach(sceneEl => {
            const sceneIndex = Number(sceneEl.dataset.sceneIndex);
            const scene = story.scenes[sceneIndex];
            if (!scene) return;
            scene.subtitle = '';
            scene.background = sceneBg(sceneIndex, {
                type: 'color',
                color: sceneEl.querySelector('[data-scene-bg-color]')?.value || SCENE_BG_COLORS[sceneIndex % SCENE_BG_COLORS.length],
                imageUrl: sceneEl.querySelector('[data-scene-bg-image]')?.value || '',
            });
            scene.sceneTags = (sceneEl.querySelector('[data-scene-tags]')?.value || '').split(/[，,、\s]+/).map(item => item.trim()).filter(Boolean);
            scene.particles = (sceneEl.querySelector('[data-scene-particles]')?.value || '').split(/[，,、\s]+/).map(item => item.trim()).filter(Boolean);
            scene.bgMusic = sceneEl.querySelector('[data-scene-bg-music]')?.value || scene.bgMusic || '';
            scene.timeline = Array.from(sceneEl.querySelectorAll('[data-timeline-index]')).map(row => {
                if (row.dataset.timelineKind === 'line') {
                    return {
                        kind: 'line',
                        actor: row.querySelector('[data-line-actor]')?.value || '$selected',
                        text: row.querySelector('[data-line-text]')?.value || '',
                    };
                }
                const type = row.querySelector('[data-activity-type]')?.value || 'tap';
                const def = ACTIVITY_TYPES.find(item => item.value === type) || ACTIVITY_TYPES[2];
                return normalizeActivity({
                    type,
                    target: row.querySelector('[data-activity-target]')?.value || '',
                    title: row.querySelector('[data-activity-title]')?.value || def.label,
                    count: Math.max(1, Number(row.querySelector('[data-activity-count]')?.value) || 1),
                    gameId: row.querySelector('[data-activity-game]')?.value || DEFAULT_MINIGAME_ID,
                    successText: row.querySelector('[data-activity-success]')?.value || '',
                });
            }).filter(item => item.kind === 'activity' || (item.text || '').trim());
            const normalized = sceneFromTimeline(scene, sceneIndex);
            Object.assign(scene, normalized);
        });
        currentStory = story;
        return currentStory;
    }

    function syncSceneEditorToJson() {
        if (syncing || !currentStory) return;
        syncing = true;
        try {
            readStoryFromSceneEditor();
            syncJsonFromStory();
            renderDraftSummary();
            renderReviewPanel();
        } finally {
            syncing = false;
        }
    }

    function openSceneEditSheet(sceneIndex, focusItemIndex = null) {
        if (!currentStory?.scenes?.[sceneIndex]) return;
        syncSceneEditorToJson();
        document.getElementById('mhMakerEditSheet')?.remove();
        const sheet = document.createElement('div');
        sheet.id = 'mhMakerEditSheet';
        sheet.className = 'mh-maker-sheet';
        sheet.innerHTML = `
            <div class="mh-maker-sheet-panel">
                <div class="mh-maker-sheet-head">
                    <strong>${escapeHtml(t('mkSceneN', { n: sceneIndex + 1 }))}</strong>
                    <button type="button" class="mh-maker-mini" data-close-edit-sheet>${escapeHtml(t('mkFinish'))}</button>
                </div>
                <div class="mh-maker-sheet-body"><div class="mh-scene-stack">${renderSceneEditorHtml(currentStory, { onlySceneIndex: sceneIndex })}</div></div>
            </div>`;
        sheet.dataset.editSheetIndex = String(sceneIndex);
        panel.appendChild(sheet);
        scanAndMount(sheet);
        if (focusItemIndex !== null && Number.isFinite(Number(focusItemIndex))) {
            requestAnimationFrame(() => {
                const target = sheet.querySelector(`[data-timeline-index="${Number(focusItemIndex)}"]`);
                if (!target) return;
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                target.classList.add('is-focus-flash');
                window.setTimeout(() => target.classList.remove('is-focus-flash'), 900);
            });
        }
    }

    function closeSceneEditSheet() {
        syncSceneEditorToJson();
        document.getElementById('mhMakerEditSheet')?.remove();
        renderSceneEditor();
        renderReviewPanel();
    }

    function openGenerationModal(title = t('mkGenModalTitle')) {
        document.getElementById('mhMakerStreamModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'mhMakerStreamModal';
        modal.className = 'mh-maker-stream-modal';
        modal.innerHTML = `
            <div class="mh-maker-stream-panel">
                <div class="mh-maker-stream-head">
                    <strong>${escapeHtml(title)}</strong>
                    <button type="button" class="mh-maker-mini danger" data-abort-generation>${escapeHtml(t('mkAbort'))}</button>
                </div>
                <div class="mh-maker-stream-hint">请耐心等待，AI 会把内容实时写到下面。生成完成后会自动关闭。</div>
                <div id="mhMakerStreamOutput" class="mh-maker-stream-output is-empty">等待 AI 返回内容...</div>
                <div class="mh-maker-stream-actions">
                    <button type="button" class="btn-secondary" data-abort-generation>${escapeHtml(t('mkAbortGen'))}</button>
                </div>
            </div>`;
        panel.appendChild(modal);
        return modal;
    }

    function setGenerationModalText(text) {
        const output = $('mhMakerStreamOutput');
        if (!output) return;
        output.textContent = text || '等待 AI 返回内容...';
        output.classList.toggle('is-empty', !text);
        output.scrollTop = output.scrollHeight;
    }

    function closeGenerationModal() {
        document.getElementById('mhMakerStreamModal')?.remove();
    }

    function clearGeneratedStoryForRegenerate() {
        clearReviewPlaybackTimer();
        document.getElementById('mhMakerEditSheet')?.remove();
        reviewPlayback = null;
        reviewSceneIndex = 0;
        currentStory = null;
        setJsonText('');
        refreshStoryPanels();
        setMode('draft');
    }

    function abortGeneration() {
        if (!generationController || generationController.signal.aborted) return;
        generationController.abort();
        setStatus('已终止生成。');
        showToast(t('mkAborted'), 'info', 1600);
        closeGenerationModal();
    }

    async function runGenerate(tweakText = '') {
        if (busy) return;
        const actors = selectedActorsFromPanel(panel);
        if (!actors.length) { showToast(t('mkPickActor'), 'info'); return; }
        const isFullRegenerate = !tweakText;
        const hasGeneratedStory = !!currentStory || !!(($('mhMakerJson')?.value || '').trim());
        if (isFullRegenerate && hasGeneratedStory) {
            const ok = await confirmDialog(t('mkRegenConfirm'), {
                okText: t('mkRegenOk'),
                cancelText: t('cancel'),
            });
            if (!ok) return;
        }
        busy = true;
        const generateBtn = $('mhMakerGenerate');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.textContent = tweakText ? t('mkAdjusting') : t('mkGenerating');
        }
        generationController = new AbortController();
        openGenerationModal(tweakText ? t('mkGenAdjustTitle') : t('mkGenModalTitle'));
        const previousStory = currentStory;
        const previousStoryJson = tweakText && currentStory ? JSON.stringify(currentStory) : '';
        clearGeneratedStoryForRegenerate();
        setStatus(tweakText ? t('mkGenReadjust') : t('mkGenStreaming'));
        try {
            const count = Math.max(1, Math.min(12, Number($('mhMakerSceneCount')?.value) || DEFAULT_SCENE_COUNT));
            const basePrompt = $('mhMakerPrompt')?.value || '';
            const prompt = tweakText
                ? `${basePrompt || t('mkWarmAdventure')}\n调整要求：${tweakText}\n请基于当前故事继续修改，不要丢失原有演员和可玩结构。\n当前故事 JSON：${previousStoryJson}`
                : basePrompt;
            try {
                const result = await generateStoryWithAI(prompt, count, actors, {
                    signal: generationController.signal,
                    abortController: generationController,
                    onChunk: (_delta, fullText) => {
                        setJsonText(fullText);
                        setGenerationModalText(fullText);
                        setStatus(t('mkGenProgress', { n: fullText.length }));
                    },
                });
                currentStory = await assignPresetScenesToStory(normalizeStoryForSave(result.story, actors));
            } catch (e) {
                if (isAbortError(e)) {
                    currentStory = previousStory || null;
                    syncJsonFromStory();
                    refreshStoryPanels();
                    return;
                }
                console.warn('AI story generation fallback', e);
                if (isFullRegenerate) {
                    currentStory = null;
                    setJsonText('');
                    refreshStoryPanels();
                    setStatus('重新生成失败，请稍后再试。');
                    showToast(t('mkRegenFailed', { error: (e?.message || e) }), 'error', 2600);
                    return;
                }
                currentStory = await assignPresetScenesToStory(fallbackStory(prompt, count, actors));
                showToast(t('mkAiUnavailable'), 'info', 2200);
            }
            reviewSceneIndex = -1;
            syncJsonFromStory();
            refreshStoryPanels();
            setMode('review');
            setStatus(t('mkGenSavedAuto', { n: currentStory.scenes.length }));
            const saved = await persistStory(currentStory);
            setStatus(saved
                ? t('mkGenSavedTo', { n: currentStory.scenes.length, path: saved.path })
                : t('mkGenSaveFailed', { n: currentStory.scenes.length }));
            showToast(saved ? '故事已生成并自动保存' : '故事已生成，自动保存失败', saved ? 'success' : 'error', 1800);
        } finally {
            generationController = null;
            closeGenerationModal();
            busy = false;
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.textContent = t('mkAiGenerate');
            }
        }
    }

    async function ensureActorPetsLoaded(ids = actorPetIds) {
        const missing = ids.filter(id => id && !state.pets?.[id]);
        if (!missing.length) return;
        await Promise.all(missing.map(id => loadPet(id).catch(() => null)));
    }

    function syncStoryActorsAfterPicker() {
        if (!currentStory) return;
        currentStory = readStoryFromSceneEditor() || currentStory;
        currentStory.actors = selectedActorsFromPanel(panel);
        refreshStoryPanels();
        syncJsonFromStory();
    }

    function openActorPicker() {
        if (disposed) return;
        readActorSettings();
        panel.querySelectorAll?.('.mh-maker-actor-picker').forEach(el => el.remove());
        const overlay = document.createElement('div');
        overlay.className = 'mh-maker-actor-picker';
        overlay.style.cssText = 'position:absolute;inset:0;z-index:30;background:var(--bg-page,#e0f7ff)';
        panel.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (!e.target.closest?.('#mhPetListBack')) return;
            e.preventDefault();
            e.stopPropagation();
            close();
        }, { capture: true });
        const rerender = () => renderPetList(overlay, { pets: petListRecords() }, {
            pickerMode: true,
            multiple: true,
            selectedIds: actorPetIds,
            title: '添加演员',
            confirmText: '加入舞台',
            onBack: close,
            onLoadPet: async (id) => {
                if (disposed || !overlay.isConnected) return null;
                return await loadPet(id).catch(() => null);
            },
            onConfirm: async (ids) => {
                const uniqueIds = [...new Set(ids.filter(Boolean))];
                if (!uniqueIds.length) { showToast(t('mkPickActor'), 'info'); return; }
                await ensureActorPetsLoaded(uniqueIds);
                if (disposed || !overlay.isConnected) return;
                readActorSettings();
                actorPetIds = uniqueIds.filter(id => state.pets?.[id]);
                if (!actorPetIds.length) { showToast(t('mkActorsLoading'), 'info'); return; }
                close();
                renderActorCards();
                syncStoryActorsAfterPicker();
            },
        });
        rerender();
    }

    function parseEditorStory() {
        if (advancedTab === 'json' && ($('mhMakerJson')?.value || '').trim()) {
            const parsed = parseJsonEditor();
            if (!parsed) return null;
            currentStory = parsed;
            renderSceneEditor();
            syncJsonFromStory();
            setStatus(t('mkParsedScenes', { n: currentStory.scenes.length }));
            return currentStory;
        }
        if (currentStory) {
            const story = readStoryFromSceneEditor();
            if (story) return story;
        }
        const parsed = parseJsonEditor();
        if (!parsed) return null;
        currentStory = parsed;
        renderSceneEditor();
        syncJsonFromStory();
        setStatus(t('mkParsedScenes', { n: currentStory.scenes.length }));
        return currentStory;
    }

    async function saveCurrentStory() {
        const story = parseEditorStory();
        if (!story) return;
        await persistStory(story, { toast: true });
    }

    async function persistStory(story, { toast = false } = {}) {
        try {
            const result = await saveWorkspaceStory(story, story.id || story.title);
            const saved = $('mhMakerSaved');
            if (saved) saved.textContent = t('mkSavedTo', { path: result.path });
            currentStory = result.story || story;
            syncJsonFromStory();
            if (toast) showToast(t('mkSaved'), 'success');
            return result;
        } catch (e) {
            showToast(t('mkSaveFailed', { error: (e?.message || e) }), 'error');
            return null;
        }
    }

    function playCurrentStory() {
        const story = parseEditorStory();
        if (!story) return;
        disposeStoryMaker();
        onPlayStory?.(story);
    }

    function addLine(sceneIndex) {
        currentStory = readStoryFromSceneEditor() || currentStory;
        const scene = currentStory?.scenes?.[sceneIndex];
        if (!scene) return;
        scene.timeline = sceneTimeline(scene);
        scene.timeline.push({ kind: 'line', actor: '$selected', text: t('mkNewLineText') });
        Object.assign(scene, sceneFromTimeline(scene, sceneIndex));
        refreshStoryPanels();
        syncJsonFromStory();
    }

    function addActivity(sceneIndex) {
        currentStory = readStoryFromSceneEditor() || currentStory;
        const scene = currentStory?.scenes?.[sceneIndex];
        if (!scene) return;
        scene.timeline = sceneTimeline(scene);
        scene.timeline.push(normalizeActivity({ type: 'tap', title: t('mkNewActivityTitle'), count: 1, successText: t('mkNewActivityDone') }));
        Object.assign(scene, sceneFromTimeline(scene, sceneIndex));
        refreshStoryPanels();
        syncJsonFromStory();
    }

    function removeTimelineItem(sceneIndex, itemIndex) {
        currentStory = readStoryFromSceneEditor() || currentStory;
        const scene = currentStory?.scenes?.[sceneIndex];
        if (!scene) return;
        scene.timeline = sceneTimeline(scene);
        scene.timeline.splice(itemIndex, 1);
        Object.assign(scene, sceneFromTimeline(scene, sceneIndex));
        refreshStoryPanels();
        syncJsonFromStory();
    }

    function moveTimelineItem(sceneIndex, itemIndex, direction) {
        currentStory = readStoryFromSceneEditor() || currentStory;
        const scene = currentStory?.scenes?.[sceneIndex];
        if (!scene) return;
        const timeline = sceneTimeline(scene);
        const targetIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
        if (itemIndex < 0 || itemIndex >= timeline.length || targetIndex < 0 || targetIndex >= timeline.length) return;
        [timeline[itemIndex], timeline[targetIndex]] = [timeline[targetIndex], timeline[itemIndex]];
        scene.timeline = timeline;
        Object.assign(scene, sceneFromTimeline(scene, sceneIndex));
        refreshStoryPanels();
        syncJsonFromStory();
    }

    function openSceneMaker(sceneIndex) {
        currentStory = readStoryFromSceneEditor() || currentStory;
        const scene = currentStory?.scenes?.[sceneIndex];
        if (!scene) return;
        const overlay = document.createElement('div');
        overlay.className = 'mh-maker-scene-picker';
        overlay.style.cssText = 'position:absolute;inset:0;z-index:60;background:var(--bg-page,#e0f7ff)';
        panel.appendChild(overlay);
        const close = () => overlay.remove();
        renderStorySceneMaker(overlay, { scene, tags: scene.sceneTags || scene.tags || [] }, {
            onBack: close,
            onApplyScene: (nextScene) => {
                Object.assign(scene, sceneFromTimeline(nextScene, sceneIndex));
                close();
                refreshStoryPanels();
                syncJsonFromStory();
            },
        }).catch(e => {
            console.error('打开场景素材失败', e);
            showToast(t('mkOpenSceneFailed', { error: (e?.message || e) }), 'error');
            close();
        });
    }

    function deleteActor(petId, card = null) {
        if (!petId) return;
        card?.remove?.();
        readActorSettings();
        actorPetIds = actorPetIds.filter(id => id !== petId);
        actorSettings.delete(petId);
        const hasMain = actorPetIds.some(id => actorSettings.get(id)?.main);
        if (!hasMain && actorPetIds[0]) {
            const current = actorSettings.get(actorPetIds[0]) || {};
            actorSettings.set(actorPetIds[0], { ...current, main: true });
        }
        renderActorCards(false);
        syncStoryActorsAfterPicker();
    }

    function setMainActor(petId) {
        if (!petId || !actorPetIds.includes(petId)) return;
        readActorSettings();
        actorPetIds.forEach(id => {
            const current = actorSettings.get(id) || {};
            actorSettings.set(id, { ...current, main: id === petId });
        });
        panel.querySelectorAll('[data-maker-pet]').forEach(card => {
            const isMain = card.dataset.makerPet === petId;
            card.dataset.makerMain = isMain ? '1' : '0';
            card.classList.toggle('mh-maker-pet-main', isMain);
            const badge = card.querySelector('.mh-maker-main-badge');
            if (badge) badge.style.display = isMain ? 'block' : 'none';
        });
        syncStoryActorsAfterPicker();
    }

    function bindEvents() {
        eventController = new AbortController();
        const eventOptions = { signal: eventController.signal };
        $('mhMakerBack').onclick = () => {
            disposeStoryMaker();
            onBack?.();
        };
        $('mhMakerGenerate').onclick = () => runGenerate();
        $('mhMakerFormat').onclick = saveCurrentStory;
        $('mhMakerSave').onclick = saveCurrentStory;
        panel.addEventListener('input', (e) => {
            if (disposed) return;
            if (e.target.closest?.('#mhMakerActorList')) {
                readActorSettings();
                syncStoryActorsAfterPicker();
                return;
            }
            if (e.target.closest?.('#mhMakerSceneEditor') || e.target.closest?.('#mhMakerEditSheet')) syncSceneEditorToJson();
        }, eventOptions);
        panel.addEventListener('change', (e) => {
            if (disposed) return;
            if (e.target.closest?.('#mhMakerActorList')) {
                readActorSettings();
                syncStoryActorsAfterPicker();
                return;
            }
            const preset = e.target.closest?.('[data-scene-count]');
            if (preset) return;
            const row = e.target.closest?.('[data-timeline-kind="activity"]');
            if (e.target.matches?.('[data-activity-type]') && row) {
                const fields = row.querySelector('.mh-maker-game-fields');
                if (fields) fields.style.display = e.target.value === 'minigame' ? 'grid' : 'none';
                const targetFields = row.querySelector('.mh-maker-target-fields');
                if (targetFields) targetFields.style.display = e.target.value === 'minigame' ? 'none' : 'grid';
            }
            if (e.target.closest?.('#mhMakerSceneEditor') || e.target.closest?.('#mhMakerEditSheet')) syncSceneEditorToJson();
        }, eventOptions);
        panel.addEventListener('pointerdown', (e) => {
            if (disposed) return;
            const pager = e.target.closest?.('.mh-review-pager');
            if (pager && !e.target.closest?.('button')) {
                reviewPagerDrag = { pager, pointerId: e.pointerId, startX: e.clientX, scrollLeft: pager.scrollLeft, moved: false };
                suppressReviewPagerClick = false;
                pager.classList.add('is-dragging');
                try { pager.setPointerCapture?.(e.pointerId); } catch (_) {}
                actorPress = null;
                return;
            }
            const card = e.target.closest?.('[data-maker-pet]');
            if (!card || e.target.closest?.('input,button,[data-maker-add-actor]')) { actorPress = null; return; }
            actorPress = { id: card.dataset.makerPet, x: e.clientX, y: e.clientY };
        }, eventOptions);
        panel.addEventListener('pointermove', (e) => {
            if (disposed) return;
            if (!reviewPagerDrag || reviewPagerDrag.pointerId !== e.pointerId) return;
            const deltaX = e.clientX - reviewPagerDrag.startX;
            if (Math.abs(deltaX) > 4) {
                reviewPagerDrag.moved = true;
                suppressReviewPagerClick = true;
            }
            reviewPagerDrag.pager.scrollLeft = reviewPagerDrag.scrollLeft - deltaX;
            if (reviewPagerDrag.moved) e.preventDefault();
        }, eventOptions);
        panel.addEventListener('pointerup', (e) => {
            if (disposed) return;
            if (reviewPagerDrag && reviewPagerDrag.pointerId === e.pointerId) {
                reviewPagerDrag.pager.classList.remove('is-dragging');
                try { reviewPagerDrag.pager.releasePointerCapture?.(e.pointerId); } catch (_) {}
                reviewPagerDrag = null;
            }
            if (!actorPress) return;
            const press = actorPress;
            actorPress = null;
            const card = e.target.closest?.('[data-maker-pet]');
            if (!card || card.dataset.makerPet !== press.id || e.target.closest?.('input,button,[data-maker-add-actor]')) return;
            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) return;
            setMainActor(press.id);
        }, eventOptions);
        panel.addEventListener('pointercancel', (e) => {
            if (disposed) return;
            if (reviewPagerDrag && reviewPagerDrag.pointerId === e.pointerId) {
                reviewPagerDrag.pager.classList.remove('is-dragging');
                reviewPagerDrag = null;
            }
            actorPress = null;
        }, eventOptions);
        panel.addEventListener('click', (e) => {
            if (disposed) return;
            if (suppressReviewPagerClick && e.target.closest?.('.mh-review-pager')) {
                suppressReviewPagerClick = false;
                return;
            }
            if (e.target.closest?.('[data-abort-generation]')) { abortGeneration(); return; }
            const modeBtn = e.target.closest?.('[data-maker-mode]');
            if (modeBtn) { setMode(modeBtn.dataset.makerMode); return; }
            const advancedTabBtn = e.target.closest?.('[data-advanced-tab]');
            if (advancedTabBtn) { setAdvancedTab(advancedTabBtn.dataset.advancedTab); return; }
            if (e.target.closest?.('[data-maker-play]')) { playCurrentStory(); return; }
            const modeToBtn = e.target.closest?.('[data-maker-mode-to]');
            if (modeToBtn) { setMode(modeToBtn.dataset.makerModeTo); return; }
            const countBtn = e.target.closest?.('[data-scene-count]');
            if (countBtn) {
                const input = $('mhMakerSceneCount');
                if (input) input.value = countBtn.dataset.sceneCount;
                panel.querySelectorAll('[data-scene-count]').forEach(btn => btn.classList.toggle('is-active', btn === countBtn));
                return;
            }
            const layoutBtn = e.target.closest?.('[data-review-layout-toggle]');
            if (layoutBtn) {
                reviewLayout = layoutBtn.dataset.reviewLayoutToggle === 'landscape' ? 'landscape' : 'portrait';
                renderReviewPanel();
                return;
            }
            const reviewBtn = e.target.closest?.('[data-review-scene]');
            if (reviewBtn) {
                const nextSceneIndex = Number(reviewBtn.dataset.reviewScene);
                reviewSceneIndex = Number.isFinite(nextSceneIndex) ? nextSceneIndex : 0;
                if (reviewSceneIndex >= 0) startReviewScenePlayback(reviewSceneIndex);
                else {
                    clearReviewPlaybackTimer();
                    reviewPlayback = null;
                    syncReviewBgMusic({ paused: true });
                    renderReviewPanel();
                }
                return;
            }
            const reviewActionBtn = e.target.closest?.('[data-review-action]');
            if (reviewActionBtn) {
                clickReviewAction(Number(reviewActionBtn.dataset.reviewAction));
                return;
            }
            const reviewPrevBtn = e.target.closest?.('[data-review-prev-page]');
            if (reviewPrevBtn) {
                if (isDockButtonDisabled(reviewPrevBtn)) { showDockDisabledToast(reviewPrevBtn); return; }
                goReviewPrevPage();
                return;
            }
            if (e.target.closest?.('[data-review-next-page]')) {
                goReviewNextPage();
                return;
            }
            if (e.target.closest?.('[data-review-continue]')) {
                continueReviewLine();
                return;
            }
            const reviewMusicBtn = e.target.closest?.('[data-review-music-toggle]');
            if (reviewMusicBtn) {
                e.preventDefault();
                e.stopPropagation();
                const scene = currentStory?.scenes?.[reviewSceneIndex];
                const track = sceneBgMusic(scene);
                const muted = soundManager.toggleBgMusicMuted?.({ fadeMs: 220 });
                if (!muted && track) soundManager.playBgMusic(track, { fadeMs: 260, volume: 0.3 });
                renderReviewPanel();
                return;
            }
            const tweakBtn = e.target.closest?.('[data-ai-tweak]');
            if (tweakBtn) { runGenerate(tweakBtn.dataset.aiTweak || ''); return; }
            const closeEditBtn = e.target.closest?.('[data-close-edit-sheet]');
            if (closeEditBtn) { closeSceneEditSheet(); return; }
            if (e.target.id === 'mhMakerEditSheet') { closeSceneEditSheet(); return; }
            const sceneMakerBtn = e.target.closest?.('[data-open-scene-maker]');
            if (sceneMakerBtn) {
                const explicit = Number(sceneMakerBtn.dataset.sceneMakerIndex);
                const sceneEl = e.target.closest?.('[data-scene-index]');
                const sceneIndex = Number.isFinite(explicit) ? explicit : Number(sceneEl?.dataset.sceneIndex ?? reviewSceneIndex);
                openSceneMaker(sceneIndex);
                return;
            }
            const editBtn = e.target.closest?.('[data-edit-scene]');
            if (editBtn && currentStory) {
                const explicit = editBtn.dataset.editScene;
                openSceneEditSheet(explicit === '' || explicit === undefined ? reviewSceneIndex : Number(explicit), editBtn.dataset.editItem === undefined ? null : Number(editBtn.dataset.editItem));
                return;
            }
            if (e.target.closest?.('[data-maker-add-actor]')) { openActorPicker(); return; }
            const deleteBtn = e.target.closest?.('[data-maker-delete-actor]');
            if (deleteBtn) { deleteActor(deleteBtn.dataset.makerDeleteActor, deleteBtn.closest('[data-maker-pet]')); return; }
            const sceneEl = e.target.closest?.('[data-scene-index]');
            if (!sceneEl) return;
            const sceneIndex = Number(sceneEl.dataset.sceneIndex);
            if (e.target.closest?.('[data-add-line]')) { addLine(sceneIndex); return; }
            if (e.target.closest?.('[data-add-activity]')) { addActivity(sceneIndex); return; }
            const removeBtn = e.target.closest?.('[data-remove-timeline]');
            if (removeBtn) { removeTimelineItem(sceneIndex, Number(removeBtn.dataset.removeTimeline)); return; }
            const moveBtn = e.target.closest?.('[data-move-timeline]');
            if (moveBtn) moveTimelineItem(sceneIndex, Number(moveBtn.dataset.timelineMoveIndex), moveBtn.dataset.moveTimeline);
        }, eventOptions);
    }

    draw();
    ensureActorPetsLoaded().then(() => {
        if (!disposed && panel?.isConnected) renderActorCards();
    });
    ensureMinigamesLoaded().then(() => {
        if (!disposed && panel?.isConnected) refreshStoryPanels();
    });
}
