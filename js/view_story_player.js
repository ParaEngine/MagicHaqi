// 故事播放视图：加载 shareable story JSON，按场景播放对白，并 gate 互动任务。
import { $, dockDisabledAttrs, escapeHtml, isDockButtonDisabled, showDockDisabledToast, showToast } from './utils.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { getProcessedSheet, mountPetArt, petArtHtml, scanAndMount, say, sayOnPet } from './pet.js';
import { loadWorkspaceStory } from './storage.js';
import { renderSceneParticles, sceneParticleCss } from './view_story_scene_maker.js';
import SoundManager from './soundManager.js';
import ParticleEffects from './particleEffects.js';
import { foodEatDurationMs, pickRandomPreferredFood, runBathInteraction, runFeedInteraction, runTouchInteraction } from './petInteractions.js';

let runtime = null;
const STORY_LINE_REVEAL_MS = 38;
const STORY_SCENE_FALLBACK_IMAGE_RATIO = 1;
const STORY_SCENE_DRAG_THRESHOLD = 8;
const STORY_ACTOR_MAX_OVERLAP = 0.05;
const STORY_DIALOGUE_EDGE_MARGIN = 12;
const STORY_TAP_FEEDBACK_MS = 2000;
const soundManager = SoundManager.getInstance();
const storySceneImageMeta = new Map();

const ACTIVITY_LABELS = {
    feed: '喂养',
    bath: '清洁',
    clean: '清洁',
    tap: '轻拍',
    minigame: '小游戏',
};

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function ensureStoryCenterPromptStyle() {
    if (document.getElementById('mhStoryCenterPromptStyle')) return;
    const style = document.createElement('style');
    style.id = 'mhStoryCenterPromptStyle';
    style.textContent = `
        .mh-story-center-prompt {
            position:fixed;
            left:50%;
            top:50%;
            z-index:99998;
            max-width:min(320px,82vw);
            transform:translate(-50%,-50%) scale(.96);
            border-radius:18px;
            background:rgba(15,39,71,.84);
            color:white;
            border:1px solid rgba(255,255,255,.42);
            box-shadow:0 14px 34px rgba(15,39,71,.24);
            padding:12px 16px;
            font-size:16px;
            line-height:1.35;
            font-weight:900;
            text-align:center;
            pointer-events:none;
            opacity:0;
            animation:mhStoryCenterPrompt 1.65s ease forwards;
        }
        @keyframes mhStoryCenterPrompt {
            0% { opacity:0; transform:translate(-50%,-46%) scale(.96); }
            16%,78% { opacity:1; transform:translate(-50%,-50%) scale(1); }
            100% { opacity:0; transform:translate(-50%,-54%) scale(.98); }
        }`;
    document.head.appendChild(style);
}

function showStoryCenterPrompt(text, durationMs = 1650) {
    const message = String(text || '').trim();
    if (!message) return;
    ensureStoryCenterPromptStyle();
    document.querySelectorAll('.mh-story-center-prompt').forEach(el => el.remove());
    const prompt = document.createElement('div');
    prompt.className = 'mh-story-center-prompt';
    prompt.textContent = message;
    document.body.appendChild(prompt);
    setTimeout(() => prompt.remove(), Math.max(300, Number(durationMs) || 1650));
}

function clampRange(value, min, max) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function currentStoryScenePanKey() {
    return runtime?.sceneId || currentScene()?.id || 'story_scene';
}

function requestStorySceneImageMeta(imageUrl) {
    if (!imageUrl || storySceneImageMeta.has(imageUrl)) return;
    const meta = { status: 'loading', ratio: STORY_SCENE_FALLBACK_IMAGE_RATIO };
    storySceneImageMeta.set(imageUrl, meta);
    const image = new Image();
    image.onload = () => {
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        meta.status = 'loaded';
        meta.width = width;
        meta.height = height;
        meta.ratio = width > 0 && height > 0 ? width / height : STORY_SCENE_FALLBACK_IMAGE_RATIO;
        if (runtime?.panel?.isConnected) applyStoryScenePan(runtime.panel);
    };
    image.onerror = () => { meta.status = 'error'; };
    image.src = imageUrl;
}

function getStoryScenePanBounds(panel) {
    const hero = panel?.querySelector?.('[data-story-hero]');
    const scene = panel?.querySelector?.('[data-story-scene]');
    if (!hero || !scene) return null;
    const heroWidth = hero.clientWidth || window.innerWidth || 1;
    const heroHeight = hero.clientHeight || window.innerHeight || 540;
    const imageUrl = sceneBackgroundImageUrl(currentScene());
    if (imageUrl) requestStorySceneImageMeta(imageUrl);
    const imageRatio = imageUrl ? (storySceneImageMeta.get(imageUrl)?.ratio || STORY_SCENE_FALLBACK_IMAGE_RATIO) : 0;
    const sceneWidth = imageUrl ? Math.max(1, Math.round(heroHeight * imageRatio)) : heroWidth;
    const sceneLeft = Math.max(0, (heroWidth - sceneWidth) / 2);
    scene.style.width = `${sceneWidth}px`;
    scene.style.left = `${sceneLeft}px`;
    scene.style.setProperty('--mh-story-viewport-height', `${heroHeight}px`);
    return {
        hero,
        scene,
        heroWidth,
        sceneWidth,
        maxPan: Math.max(0, sceneWidth - heroWidth),
    };
}

function applyStoryScenePan(panel) {
    const bounds = getStoryScenePanBounds(panel);
    if (!bounds || !runtime) return;
    const key = currentStoryScenePanKey();
    if (!runtime.scenePanById) runtime.scenePanById = {};
    if (!Number.isFinite(runtime.scenePanById[key])) runtime.scenePanById[key] = -bounds.maxPan / 2;
    const pan = clampRange(runtime.scenePanById[key], -bounds.maxPan, 0);
    runtime.scenePanById[key] = pan;
    bounds.scene.style.transform = `translate3d(${pan.toFixed(1)}px,0,0)`;
}

function bindStoryScenePan(panel) {
    const hero = panel?.querySelector?.('[data-story-hero]');
    const scene = panel?.querySelector?.('[data-story-scene]');
    if (!hero || !scene || !runtime) return;
    applyStoryScenePan(panel);
    if (runtime.storySceneResizeHandler) window.removeEventListener('resize', runtime.storySceneResizeHandler);
    runtime.storySceneResizeHandler = () => {
        if (!panel.isConnected) {
            window.removeEventListener('resize', runtime.storySceneResizeHandler);
            runtime.storySceneResizeHandler = null;
            return;
        }
        applyStoryScenePan(panel);
    };
    window.addEventListener('resize', runtime.storySceneResizeHandler, { passive: true });

    let drag = null;
    hero.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('button,a,input,textarea,select,[contenteditable="true"],[data-story-actor-stage],[data-story-music-toggle]')) return;
        const bounds = getStoryScenePanBounds(panel);
        if (!bounds || bounds.maxPan <= 1) return;
        const key = currentStoryScenePanKey();
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: runtime.scenePanById?.[key] || 0, active: false };
    });
    hero.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.active) {
            if (Math.abs(dx) < STORY_SCENE_DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
            drag.active = true;
            try { hero.setPointerCapture?.(e.pointerId); } catch (_) {}
        }
        e.preventDefault();
        const bounds = getStoryScenePanBounds(panel);
        if (!bounds) return;
        runtime.scenePanById[currentStoryScenePanKey()] = clampRange(drag.pan + dx, -bounds.maxPan, 0);
        applyStoryScenePan(panel);
    });
    const endDrag = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (drag.active) {
            try { hero.releasePointerCapture?.(e.pointerId); } catch (_) {}
            hero.__mhStoryPannedAt = Date.now();
        }
        drag = null;
    };
    hero.addEventListener('pointerup', endDrag);
    hero.addEventListener('pointercancel', endDrag);
    hero.addEventListener('click', (e) => {
        if (Date.now() - (hero.__mhStoryPannedAt || 0) > 260) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
}

export async function loadStoryFile(path) {
    const share = parseStoryShareParams();
    const sharedPath = remoteStoryPath(share.story);
    const requestedPath = path || share.story || 'pet-story/story_of_dragons.json';
    const requestedSharedPath = remoteStoryPath(requestedPath);
    if (share.fromUsername && sharedPath && (!path || requestedSharedPath === sharedPath)) {
        const remoteStory = await loadRemoteWorkspaceStory(share.fromUsername, sharedPath);
        if (remoteStory) return normalizeStory(remoteStory, remoteStory.sourcePath || share.story);
    }

    const storyPath = normalizeStoryPath(requestedPath);
    if (storyPath.startsWith('stories/')) {
        const workspaceStory = await loadWorkspaceStory(storyPath);
        if (workspaceStory) return normalizeStory(workspaceStory, storyPath);
    }
    const res = await fetch(storyPath, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`故事加载失败 (${res.status})`);
    return normalizeStory(await res.json(), storyPath);
}

export function storyPathFromUrl() {
    try {
        const share = parseStoryShareParams();
        if (share.fromUsername && share.story) return remoteStoryPath(share.story) || share.story;
        return share.story || '';
    } catch (_) { return ''; }
}

export function hasStoryParam() {
    return !!storyPathFromUrl();
}

function storyActorAtPoint(panel, clientX, clientY) {
    const actors = Array.from(panel.querySelectorAll('[data-story-actor-stage]'));
    let best = null;
    actors.forEach((el) => {
        const visual = el.querySelector('[data-mh-pet]') || el;
        const rect = visual.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) return;
        const padX = Math.max(24, rect.width * 0.28);
        const padY = Math.max(24, rect.height * 0.28);
        const inside = clientX >= rect.left - padX
            && clientX <= rect.right + padX
            && clientY >= rect.top - padY
            && clientY <= rect.bottom + padY;
        if (!inside) return;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(clientX - centerX, clientY - centerY);
        const speakingBias = el.classList.contains('is-speaking') ? 12 : 0;
        const score = distance + speakingBias;
        if (!best || score < best.score) best = { el, score };
    });
    return best?.el || null;
}

function createStoryFeedDragGhost(foodItem, clientX, clientY) {
    const ghost = document.createElement('div');
    ghost.className = 'mh-story-feed-drag-ghost';
    ghost.textContent = foodItem?.emoji || '🍽️';
    document.body.appendChild(ghost);
    moveStoryFeedDragGhost(ghost, clientX, clientY);
    return ghost;
}

function moveStoryFeedDragGhost(ghost, clientX, clientY) {
    if (!ghost) return;
    ghost.style.left = `${clientX}px`;
    ghost.style.top = `${clientY}px`;
}

function bindStoryFeedDrag(btn, activity, panel, options, index) {
    let drag = null;
    const DRAG_THRESHOLD = 8;
    const touchPoint = (event) => event.changedTouches?.[0] || event.touches?.[0] || null;
    const clearDrag = () => {
        if (!drag) return null;
        const current = drag;
        drag = null;
        current.ghost?.remove();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('touchcancel', onTouchEnd);
        return current;
    };
    const pointInsideScroller = (clientX, clientY) => {
        const rect = drag?.scroller?.getBoundingClientRect?.();
        return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };
    const lockDragAsScroll = (e) => {
        if (!drag) return;
        e.preventDefault?.();
        drag.scrollLocked = true;
        const scroller = drag.scroller;
        if (scroller) {
            scroller.scrollLeft -= e.clientX - drag.lastScrollX;
            drag.lastScrollX = e.clientX;
            scroller.__mhStoryActionScrollMoved = true;
        }
    };
    const startFeedDrag = (e) => {
        if (!drag || drag.active) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        drag.active = true;
        drag.scrollLocked = false;
        drag.ghost = createStoryFeedDragGhost(drag.foodItem, e.clientX, e.clientY);
        btn.classList.add('is-dragging-feed');
    };
    const onMove = (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const insideScroller = pointInsideScroller(e.clientX, e.clientY);
        if (drag.scrollLocked) {
            if (insideScroller) lockDragAsScroll(e);
            else startFeedDrag(e);
            return;
        }
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.active) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            if (insideScroller && Math.abs(dx) >= Math.abs(dy)) {
                lockDragAsScroll(e);
                return;
            }
            startFeedDrag(e);
            return;
        }
        e.preventDefault?.();
        moveStoryFeedDragGhost(drag.ghost, e.clientX, e.clientY);
        const targetEl = storyActorAtPoint(panel, e.clientX, e.clientY);
        panel.querySelectorAll('[data-story-actor-stage]').forEach(el => el.classList.toggle('is-feed-target', el === targetEl));
    };
    const onEnd = async (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const current = clearDrag();
        btn.classList.remove('is-dragging-feed');
        panel.querySelectorAll('[data-story-actor-stage]').forEach(el => el.classList.remove('is-feed-target'));
        if (current?.scrollLocked) {
            btn.__mhStoryFeedDragHandledAt = Date.now();
            return;
        }
        if (!current?.active) return;
        btn.__mhStoryFeedDragHandledAt = Date.now();
        e.preventDefault?.();
        e.stopPropagation?.();
        const targetEl = storyActorAtPoint(panel, e.clientX, e.clientY);
        const actor = actorById(targetEl?.dataset?.storyActorStage) || selectedActor();
        btn.disabled = true;
        try { await runFeedStoryActivity(activity, panel, options, index, { actor }); }
        finally { if (btn.isConnected) btn.disabled = false; }
    };
    const onTouchMove = (event) => {
        if (!drag || drag.pointerId !== 'touch') return;
        const point = touchPoint(event);
        if (!point) return;
        onMove({
            pointerId: 'touch',
            clientX: point.clientX,
            clientY: point.clientY,
            preventDefault: () => event.preventDefault(),
        });
    };
    const onTouchEnd = (event) => {
        if (!drag || drag.pointerId !== 'touch') return;
        const point = touchPoint(event);
        if (!point) {
            clearDrag();
            return;
        }
        onEnd({
            pointerId: 'touch',
            clientX: point.clientX,
            clientY: point.clientY,
            preventDefault: () => event.preventDefault(),
            stopPropagation: () => event.stopPropagation(),
        });
    };
    btn.addEventListener('touchstart', (event) => {
        if (drag || btn.disabled || isDialogueActive()) return;
        const point = touchPoint(event);
        if (!point) return;
        const targetPet = storyPetForFeedActor(selectedActor());
        drag = {
            pointerId: 'touch',
            startX: point.clientX,
            startY: point.clientY,
            active: false,
            scrollLocked: false,
            ghost: null,
            foodItem: storyFeedFood(activity, index, targetPet),
            scroller: btn.closest?.('.mh-story-action-strip'),
            lastScrollX: point.clientX,
        };
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd, { passive: false });
        window.addEventListener('touchcancel', onTouchEnd, { passive: false });
    }, { passive: true });
    btn.addEventListener('pointerdown', (e) => {
        if (drag) return;
        if (btn.disabled || isDialogueActive()) return;
        if (e.button != null && e.button !== 0) return;
        const targetPet = storyPetForFeedActor(selectedActor());
        drag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            scrollLocked: false,
            ghost: null,
            foodItem: storyFeedFood(activity, index, targetPet),
            scroller: btn.closest?.('.mh-story-action-strip'),
            lastScrollX: e.clientX,
        };
        try { btn.setPointerCapture?.(e.pointerId); } catch (_) {}
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
    });
}

export function normalizeStoryPath(path) {
    const text = String(path || '').trim().replace(/^\/+/, '');
    if (!text) return 'pet-story/story_of_dragons.json';
    if (/^https?:\/\//i.test(text)) return text;
    if (text.startsWith('pet-story/') || text.startsWith('stories/')) return text;
    return `pet-story/${text}`;
}

function parseStoryShareParams() {
    const url = new URL(window.location.href);
    const fromUsername = (url.searchParams.get('storyFrom') || '').trim();
    const story = (url.searchParams.get('story') || '').trim();
    return { fromUsername, story };
}

function safeStoryShareUsername(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function remoteStoryPath(filename) {
    const clean = String(filename || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
    if (!clean || clean.includes('..') || /^https?:\/\//i.test(clean)) return '';
    return clean.startsWith('stories/') ? clean : `stories/${clean}`;
}

async function loadRemoteWorkspaceStory(fromUsername, filename) {
    const username = safeStoryShareUsername(fromUsername);
    const filePath = remoteStoryPath(filename);
    if (!username || !filePath || !state.sdk?.personalPageStore?.readFile) return null;
    const absolutePath = `//${username}/edunotes/store/${CONFIG.workspace}/${filePath}`;
    try {
        const text = await state.sdk.personalPageStore.readFile(absolutePath, 1, 99999);
        if (!text) return null;
        const story = JSON.parse(text);
        if (!story || typeof story !== 'object') return null;
        return { ...story, sourcePath: absolutePath };
    } catch (e) {
        console.warn('读取分享故事失败', e);
        return null;
    }
}

function normalizeStory(story, sourcePath) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    return {
        id: story?.id || sourcePath,
        title: story?.title || '宠物故事',
        sourcePath,
        version: story?.version || 1,
        actors: Array.isArray(story?.actors) ? story.actors : [],
        startSceneId: story?.startSceneId || scenes[0]?.id || 'scene_1',
        scenes,
        ending: story?.ending || {},
    };
}

function currentScene() {
    if (!runtime?.story) return null;
    return runtime.story.scenes.find(scene => scene.id === runtime.sceneId) || runtime.story.scenes[runtime.sceneIndex] || null;
}

function actorById(id) {
    return runtime?.story?.actors?.find(actor => actor.id === id) || null;
}

function selectedActor() {
    return actorById(runtime?.selectedActorId) || runtime?.story?.actors?.[0] || null;
}

function resolveLine(line) {
    if (!line || typeof line !== 'object') return null;
    let actor = actorById(line.actor);
    if (line.actor === '$selected') actor = selectedActor();
    return { ...line, actor };
}

function sceneTimeline(scene) {
    const legacySubtitle = (scene?.subtitle || '').trim();
    const legacySubtitleLine = legacySubtitle ? [{ kind: 'line', actor: '$narrator', text: legacySubtitle }] : [];
    if (Array.isArray(scene?.timeline) && scene.timeline.length) {
        if (legacySubtitle && !scene.timeline.some(item => item?.kind === 'line' && item.actor === '$narrator' && (item.text || '').trim() === legacySubtitle)) {
            return [...legacySubtitleLine, ...scene.timeline];
        }
        return scene.timeline;
    }
    return [
        ...legacySubtitleLine,
        ...(Array.isArray(scene?.lines) ? scene.lines.map(line => ({ kind: 'line', ...line })) : []),
        ...(Array.isArray(scene?.activities) ? scene.activities.map(activity => ({ kind: 'activity', ...activity })) : []),
    ];
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

function sceneBackground(scene) {
    const color = sceneFallbackColor(scene);
    const imageUrl = sceneBackgroundImageUrl(scene);
    if (imageUrl) return `linear-gradient(rgba(255,255,255,.12),rgba(255,255,255,.12)), url("${String(imageUrl).replace(/"/g, '%22')}")`;
    return `radial-gradient(circle at 50% 12%,rgba(255,255,255,.86),transparent 34%), linear-gradient(180deg, ${color}, #ffffff)`;
}

function sceneFallbackColor(scene) {
    const bg = scene?.background || {};
    return bg.color || scene?.bgColor || '#bae6fd';
}

function sceneBackgroundImageUrl(scene) {
    const bg = scene?.background || {};
    return String(bg.imageUrl || scene?.backgroundImage || '').trim();
}

function hasSceneBackgroundImage(scene) {
    return !!sceneBackgroundImageUrl(scene);
}

function sceneBgMusic(scene) {
    return String(scene?.bgMusic || scene?.background?.bgMusic || '').trim();
}

function renderMusicToggleButton(track) {
    if (!track) return '';
    const muted = soundManager.isBgMusicMuted?.();
    return `<button type="button" class="mh-story-music-toggle ${muted ? 'is-muted' : ''}" data-story-music-toggle aria-label="${muted ? '开启音乐' : '静音'}" title="${muted ? '开启音乐' : '静音'}">${muted ? '♪' : '♫'}</button>`;
}

function syncSceneBgMusic(scene, { paused = false } = {}) {
    if (paused) {
        if (runtime?.storyBgMusicActive) {
            soundManager.stopBgMusic({ fadeMs: 700 });
            runtime.storyBgMusicActive = false;
        }
        return;
    }
    const music = sceneBgMusic(scene);
    if (music) {
        soundManager.playBgMusic(music, { fadeMs: 1000, volume: 0.3 });
        if (runtime) runtime.storyBgMusicActive = true;
    } else if (runtime?.storyBgMusicActive) {
        soundManager.stopBgMusic({ fadeMs: 700 });
        runtime.storyBgMusicActive = false;
    }
}

export function disposeStoryPlayer() {
    clearTimelineTimer();
    if (runtime?.storySceneResizeHandler) {
        window.removeEventListener('resize', runtime.storySceneResizeHandler);
        runtime.storySceneResizeHandler = null;
    }
    if (runtime?.storyBgMusicActive) {
        soundManager.stopBgMusic({ fadeMs: 520 });
        runtime.storyBgMusicActive = false;
    }
}

function activityCount(activity) {
    const count = Number(activity?.count ?? activity?.times ?? 1);
    return Math.max(1, Number.isFinite(count) ? Math.round(count) : 1);
}

function activityType(activity) {
    const type = String(activity?.type || '').trim().toLowerCase();
    const text = `${activity?.title || ''} ${activity?.label || ''} ${activity?.action || ''}`;
    if (type === 'encourage' || /轻拍/.test(text) || (/鼓励/.test(text) && !type)) return 'tap';
    if (type === 'clean') return 'bath';
    return ['feed', 'bath', 'tap', 'minigame'].includes(type) ? type : 'tap';
}

function activityKey(activity, index) {
    return `${runtime.sceneId}:${index}:${activityType(activity) || 'activity'}`;
}

function activityTargetId(activity) {
    return String(activity?.target || activity?.actor || activity?.actorId || '').trim();
}

function isActorAllowedForActivity(activity, actor) {
    const targetId = activityTargetId(activity);
    if (!targetId) return true;
    const resolvedTargetId = targetId === '$selected' ? selectedActor()?.id : targetId;
    return !!actor?.id && actor.id === resolvedTargetId;
}

function activityProgress(activity, index) {
    if (runtime?.completedNotified && !runtime?.replayUnlocked) return activityCount(activity);
    return runtime.activityProgress[activityKey(activity, index)] || 0;
}

function sceneActivities(scene) {
    return sceneTimeline(scene).filter(item => item?.kind === 'activity' || item?.type);
}

function isTimelineActivity(item) {
    return item?.kind === 'activity' || !!item?.type;
}

function timelineActivityIndex(timeline, itemIndex) {
    let activityIndex = -1;
    for (let index = 0; index <= itemIndex && index < timeline.length; index += 1) {
        if (isTimelineActivity(timeline[index])) activityIndex += 1;
    }
    return activityIndex;
}

function timelineIndexForActivity(timeline, activityIndex) {
    let currentActivityIndex = -1;
    for (let index = 0; index < timeline.length; index += 1) {
        if (!isTimelineActivity(timeline[index])) continue;
        currentActivityIndex += 1;
        if (currentActivityIndex === activityIndex) return index;
    }
    return -1;
}

function currentTimeline() {
    return sceneTimeline(currentScene());
}

function saveScenePlaybackState() {
    if (!runtime?.sceneId) return;
    runtime.scenePlayback[runtime.sceneId] = {
        timelineIndex: runtime.timelineIndex || 0,
        revealedChars: runtime.revealedChars || 0,
    };
}

function restoreScenePlaybackState(sceneId) {
    const saved = runtime?.scenePlayback?.[sceneId] || null;
    const scene = runtime?.story?.scenes?.find(item => item.id === sceneId) || null;
    const completedIndex = runtime?.completedNotified && !runtime?.replayUnlocked ? sceneTimeline(scene).length : 0;
    runtime.timelineIndex = Math.max(0, saved?.timelineIndex ?? completedIndex);
    runtime.revealedChars = Math.max(0, saved?.revealedChars ?? 0);
}

function skipCompletedActiveActivities(scene) {
    const timeline = sceneTimeline(scene);
    runtime.timelineIndex = Math.max(0, Math.min(runtime.timelineIndex || 0, timeline.length));
    while (runtime.timelineIndex < timeline.length) {
        const item = timeline[runtime.timelineIndex];
        if (!isTimelineActivity(item)) break;
        const activityIndex = timelineActivityIndex(timeline, runtime.timelineIndex);
        if (activityProgress(item, activityIndex) < activityCount(item)) break;
        runtime.timelineIndex += 1;
        runtime.revealedChars = 0;
    }
}

function isSceneComplete(scene) {
    if (runtime?.completedNotified && !runtime?.replayUnlocked) return true;
    return (runtime?.timelineIndex || 0) >= sceneTimeline(scene).length
        && sceneActivities(scene).every((activity, index) => activityProgress(activity, index) >= activityCount(activity));
}

function storyPetForActor(actor) {
    if (!actor) return null;
    if (actor.petId && state.pets?.[actor.petId]) return state.pets[actor.petId];
    if (actor.sourcePetId && state.pets?.[actor.sourcePetId]) return state.pets[actor.sourcePetId];
    const template = actor.petTemplate || actor.pet || null;
    if (!template) return null;
    return {
        id: template.id || actor.sourcePetId || actor.petId || actor.id || 'story_pet',
        name: actor.name || template.name || '抱抱龙',
        stage: template.stage || 'adult',
        imageSheetUrl: template.imageSheetUrl || '',
        dna: template.dna || '',
        traits: template.traits || {},
        stats: template.stats || { hunger: 100, mood: 100, clean: 100, bond: 80 },
        anim: template.anim || 'idle',
    };
}

function timelineActorId(actorId) {
    if (actorId === '$selected') return selectedActor()?.id || '';
    if (actorId === '$narrator') return '';
    return actorId || '';
}

function storyActorBaseWidthPercent(total) {
    const hero = runtime?.panel?.querySelector?.('[data-story-hero]');
    const heroWidth = hero?.clientWidth || runtime?.panel?.clientWidth || window.innerWidth || 430;
    const cssWidth = Math.min(31, (128 / Math.max(1, heroWidth)) * 100);
    const countFitWidth = total > 1 ? 94 / (total - (STORY_ACTOR_MAX_OVERLAP * (total - 1))) : cssWidth;
    return Math.max(14, Math.min(cssWidth, countFitWidth));
}

function storyActorSizePx(total) {
    const hero = runtime?.panel?.querySelector?.('[data-story-hero]');
    const heroWidth = hero?.clientWidth || runtime?.panel?.clientWidth || window.innerWidth || 430;
    return Math.max(58, Math.min(128, Math.round((storyActorBaseWidthPercent(total) / 100) * heroWidth)));
}

function repelStageActorStyles(items) {
    if (items.length <= 1) return items;
    const baseWidth = storyActorBaseWidthPercent(items.length);
    const nextItems = items.map(item => {
        const renderScale = item.speaking ? item.style.scale * 1.16 : item.style.scale;
        const width = baseWidth * renderScale;
        return {
            ...item,
            style: { ...item.style, left: clampRange(item.style.left, width / 2 + 2, 100 - width / 2 - 2) },
            width,
        };
    });

    for (let iteration = 0; iteration < 12; iteration += 1) {
        let moved = false;
        nextItems.sort((leftItem, rightItem) => leftItem.style.left - rightItem.style.left);
        for (let index = 0; index < nextItems.length - 1; index += 1) {
            const leftItem = nextItems[index];
            const rightItem = nextItems[index + 1];
            const minDistance = ((leftItem.width + rightItem.width) / 2) * (1 - STORY_ACTOR_MAX_OVERLAP);
            const distance = rightItem.style.left - leftItem.style.left;
            if (distance >= minDistance) continue;
            const push = (minDistance - distance) / 2;
            leftItem.style.left -= push;
            rightItem.style.left += push;
            moved = true;
        }
        nextItems.forEach((item) => {
            const minLeft = item.width / 2 + 2;
            const maxLeft = 100 - item.width / 2 - 2;
            item.style.left = clampRange(item.style.left, minLeft, maxLeft);
        });
        if (!moved) break;
    }
    return nextItems.sort((leftItem, rightItem) => leftItem.index - rightItem.index);
}

function storyCastFocusPanPx(items) {
    const speakingItem = items.find(item => item.speaking);
    if (!speakingItem) return 0;
    const hero = runtime?.panel?.querySelector?.('[data-story-hero]');
    const heroWidth = hero?.clientWidth || runtime?.panel?.clientWidth || window.innerWidth || 430;
    const actorSize = storyActorSizePx(items.length);
    const actorScale = (speakingItem.style.scale || 1) * 1.16 * 1.08;
    const actorHalf = (actorSize * actorScale) / 2;
    const speechHalf = Math.min(260, heroWidth * 0.74) / 2;
    const focusHalf = Math.max(actorHalf, speechHalf) + STORY_DIALOGUE_EDGE_MARGIN;
    const center = (speakingItem.style.left / 100) * heroWidth;
    if (center - focusHalf < STORY_DIALOGUE_EDGE_MARGIN) return STORY_DIALOGUE_EDGE_MARGIN - (center - focusHalf);
    if (center + focusHalf > heroWidth - STORY_DIALOGUE_EDGE_MARGIN) return (heroWidth - STORY_DIALOGUE_EDGE_MARGIN) - (center + focusHalf);
    return 0;
}

function stageCueStyle(cue, index, total, isActive = false) {
    const text = String(cue || '').toLowerCase();
    let left = total <= 1 ? 50 : 32 + (36 * index / Math.max(1, total - 1));
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
    if (isActive) { bottom = 26; scale = Math.max(scale, 1.04); }
    return { left, bottom, scale, mood };
}

function renderStageActors(timeline, activeItemIndex) {
    const actors = Array.isArray(runtime?.story?.actors) ? runtime.story.actors : [];
    const activeItem = timeline?.[activeItemIndex] || null;
    const activeActorId = !isTimelineActivity(activeItem) ? timelineActorId(activeItem?.actor) : '';
    const activeCue = !isTimelineActivity(activeItem) ? splitStageText(activeItem?.text || activeItem?.say || '').cue : '';
    const speechText = !isTimelineActivity(activeItem) ? revealText(activeSpeechText(activeItem), runtime?.revealedChars || 0) : '';
    const visibleActors = actors.map(actor => ({ actor, pet: storyPetForActor(actor) })).filter(item => item.pet);
    const layoutItems = repelStageActorStyles(visibleActors.map(({ actor, pet }, index) => {
        const speaking = actor.id === activeActorId;
        const cue = speaking ? activeCue : '';
        return { actor, pet, index, speaking, style: stageCueStyle(cue, index, visibleActors.length, speaking) };
    }));
    const cast = layoutItems.map(({ actor, pet, speaking, style }) => {
        return `
            <div class="mh-story-stage-actor pet-sprite ${speaking ? 'is-speaking' : ''} ${activeActorId && !speaking ? 'is-listening' : ''} ${style.mood ? `is-${style.mood}` : ''}" data-story-actor-stage="${escapeHtml(actor.id)}" style="left:${style.left}%;bottom:${style.bottom}%;--stage-scale:${style.scale}">
                ${speaking ? `<div class="mh-story-speech-bubble"><span data-story-speech-text>${escapeHtml(speechText)}</span></div>` : ''}
                ${petArtHtml(pet, { alt: actor.name || pet.name || '', extraClass: speaking ? 'pop-in' : 'floaty', requireProcessedTexture: true })}
                <div class="mh-story-actor-foot-name">${escapeHtml(actor.name || pet.name || '角色')}</div>
            </div>`;
    }).join('');
    const focusPan = storyCastFocusPanPx(layoutItems);
    return `<div class="mh-story-stage-cast ${activeActorId ? 'is-zooming is-interaction-locked' : ''}" style="--story-actor-size:${storyActorSizePx(visibleActors.length)}px;--story-cast-pan:${focusPan.toFixed(1)}px">${cast}</div>`;
}

function actorCard(actor, selected = false) {
    const pet = storyPetForActor(actor);
    return `
        <button type="button" class="mh-story-actor ${selected ? 'is-selected' : ''}" data-story-actor="${escapeHtml(actor.id)}">
            <span class="mh-story-actor-art">${pet ? petArtHtml(pet, { alt: actor.name || '', requireProcessedTexture: false }) : '<span class="mh-story-fallback-art">?</span>'}</span>
            <span class="mh-story-actor-name">${escapeHtml(actor.name || '角色')}</span>
            ${actor.color ? `<span class="mh-story-actor-sub">${escapeHtml(actor.color)}</span>` : ''}
        </button>`;
}

function mountStoryActorPets(root) {
    if (!root || !runtime?.story?.actors) return;
    const petsById = new Map();
    runtime.story.actors.forEach((actor) => {
        const pet = storyPetForActor(actor);
        if (pet?.id) petsById.set(String(pet.id), pet);
    });
    root.querySelectorAll('[data-mh-pet]').forEach((el) => {
        const pet = petsById.get(el.getAttribute('data-mh-pet') || '');
        if (!pet) return;
        mountPetArt(el, pet);
        const processed = getProcessedSheet(pet.imageSheetUrl || '');
        if (processed?.status !== 'loaded' && processed?.promise && !el.__mhStoryRemountAfterProcess) {
            el.__mhStoryRemountAfterProcess = true;
            processed.promise.finally(() => {
                el.__mhStoryRemountAfterProcess = false;
                if (root.isConnected) mountStoryActorPets(root);
            });
        }
    });
}

function renderLine(line, revealedChars = Infinity) {
    const actor = line.actor || null;
    const name = actor?.name || line.actorName || '旁白';
    const text = revealText(visibleLineText(line.text || line.say || ''), revealedChars);
    return `
        <div class="mh-story-line ${actor ? '' : 'is-narrator'}">
            <b>${escapeHtml(name)}</b>
            <span>${escapeHtml(text)}</span>
        </div>`;
}

function renderActivity(activity, index) {
    const type = activityType(activity);
    const done = activityProgress(activity, index);
    const total = activityCount(activity);
    const complete = done >= total;
    const title = activity.title || ACTIVITY_LABELS[type] || '互动';
    const detail = type === 'minigame'
        ? (activity.gameTitle || activity.gameId || '小游戏')
        : (activity.hint || ACTIVITY_LABELS[type] || '和宠物完成互动');
    return `
        <div class="mh-story-task ${complete ? 'is-complete' : ''}">
            <div>
                <strong>${escapeHtml(title)} × ${total}</strong>
                <small>${escapeHtml(detail)} · ${Math.min(done, total)}/${total}</small>
            </div>
            <span class="mh-story-task-state">${complete ? '完成' : '进行中'}</span>
        </div>`;
}

function storyFeedFood(activity, activityIndex, pet = null) {
    if (!runtime) return null;
    const key = activityKey(activity, activityIndex);
    if (!runtime.feedFoodItems[key]) {
        runtime.feedFoodItems[key] = pickRandomPreferredFood(pet || storyPetForActor(selectedActor())) || null;
    }
    return runtime.feedFoodItems[key];
}

function activityIcon(activity, activityIndex) {
    const type = activityType(activity);
    if (type === 'feed') return storyFeedFood(activity, activityIndex)?.emoji || '🍪';
    if (type === 'bath' || type === 'clean') return '🫧';
    if (type === 'tap') return '👆';
    if (type === 'minigame') return '🎾';
    return '✨';
}

function renderActionButton(activity, activityIndex, { current = false, locked = false } = {}) {
    if (!activity) return '<button type="button" class="btn-secondary" disabled>播放中...</button>';
    const type = activityType(activity);
    const done = activityProgress(activity, activityIndex);
    const total = activityCount(activity);
    const left = Math.max(0, total - done);
    const title = type === 'tap' ? ACTIVITY_LABELS.tap : (activity.title || ACTIVITY_LABELS[type] || '互动');
    const badge = left <= 0 ? '✓' : String(left);
    return `
        <button type="button" class="btn-secondary action-btn dock-icon-btn mh-story-dock-action ${type === 'feed' ? 'is-feed-action' : ''} ${current ? 'is-current' : ''} ${left <= 0 ? 'is-complete' : ''}" data-story-activity="${activityIndex}"${dockDisabledAttrs(locked, '对白播放中，先点击继续看完当前对白。')}>
            <span class="mh-story-action-badge" aria-hidden="true">${badge}</span>
            <span class="dock-icon">${activityIcon(activity, activityIndex)}</span>
            <span class="dock-label">${escapeHtml(title)}</span>
        </button>`;
}

function renderHeroContinue(activeItem, canContinue, isLastScene) {
    if (isTimelineActivity(activeItem)) return '';
    const isLine = !!activeItem;
    const label = isLine ? '点击继续' : '';
    if (!label) return '';
    const id = isLine ? 'mhStoryContinue' : 'mhStoryNext';
    return `
        <div class="mh-story-hero-continue">
            <button type="button" class="mh-story-continue-hit" id="${id}" ${!isLine && !canContinue ? 'disabled' : ''}>
                <span>${label}</span>
            </button>
        </div>`;
}

function renderStepButton(activeItem) {
    if (!activeItem || isTimelineActivity(activeItem)) return '';
    const fullLength = Array.from(activeSpeechText(activeItem)).length;
    const animating = (runtime?.revealedChars || 0) < fullLength;
    return `
        <button type="button" class="btn-secondary action-btn dock-icon-btn mh-story-step-action ${animating ? 'is-highlight' : ''}" data-story-step>
            <span class="dock-icon">›</span>
            <span class="dock-label">下一步</span>
        </button>`;
}

function renderStoryActionDock(scene, timeline, activeItem, activeActivityIndex, canContinue) {
    const interactionsLocked = isDialogueActive();
    const reachedActivities = sceneActivities(scene)
        .map((activity, index) => ({ activity, index, timelineIndex: timelineIndexForActivity(timeline, index) }))
        .filter(item => item.timelineIndex >= 0 && item.timelineIndex <= (runtime.timelineIndex || 0));
    const actionButtons = reachedActivities
        .map(item => renderActionButton(item.activity, item.index, { current: activeActivityIndex === item.index, locked: interactionsLocked }))
        .join('');
    const hasPrevious = runtime.sceneIndex > 0;
    const isLastScene = runtime.sceneIndex >= runtime.story.scenes.length - 1;
    const nextLabel = isLastScene ? '完成故事' : '下一页';
    const rightControl = canContinue
        ? `<button type="button" class="btn-primary dock-icon-btn mh-story-page-arrow is-next" data-story-next-page aria-label="${nextLabel}" title="${nextLabel}">›</button>`
        : '<span class="mh-story-page-arrow mh-story-page-arrow-placeholder"></span>';
    return `
        <div class="mh-story-actions">
            <button type="button" class="btn-secondary dock-icon-btn mh-story-page-arrow" data-story-prev-page${dockDisabledAttrs(!hasPrevious, '已经是第一页。')} aria-label="上一页" title="上一页">‹</button>
            <div class="mh-story-action-strip">
                ${actionButtons || '<span class="mh-story-action-placeholder"> </span>'}
            </div>
            ${rightControl}
        </div>`;
}

function activeLineText(item) {
    if (!item || isTimelineActivity(item)) return '';
    const line = resolveLine(item);
    const name = line?.actor?.name || line?.actorName || '旁白';
    return `${name}：${visibleLineText(line?.text || line?.say || '')}`;
}

function activeSpeechText(item) {
    if (!item || isTimelineActivity(item)) return '';
    const line = resolveLine(item);
    return visibleLineText(line?.text || line?.say || '');
}

function activeNarratorText(item) {
    if (!item || isTimelineActivity(item)) return '';
    if (timelineActorId(item.actor) || item.actor !== '$narrator') return '';
    return revealText(activeSpeechText(item), runtime?.revealedChars || 0);
}

function isNarratorLine(item) {
    return !!item && !isTimelineActivity(item) && item.actor === '$narrator';
}

function activeSubtitle(story, scene, timeline) {
    const item = timeline[runtime.timelineIndex] || null;
    if (!item) return '这一幕完成啦。';
    if (isTimelineActivity(item)) {
        return '';
    }
    return revealText(activeLineText(item), runtime.revealedChars || 0);
}

function updateActiveSpeechText(panel) {
    if (!panel || !runtime) return;
    const item = currentTimeline()[runtime.timelineIndex];
    const text = revealText(activeSpeechText(item), runtime.revealedChars || 0);
    panel.querySelectorAll('[data-story-speech-text]').forEach(el => { el.textContent = text; });
    const narrator = panel.querySelector('[data-story-narrator-text]');
    if (narrator) narrator.textContent = activeNarratorText(item);
}

function clearTimelineTimer() {
    if (runtime?.timelineTimer) clearTimeout(runtime.timelineTimer);
    if (runtime) runtime.timelineTimer = null;
}

function resetScenePlayback() {
    clearTimelineTimer();
    runtime.timelineIndex = 0;
    runtime.revealedChars = 0;
}

function scheduleTimelinePlayback(panel, options) {
    clearTimelineTimer();
    if (!runtime || runtime.finished || runtime.pendingMinigame) return;
    const timeline = currentTimeline();
    const item = timeline[runtime.timelineIndex];
    if (!item || isTimelineActivity(item)) return;
    const fullText = activeSpeechText(item);
    if ((runtime.revealedChars || 0) >= Array.from(fullText).length) return;
    runtime.timelineTimer = setTimeout(() => {
        if (!runtime || runtime.finished) return;
        runtime.revealedChars = Math.min(Array.from(fullText).length, (runtime.revealedChars || 0) + 1);
        updateActiveSpeechText(panel);
        scheduleTimelinePlayback(panel, options);
    }, STORY_LINE_REVEAL_MS);
}

function continueTimelineLine(panel, options) {
    if (!runtime || runtime.finished || runtime.pendingMinigame) return;
    const timeline = currentTimeline();
    const item = timeline[runtime.timelineIndex];
    if (!item || isTimelineActivity(item)) return;
    const fullLength = Array.from(activeSpeechText(item)).length;
    if ((runtime.revealedChars || 0) < fullLength) {
        runtime.revealedChars = fullLength;
        updateActiveSpeechText(panel);
        scheduleTimelinePlayback(panel, options);
    } else {
        runtime.timelineIndex = Math.min(timeline.length, (runtime.timelineIndex || 0) + 1);
        runtime.revealedChars = 0;
        renderStoryPlayer(panel, { story: runtime.story }, options);
    }
}

function isDialogueActive() {
    if (!runtime || runtime.finished || runtime.pendingMinigame) return false;
    const item = currentTimeline()[runtime.timelineIndex];
    return !!item && !isTimelineActivity(item);
}

function isStoryPetSpeaking() {
    if (!isDialogueActive()) return false;
    const item = currentTimeline()[runtime.timelineIndex];
    return !!timelineActorId(item?.actor);
}

function sceneIndexOf(sceneId) {
    return runtime.story.scenes.findIndex(scene => scene.id === sceneId);
}

function goPrev(panel, options) {
    if (!runtime) return;
    if (runtime.finished) {
        runtime.finished = false;
        restoreScenePlaybackState(runtime.sceneId);
        renderStoryPlayer(panel, { story: runtime.story }, options);
        return;
    }
    if (runtime.sceneIndex <= 0) return;
    saveScenePlaybackState();
    const prevIndex = runtime.sceneIndex - 1;
    runtime.sceneIndex = prevIndex;
    runtime.sceneId = runtime.story.scenes[prevIndex].id;
    restoreScenePlaybackState(runtime.sceneId);
    renderStoryPlayer(panel, { story: runtime.story }, options);
}

function goNext(panel, options) {
    const scene = currentScene();
    if (scene && !isSceneComplete(scene)) return;
    saveScenePlaybackState();
    const explicitNext = scene?.nextSceneId;
    const nextIndex = explicitNext ? sceneIndexOf(explicitNext) : runtime.sceneIndex + 1;
    if (nextIndex >= 0 && nextIndex < runtime.story.scenes.length) {
        runtime.sceneIndex = nextIndex;
        runtime.sceneId = runtime.story.scenes[nextIndex].id;
        restoreScenePlaybackState(runtime.sceneId);
        renderStoryPlayer(panel, { story: runtime.story }, options);
        return;
    }
    clearTimelineTimer();
    runtime.finished = true;
    notifyStoryFinished(options);
    renderStoryPlayer(panel, { story: runtime.story }, options);
}

function notifyStoryFinished(options = {}) {
    if (!runtime || runtime.completedNotified) return;
    runtime.completedNotified = true;
    options.onStoryFinished?.(runtime.story, selectedActor());
}

function startUnlockedReplay(panel, options) {
    if (!runtime?.story) return;
    clearTimelineTimer();
    const story = runtime.story;
    const startIndex = Math.max(0, story.scenes.findIndex(scene => scene.id === story.startSceneId));
    runtime.sceneIndex = startIndex;
    runtime.sceneId = story.scenes[startIndex]?.id || story.startSceneId;
    runtime.timelineIndex = 0;
    runtime.revealedChars = 0;
    runtime.activityProgress = {};
    runtime.pendingMinigame = null;
    runtime.finished = false;
    runtime.actorConfirmed = true;
    runtime.replayUnlocked = false;
    runtime.completedNotified = false;
    runtime.scenePlayback = {};
    runtime.feedFoodItems = {};
    renderStoryPlayer(panel, { story }, options);
}

function completeActivity(index, panel, options) {
    const scene = currentScene();
    const activity = sceneActivities(scene)[index];
    if (!activity) return;
    const key = activityKey(activity, index);
    const previous = runtime.activityProgress[key] || 0;
    const total = activityCount(activity);
    runtime.activityProgress[key] = Math.min(total, previous + 1);
    const timeline = currentTimeline();
    const activityTimelineIndex = timelineIndexForActivity(timeline, index);
    if (previous < total && runtime.activityProgress[key] >= total && runtime.timelineIndex === activityTimelineIndex) {
        runtime.timelineIndex = Math.min(currentTimeline().length, (runtime.timelineIndex || 0) + 1);
        runtime.revealedChars = 0;
    }
    renderStoryPlayer(panel, { story: runtime.story }, options);
}

function actorForActivity(activity) {
    const actorId = activityTargetId(activity) || '$selected';
    if (actorId === '$selected') return selectedActor();
    return actorById(actorId) || selectedActor();
}

function petForActivity(activity) {
    const actorPet = storyPetForActor(actorForActivity(activity));
    return state.pets?.[actorPet?.id] || state.pets?.[state.currentPetId] || actorPet || null;
}

function petElementForActivity(activity, panel) {
    const actor = actorForActivity(activity);
    const actorEl = actor?.id
        ? Array.from(panel.querySelectorAll('[data-story-actor-stage]')).find(el => el.dataset.storyActorStage === actor.id)
        : null;
    return actorEl || panel.querySelector('.mh-story-stage-actor.is-speaking') || panel.querySelector('.mh-story-stage-actor');
}

function petElementForActor(actor, panel) {
    return actor?.id
        ? Array.from(panel.querySelectorAll('[data-story-actor-stage]')).find(el => el.dataset.storyActorStage === actor.id)
        : null;
}

function storyPetForFeedActor(actor) {
    const actorPet = storyPetForActor(actor || selectedActor());
    return state.pets?.[actorPet?.id] || actorPet || state.pets?.[state.currentPetId] || null;
}

async function runPetActivity(activity, panel, options, index, interactionOptions = {}) {
    const type = activityType(activity);
    const pet = interactionOptions.targetPet || petForActivity(activity);
    const petEl = interactionOptions.targetPetEl || petElementForActivity(activity, panel);
    let ok = false;
    let feedFoodItem = null;
    if (type === 'feed') {
        const onFeedItem = interactionOptions.onFeedItem || (interactionOptions.useFeedCallback === false ? null : options?.onFeedItem);
        feedFoodItem = interactionOptions.foodItem || storyFeedFood(activity, index, pet);
        ok = await runFeedInteraction({ pet, petEl, foodItem: feedFoodItem, onFeedItem, source: 'story' });
    } else if (type === 'bath' || type === 'clean') {
        ok = await runBathInteraction({ pet, petEl, stage: panel.querySelector('.mh-story-hero'), onAction: options?.onPetAction });
    } else if (type === 'tap') {
        ok = true;
        if (interactionOptions.showCenterPrompt) showStoryCenterPrompt(activity.title || activity.hint || activity.successText || ACTIVITY_LABELS.tap);
        if (ok && !interactionOptions.skipTouchFeedback) runTouchInteraction(petEl, pet);
    } else {
        ok = false;
    }
    if (ok) {
        const line = activity.successText || (type === 'feed' ? '好吃！' : type === 'clean' || type === 'bath' ? '香香的！' : type === 'tap' ? '我收到你的轻拍啦！' : '我感觉好多啦');
        const lineDuration = type === 'tap' ? STORY_TAP_FEEDBACK_MS : 2200;
        requestAnimationFrame(() => sayOnPet(petEl, line, lineDuration));
        if (type === 'feed') await wait(foodEatDurationMs(feedFoodItem) + 160);
        if (type === 'tap') await wait(STORY_TAP_FEEDBACK_MS);
        completeActivity(index, panel, options);
    }
}

async function runFeedStoryActivity(activity, panel, options, index, { actor = null, showDragHint = false } = {}) {
    const targetActor = actor || actorForActivity(activity) || selectedActor();
    if (!isActorAllowedForActivity(activity, targetActor)) {
        showStoryCenterPrompt('换一个目标试试');
        return;
    }
    const targetPet = storyPetForFeedActor(targetActor);
    const targetPetEl = petElementForActor(targetActor, panel) || petElementForActivity(activity, panel);
    const foodItem = storyFeedFood(activity, index, targetPet);
    const shouldApplyToMainPet = targetActor?.id === selectedActor()?.id && targetPet?.id === state.currentPetId;
    if (showDragHint) showToast('拖动可喂食', 'info', 1500);
    await runPetActivity(activity, panel, options, index, {
        targetPet,
        targetPetEl,
        foodItem,
        useFeedCallback: shouldApplyToMainPet,
        onFeedItem: shouldApplyToMainPet ? null : async () => true,
    });
}

export function completeStoryMinigameActivity(result = {}) {
    if (!runtime?.pendingMinigame || !runtime.panel) return false;
    const { index } = runtime.pendingMinigame;
    runtime.pendingMinigame = null;
    if (result.completed === false || result.passed === false) {
        showToast('小游戏还没有完成，再试一次吧', 'info', 1800);
        return false;
    }
    completeActivity(index, runtime.panel, runtime.options || {});
    return true;
}

export function renderStoryPlayer(panel, data = {}, options = {}) {
    const story = data.story || runtime?.story;
    if (!story) {
        panel.innerHTML = '<div style="padding:18px;color:var(--text-muted)">正在加载故事...</div>';
        return;
    }
    const sessionKey = options.sessionKey || story.id || story.sourcePath || 'story';
    if (!runtime || runtime.story?.id !== story.id || runtime.sessionKey !== sessionKey) {
        const startIndex = Math.max(0, story.scenes.findIndex(scene => scene.id === story.startSceneId));
        const completedInitial = !!options.initialFinished;
        const initialSceneIndex = completedInitial ? Math.max(0, story.scenes.length - 1) : startIndex;
        runtime = {
            story,
            sessionKey,
            sceneIndex: initialSceneIndex,
            sceneId: story.scenes[initialSceneIndex]?.id || story.startSceneId,
            timelineIndex: completedInitial ? sceneTimeline(story.scenes[initialSceneIndex]).length : 0,
            selectedActorId: options.initialActorId || story.actors.find(actor => actor.allowUserSelection)?.id || story.actors[0]?.id || '',
            activityProgress: {},
            finished: completedInitial,
            replayUnlocked: false,
            actorConfirmed: !!options.initialActorId || completedInitial,
            completedNotified: completedInitial,
            pendingMinigame: null,
            storyBgMusicActive: false,
            revealedChars: 0,
            scenePlayback: {},
            scenePanById: {},
            feedFoodItems: {},
        };
    }
    clearTimelineTimer();
    runtime.panel = panel;
    runtime.options = options;
    if (runtime.storySceneResizeHandler) {
        window.removeEventListener('resize', runtime.storySceneResizeHandler);
        runtime.storySceneResizeHandler = null;
    }

    const scene = currentScene();
    const selectableActors = story.actors.filter(actor => actor.allowUserSelection);
    const needsActorSelect = selectableActors.length > 1 && !runtime.actorConfirmed;
    syncSceneBgMusic(scene, { paused: needsActorSelect || runtime.finished });
    const mainPet = storyPetForActor(selectedActor());
    skipCompletedActiveActivities(scene);
    const timeline = sceneTimeline(scene);
    runtime.timelineIndex = Math.max(0, Math.min(runtime.timelineIndex || 0, timeline.length));
    const activeItem = timeline[runtime.timelineIndex] || null;
    const activeActivityIndex = isTimelineActivity(activeItem) ? timelineActivityIndex(timeline, runtime.timelineIndex) : -1;
    const canContinue = scene ? isSceneComplete(scene) : true;
    const progressText = scene ? `${runtime.sceneIndex + 1}/${story.scenes.length}` : '完成';
    const endingText = story.ending?.subtitle || '故事完成啦。';

    panel.innerHTML = `
        <style>
            ${sceneParticleCss()}
            .mh-story-root { position:absolute; inset:0; display:flex; flex-direction:column; background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 45%,#fef3c7 100%); color:var(--text-primary); }
            .mh-story-stage { flex:1; min-height:0; overflow:hidden; padding:0; display:flex; flex-direction:column; }
            .mh-story-hero { flex:1; width:100%; max-width:none; min-height:0; align-self:stretch; border-radius:0; border:0; background:var(--mh-story-hero-bg,#bae6fd); display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; box-shadow:none; touch-action:pan-y; }
            .mh-story-hero.has-action { padding-bottom:64px; }
            .mh-story-scene { position:absolute; inset:0 auto 0 0; width:100%; background:var(--mh-story-scene-bg); background-size:cover; background-position:center; overflow:hidden; will-change:transform; transform:translate3d(0,0,0); }
            .mh-story-scene.is-image-bg { background-size:100% 100%, 100% 100%; background-position:center, center; background-repeat:no-repeat; }
            .mh-story-scene-label { display:none; }
            .mh-story-music-toggle { position:absolute; top:10px; right:10px; z-index:6; width:34px; height:34px; border-radius:11px; border:2px solid rgba(255,255,255,.92); background:rgba(14,165,233,.92); color:white; font-size:18px; font-weight:900; line-height:1; display:grid; place-items:center; box-shadow:0 4px 0 rgba(37,99,235,.34),0 8px 18px rgba(15,39,71,.16); }
            .mh-story-music-toggle.is-muted { background:rgba(255,255,255,.92); color:var(--accent-dark); }
            .mh-story-pet { width:min(220px,58vw); height:min(220px,58vw); display:block; position:relative; z-index:2; }
            .mh-story-stage-cast { position:absolute; inset:0; z-index:2; transform:translate3d(var(--story-cast-pan,0px),0,0); transform-origin:50% 54%; transition:transform .42s ease; }
            .mh-story-stage-cast.is-zooming { transform:translate3d(var(--story-cast-pan,0px),0,0) scale(1.08); }
            .mh-story-stage-cast.is-interaction-locked .mh-story-stage-actor { pointer-events:none; }
            .mh-story-stage-actor { position:absolute; width:min(var(--story-actor-size,128px),31vw); height:min(var(--story-actor-size,128px),31vw); transform:translateX(-50%) scale(var(--stage-scale,1)); transform-origin:50% 100%; transition:left .38s ease,bottom .38s ease,transform .38s ease,filter .38s ease; }
            .mh-story-stage-actor [data-mh-pet] { pointer-events:none; }
            .mh-story-stage-actor.is-speaking { z-index:3; filter:drop-shadow(0 8px 10px rgba(14,116,144,.24)); transform:translateX(-50%) scale(calc(var(--stage-scale,1) * 1.16)); }
            .mh-story-stage-actor.is-listening { opacity:.82; }
            .mh-story-stage-actor.is-feed-target { filter:drop-shadow(0 0 16px rgba(250,204,21,.9)) drop-shadow(0 8px 10px rgba(14,116,144,.24)); transform:translateX(-50%) scale(calc(var(--stage-scale,1) * 1.18)); }
            .mh-story-stage-actor.is-sleep { opacity:.82; }
            .mh-story-stage-actor.is-sad { filter:saturate(.84) drop-shadow(0 6px 8px rgba(15,39,71,.18)); }
            .mh-story-stage-actor.is-happy { filter:saturate(1.14) drop-shadow(0 8px 10px rgba(14,116,144,.22)); }
            .mh-story-subtitle { position:absolute; left:18px; right:18px; bottom:94px; padding:10px 12px; border-radius:14px; background:rgba(15,39,71,.78); color:white; font-size:15px; font-weight:800; line-height:1.35; text-align:center; z-index:3; }
            .mh-story-speech-bubble { position:absolute; left:50%; bottom:calc(100% + 14px); z-index:5; min-width:132px; max-width:min(260px,74vw); transform:translateX(-50%); border-radius:18px; background:rgba(255,255,255,.9); color:#17324d; border:1.5px solid rgba(255,255,255,.78); box-shadow:0 10px 26px rgba(15,39,71,.18); padding:10px 12px; font-size:14px; line-height:1.35; font-weight:900; text-align:center; }
            .mh-story-speech-bubble::after { content:''; position:absolute; left:50%; bottom:-8px; width:16px; height:16px; background:rgba(255,255,255,.9); border-right:1.5px solid rgba(255,255,255,.78); border-bottom:1.5px solid rgba(255,255,255,.78); transform:translateX(-50%) rotate(45deg); }
            .mh-story-actor-foot-name { position:absolute; left:50%; top:calc(100% + 5px); transform:translateX(-50%); max-width:140px; border-radius:999px; background:rgba(15,39,71,.5); color:white; padding:4px 10px; font-size:12px; line-height:1; font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 4px 12px rgba(15,39,71,.12); }
            .mh-story-narrator-bubble { position:absolute; left:50%; top:22%; z-index:4; transform:translateX(-50%); max-width:min(300px,82vw); border-radius:18px; background:rgba(255,255,255,.88); color:#17324d; border:1.5px solid rgba(255,255,255,.72); box-shadow:0 10px 26px rgba(15,39,71,.16); padding:11px 14px; font-size:15px; line-height:1.36; font-weight:900; text-align:center; }
            .mh-story-actors { display:flex; gap:9px; overflow-x:auto; padding-bottom:3px; }
            .mh-story-actor { flex:0 0 106px; border:1.5px solid var(--border-card); border-radius:14px; background:rgba(255,255,255,.86); padding:7px; display:flex; flex-direction:column; align-items:center; gap:4px; color:var(--text-primary); box-shadow:0 3px 0 rgba(14,116,144,.16); }
            .mh-story-actor.is-selected { border-color:var(--accent); background:#ecfeff; box-shadow:0 3px 0 rgba(37,99,235,.35),0 0 0 3px rgba(14,165,233,.15); }
            .mh-story-actor-art { width:70px; height:70px; border-radius:12px; background:var(--bg-pill); overflow:hidden; display:flex; align-items:center; justify-content:center; }
            .mh-story-actor-name { font-size:13px; line-height:1.15; font-weight:900; text-align:center; word-break:break-word; }
            .mh-story-actor-sub { font-size:11px; color:var(--text-muted); }
            .mh-story-line { border:1.5px solid rgba(125,211,252,.8); border-radius:14px; background:rgba(255,255,255,.82); padding:10px 11px; display:flex; flex-direction:column; gap:4px; line-height:1.42; }
            .mh-story-line b { color:var(--accent-dark); font-size:13px; }
            .mh-story-line span { color:var(--text-primary); font-size:15px; }
            .mh-story-line.is-narrator { background:rgba(255,251,235,.9); }
            .mh-story-task { border:1.5px solid rgba(14,165,233,.34); border-radius:14px; background:rgba(255,255,255,.9); padding:10px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
            .mh-story-task.is-current { box-shadow:0 0 0 3px rgba(14,165,233,.18); }
            .mh-story-task strong { display:block; color:var(--text-primary); font-size:14px; }
            .mh-story-task small { display:block; color:var(--text-muted); font-size:12px; margin-top:2px; }
            .mh-story-task-state { flex:0 0 auto; border-radius:999px; background:#effaff; color:var(--accent-dark); font-size:12px; font-weight:900; padding:6px 9px; }
            .mh-story-task.is-complete { border-color:rgba(16,185,129,.45); background:#ecfdf5; }
            .mh-story-actions { flex:0 0 auto; display:flex; align-items:center; gap:8px; overflow:hidden; padding:10px 14px max(12px,env(safe-area-inset-bottom)); background:linear-gradient(180deg,#7dd3fc 0%,#38bdf8 48%,#0ea5e9 100%); border-top:1px solid rgba(255,255,255,.54); box-shadow:inset 0 1px 0 rgba(255,255,255,.42),0 -8px 20px rgba(14,116,144,.16); }
            .mh-story-actions > button:not(.dock-icon-btn) { flex:1; }
            .mh-story-action-strip { flex:1; min-width:0; display:flex; align-items:center; justify-content:flex-start; gap:8px; overflow-x:auto; overflow-y:hidden; padding:2px 0 5px; touch-action:pan-x; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain; scrollbar-width:none; }
            .mh-story-action-strip::-webkit-scrollbar { display:none; }
            .mh-story-action-placeholder { flex:1; min-width:24px; }
            .mh-story-page-arrow { flex:0 0 44px; width:44px; height:44px; min-width:44px; border-radius:16px; font-size:25px; font-weight:900; line-height:1; display:grid; place-items:center; padding:0; background:rgba(239,250,255,.92); border-color:rgba(255,255,255,.74); color:var(--accent-dark); box-shadow:0 4px 0 rgba(14,116,144,.22),0 8px 16px rgba(15,39,71,.14),inset 0 1px 0 rgba(255,255,255,.9); }
            .mh-story-page-arrow:disabled { opacity:.34; cursor:default; }
            .mh-story-page-arrow-placeholder { visibility:hidden; }
            .mh-story-finished-action-strip { flex:1; min-width:0; display:flex; gap:8px; align-items:center; }
            .mh-story-finished-action-strip > button { flex:1; min-width:0; }
            .mh-story-hero-continue { position:absolute; left:12px; right:12px; bottom:max(12px,env(safe-area-inset-bottom)); z-index:6; min-height:88px; display:flex; align-items:flex-end; justify-content:center; }
            .mh-story-continue-hit { width:100%; min-height:76px; border:0; background:transparent; box-shadow:none; padding:0 0 10px; display:flex; align-items:flex-end; justify-content:center; cursor:pointer; }
            .mh-story-continue-hit span { min-width:116px; border-radius:999px; background:rgba(15,39,71,.52); color:white; border:1px solid rgba(255,255,255,.42); box-shadow:0 4px 14px rgba(15,39,71,.16); padding:9px 18px; font-size:13px; font-weight:900; line-height:1; pointer-events:none; }
            .mh-story-continue-hit:disabled { opacity:.55; cursor:default; }
            .mh-story-actions .mh-story-dock-action { position:relative; flex:0 0 auto; min-width:66px; height:54px; border-color:rgba(14,165,233,.48); background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.16)),linear-gradient(135deg,#ecfeff,#bae6fd); box-shadow:0 4px 0 rgba(14,116,144,.24),0 8px 16px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
            .mh-story-actions .mh-story-dock-action.is-feed-action { touch-action:none; user-select:none; -webkit-user-select:none; -webkit-user-drag:none; }
            .mh-story-actions .mh-story-dock-action.is-dragging-feed { opacity:.72; transform:translateY(2px); }
            .mh-story-actions .mh-story-dock-action.is-current { border-color:rgba(37,99,235,.74); box-shadow:0 4px 0 rgba(37,99,235,.34),0 0 0 3px rgba(14,165,233,.2),0 8px 16px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
            .mh-story-actions .mh-story-dock-action.is-complete { background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.2)),linear-gradient(135deg,#ecfdf5,#bbf7d0); border-color:rgba(16,185,129,.55); }
            .mh-story-actions .mh-story-action-badge { position:absolute; right:3px; top:3px; z-index:2; min-width:19px; height:19px; padding:0 5px; border-radius:999px; display:grid; place-items:center; border:2px solid rgba(255,255,255,.94); background:linear-gradient(180deg,#fef3c7,#f59e0b); color:#7c2d12; font-size:12px; font-weight:1000; line-height:1; box-shadow:0 2px 0 rgba(146,64,14,.28),0 5px 10px rgba(15,39,71,.18); }
            .mh-story-actions .mh-story-dock-action.is-complete .mh-story-action-badge { background:linear-gradient(180deg,#86efac,#16a34a); color:white; box-shadow:0 3px 0 rgba(22,101,52,.34),0 6px 12px rgba(15,39,71,.18); }
            .mh-story-actions .mh-story-step-action { flex:0 0 68px; min-width:68px; width:68px; height:54px; border-color:rgba(245,158,11,.62); background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.18)),linear-gradient(135deg,#fff7ed,#fde68a); box-shadow:0 4px 0 rgba(217,119,6,.24),0 8px 16px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
            .mh-story-actions .mh-story-step-action.is-highlight { animation:mhStoryStepPulse 1s ease-in-out infinite; }
            @keyframes mhStoryStepPulse { 0%,100% { transform:translateY(0); box-shadow:0 4px 0 rgba(217,119,6,.24),0 8px 16px rgba(15,39,71,.12),0 0 0 0 rgba(245,158,11,.32); } 50% { transform:translateY(-2px); box-shadow:0 5px 0 rgba(217,119,6,.24),0 10px 18px rgba(15,39,71,.14),0 0 0 5px rgba(245,158,11,.18); } }
            .mh-story-actions .mh-story-dock-action .dock-icon { font-size:18px; }
            .mh-story-actions .mh-story-dock-action .dock-label { max-width:58px; font-size:10.5px; font-weight:900; color:var(--accent-dark); }
            .mh-story-hero-action { position:absolute; left:12px; right:12px; bottom:max(12px,env(safe-area-inset-bottom)); z-index:5; display:flex; align-items:center; justify-content:center; gap:8px; overflow-x:auto; min-height:82px; }
            .mh-story-hero-action .mh-story-dock-action { min-width:66px; height:54px; border-color:rgba(14,165,233,.48); background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.16)),linear-gradient(135deg,#ecfeff,#bae6fd); box-shadow:0 4px 0 rgba(14,116,144,.24),0 8px 16px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
            .mh-story-hero-action .mh-story-dock-action .dock-icon { font-size:18px; }
            .mh-story-hero-action .mh-story-dock-action .dock-label { max-width:58px; font-size:10.5px; font-weight:900; color:var(--accent-dark); }
            .mh-story-fallback-art { font-size:34px; font-weight:900; color:var(--accent-dark); }
            .mh-story-feed-drag-ghost { position:fixed; z-index:99999; left:0; top:0; width:54px; height:54px; margin:-27px 0 0 -27px; border-radius:18px; display:grid; place-items:center; pointer-events:none; font-size:30px; background:rgba(255,255,255,.9); border:2px solid rgba(250,204,21,.86); box-shadow:0 10px 24px rgba(15,39,71,.22),0 0 0 5px rgba(250,204,21,.18); transform:translateZ(0); }
        </style>
        <div class="mh-story-root">
            <div class="topbar">
                <button class="btn-icon" id="mhStoryBack" style="width:36px;height:36px;font-size:18px">‹</button>
                <span class="font-bold" style="color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(story.title)} · ${escapeHtml(progressText)}</span>
                <span style="width:36px"></span>
            </div>
            <div class="mh-story-stage">
                ${runtime.finished ? `
                    <div class="mh-story-hero">${mainPet ? `<div class="mh-story-pet">${petArtHtml(mainPet, { alt: mainPet.name || '', extraClass: 'pop-in', requireProcessedTexture: false })}</div>` : ''}<div class="mh-story-subtitle">${escapeHtml(endingText)}</div></div>
                    <div class="mh-story-line is-narrator"><b>故事完成</b><span>${escapeHtml(story.ending?.text || '你们的冒险已经写进星球记忆。')}</span></div>
                ` : needsActorSelect ? `
                    <div class="mh-story-line is-narrator"><b>选择主角</b><span>${escapeHtml(story.selectionPrompt || '选择一只抱抱龙，故事结束后它会来到你的星球。')}</span></div>
                    <div class="mh-story-actors">${selectableActors.map(actor => actorCard(actor, actor.id === runtime.selectedActorId)).join('')}</div>
                ` : `
                    <div class="mh-story-hero ${isTimelineActivity(activeItem) ? 'has-action' : ''}" data-story-hero style="--mh-story-hero-bg:${escapeHtml(sceneFallbackColor(scene))}">
                        <div class="mh-story-scene ${hasSceneBackgroundImage(scene) ? 'is-image-bg' : ''}" data-story-scene style="--mh-story-scene-bg:${escapeHtml(sceneBackground(scene))}">
                            ${renderSceneParticles(scene)}
                        </div>
                        ${renderStageActors(timeline, runtime.timelineIndex)}
                        ${renderMusicToggleButton(sceneBgMusic(scene))}
                        ${isNarratorLine(activeItem) ? `<div class="mh-story-narrator-bubble"><span data-story-narrator-text>${escapeHtml(activeNarratorText(activeItem))}</span></div>` : ''}
                        ${renderHeroContinue(activeItem, canContinue, runtime.sceneIndex >= story.scenes.length - 1)}
                    </div>
                `}
            </div>
            ${runtime.finished || needsActorSelect ? `<div class="mh-story-actions">
                ${runtime.finished ? `
                    <button type="button" class="btn-secondary dock-icon-btn mh-story-page-arrow" data-story-prev-page aria-label="上一页" title="上一页">‹</button>
                    <div class="mh-story-finished-action-strip">
                        ${options.allowUnlockedReplay ? `<button class="btn-secondary" id="mhStoryReplay">重玩故事</button>` : ''}
                        <button class="btn-primary" id="mhStoryClaim">带它回家</button>
                    </div>
                    <span class="mh-story-page-arrow mh-story-page-arrow-placeholder"></span>
                ` : `<button class="btn-primary" id="mhStoryStart">开始故事</button>`}
            </div>` : renderStoryActionDock(scene, timeline, activeItem, activeActivityIndex, canContinue)}
        </div>`;

    $('mhStoryBack').onclick = () => options.onBack?.();
    panel.querySelectorAll('[data-story-actor]').forEach(btn => {
        btn.onclick = () => {
            runtime.selectedActorId = btn.dataset.storyActor;
            renderStoryPlayer(panel, { story }, options);
        };
    });
    if ($('mhStoryStart')) $('mhStoryStart').onclick = () => {
        runtime.actorConfirmed = true;
        resetScenePlayback();
        renderStoryPlayer(panel, { story }, options);
    };
    if ($('mhStoryNext')) $('mhStoryNext').onclick = () => goNext(panel, options);
    if ($('mhStoryContinue')) $('mhStoryContinue').onclick = () => continueTimelineLine(panel, options);
    if ($('mhStoryReplay')) $('mhStoryReplay').onclick = () => startUnlockedReplay(panel, options);
    if ($('mhStoryClaim')) $('mhStoryClaim').onclick = () => options.onRaisePet?.(story, selectedActor());
    panel.querySelector('[data-story-step]')?.addEventListener('click', () => continueTimelineLine(panel, options));
    panel.querySelector('[data-story-prev-page]')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (isDockButtonDisabled(btn)) { showDockDisabledToast(btn); return; }
        goPrev(panel, options);
    });
    panel.querySelector('[data-story-next-page]')?.addEventListener('click', () => goNext(panel, options));
    panel.querySelectorAll('[data-story-actor-stage]').forEach(el => {
        el.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const actor = actorById(el.dataset.storyActorStage) || selectedActor();
            const pet = state.pets?.[storyPetForActor(actor)?.id] || storyPetForActor(actor);
            if (isStoryPetSpeaking()) return;
            const item = currentTimeline()[runtime.timelineIndex];
            if (isTimelineActivity(item)) {
                const activityIndex = timelineActivityIndex(currentTimeline(), runtime.timelineIndex);
                const activity = sceneActivities(currentScene())[activityIndex];
                if (activity && activityType(activity) === 'tap' && isActorAllowedForActivity(activity, actor)) {
                    runPetActivity(activity, panel, options, activityIndex, { targetPet: pet, targetPetEl: el });
                    return;
                }
            }
            runTouchInteraction(el, pet);
        };
    });
    panel.querySelector('.mh-story-root')?.addEventListener('click', (e) => {
        if (!isDialogueActive()) return;
        const hero = panel.querySelector('[data-story-hero]');
        if (Date.now() - (hero?.__mhStoryPannedAt || 0) < 260) return;
        if (e.target.closest?.('button,input,select,textarea,a,[data-story-actor],[data-story-activity],[data-story-music-toggle]')) return;
        continueTimelineLine(panel, options);
    });
    panel.querySelector('[data-story-music-toggle]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const track = sceneBgMusic(currentScene());
        const muted = soundManager.toggleBgMusicMuted?.({ fadeMs: 220 });
        if (!muted && track) soundManager.playBgMusic(track, { fadeMs: 260, volume: 0.3 });
        renderStoryPlayer(panel, { story }, options);
    });
    panel.querySelectorAll('[data-story-activity]').forEach(btn => {
        const index = Number(btn.dataset.storyActivity) || 0;
        const activity = sceneActivities(currentScene())[index];
        if (activityType(activity) === 'feed') bindStoryFeedDrag(btn, activity, panel, options, index);
        btn.onclick = async () => {
            if (isDockButtonDisabled(btn)) { showDockDisabledToast(btn); return; }
            if (isDialogueActive()) { showToast('对白播放中，先点击继续看完当前对白。', 'info', 1600); return; }
            if (Date.now() - (btn.__mhStoryFeedDragHandledAt || 0) < 350) return;
            if (!activity) return;
            const type = activityType(activity);
            if (type === 'minigame') {
                if (!activity.gameId) { showToast('小游戏缺少 gameId', 'error'); return; }
                runtime.pendingMinigame = { index, activity };
                options.onLaunchMinigame?.(activity);
                return;
            }
            btn.disabled = true;
            try {
                if (type === 'feed') await runFeedStoryActivity(activity, panel, options, index, { showDragHint: true });
                else await runPetActivity(activity, panel, options, index);
            }
            finally { if (btn.isConnected) btn.disabled = false; }
        };
    });
    bindStoryScenePan(panel);
    ParticleEffects.getInstance().mountAll(panel);
    mountStoryActorPets(panel);
    scanAndMount(panel);
    if (!needsActorSelect) scheduleTimelinePlayback(panel, options);
}
