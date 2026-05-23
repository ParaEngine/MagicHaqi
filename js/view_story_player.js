// 故事播放视图：加载 shareable story JSON，按场景播放对白，并 gate 互动任务。
import { $, escapeHtml, showToast } from './utils.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { petArtHtml, scanAndMount, say, setAnim } from './pet.js';
import { loadWorkspaceStory } from './storage.js';
import { renderSceneParticles, sceneParticleCss } from './view_story_scene_maker.js';

let runtime = null;
const STORY_LINE_ADVANCE_MS = 1300;

const ACTIVITY_LABELS = {
    feed: '喂养',
    bath: '清洁',
    clean: '清洁',
    tap: '轻拍',
    comfort: '安抚',
    play: '玩耍',
    minigame: '小游戏',
};

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

function sceneBackground(scene) {
    const bg = scene?.background || {};
    const color = bg.color || scene?.bgColor || '#bae6fd';
    const imageUrl = bg.imageUrl || scene?.backgroundImage || '';
    if (imageUrl) return `linear-gradient(rgba(255,255,255,.12),rgba(255,255,255,.12)), url("${String(imageUrl).replace(/"/g, '%22')}") center/cover no-repeat`;
    return `radial-gradient(circle at 50% 12%,rgba(255,255,255,.86),transparent 34%), linear-gradient(180deg, ${color}, #ffffff)`;
}

function activityCount(activity) {
    const count = Number(activity?.count ?? activity?.times ?? 1);
    return Math.max(1, Number.isFinite(count) ? Math.round(count) : 1);
}

function activityKey(activity, index) {
    return `${runtime.sceneId}:${index}:${activity?.type || 'activity'}`;
}

function activityProgress(activity, index) {
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

function currentTimeline() {
    return sceneTimeline(currentScene());
}

function isSceneComplete(scene) {
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
        id: actor.id || template.id || 'story_pet',
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

function stageCueStyle(cue, index, total) {
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
    return { left, bottom, scale, mood };
}

function renderStageActors(timeline, activeItemIndex) {
    const actors = Array.isArray(runtime?.story?.actors) ? runtime.story.actors : [];
    const activeItem = timeline?.[activeItemIndex] || null;
    const activeActorId = !isTimelineActivity(activeItem) ? timelineActorId(activeItem?.actor) : '';
    const activeCue = !isTimelineActivity(activeItem) ? splitStageText(activeItem?.text || activeItem?.say || '').cue : '';
    const cast = actors.map((actor, index) => {
        const cue = actor.id === activeActorId ? activeCue : '';
        const style = stageCueStyle(cue, index, actors.length);
        const pet = storyPetForActor(actor);
        if (!pet) return '';
        return `
            <div class="mh-story-stage-actor ${actor.id === activeActorId ? 'is-speaking' : ''} ${style.mood ? `is-${style.mood}` : ''}" style="left:${style.left}%;bottom:${style.bottom}%;--stage-scale:${style.scale}">
                ${petArtHtml(pet, { alt: actor.name || pet.name || '', extraClass: actor.id === activeActorId ? 'pop-in' : 'floaty', requireProcessedTexture: false })}
            </div>`;
    }).join('');
    return `<div class="mh-story-stage-cast ${activeActorId ? 'is-zooming' : ''}">${cast}</div>`;
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

function renderLine(line) {
    const actor = line.actor || null;
    const name = actor?.name || line.actorName || '旁白';
    const text = visibleLineText(line.text || line.say || '');
    return `
        <div class="mh-story-line ${actor ? '' : 'is-narrator'}">
            <b>${escapeHtml(name)}</b>
            <span>${escapeHtml(text)}</span>
        </div>`;
}

function renderActivity(activity, index) {
    const type = activity?.type || 'play';
    const done = activityProgress(activity, index);
    const total = activityCount(activity);
    const complete = done >= total;
    const title = activity.title || ACTIVITY_LABELS[type] || '互动';
    const detail = type === 'minigame'
        ? (activity.gameTitle || activity.gameId || '小游戏')
        : (activity.source || activity.hint || '和宠物完成互动');
    return `
        <div class="mh-story-task ${complete ? 'is-complete' : ''}">
            <div>
                <strong>${escapeHtml(title)} × ${total}</strong>
                <small>${escapeHtml(detail)} · ${Math.min(done, total)}/${total}</small>
            </div>
            <span class="mh-story-task-state">${complete ? '完成' : '进行中'}</span>
        </div>`;
}

function activityIcon(activity) {
    const type = activity?.type || 'play';
    if (type === 'feed') return '🍪';
    if (type === 'bath' || type === 'clean') return '🫧';
    if (type === 'tap') return '👆';
    if (type === 'comfort') return '💗';
    if (type === 'minigame') return '🎾';
    return '✨';
}

function renderActionButton(activity, activityIndex) {
    if (!activity) return '<button type="button" class="btn-secondary" disabled>播放中...</button>';
    const type = activity?.type || 'play';
    const done = activityProgress(activity, activityIndex);
    const total = activityCount(activity);
    const left = Math.max(0, total - done);
    const title = activity.title || ACTIVITY_LABELS[type] || '互动';
    return `
        <button type="button" class="btn-secondary action-btn dock-icon-btn mh-story-dock-action" data-story-activity="${activityIndex}" ${left <= 0 ? 'disabled' : ''}>
            <span class="dock-icon">${activityIcon(activity)}</span>
            <span class="dock-label">${escapeHtml(title)} × ${left}</span>
        </button>`;
}

function activeSubtitle(story, scene, timeline) {
    const item = timeline[runtime.timelineIndex] || null;
    if (!item) return '这一幕完成啦。';
    if (isTimelineActivity(item)) {
        return '';
    }
    const line = resolveLine(item);
    const name = line?.actor?.name || line?.actorName || '旁白';
    return `${name}：${visibleLineText(line?.text || line?.say || '')}`;
}

function clearTimelineTimer() {
    if (runtime?.timelineTimer) clearTimeout(runtime.timelineTimer);
    if (runtime) runtime.timelineTimer = null;
}

function resetScenePlayback() {
    clearTimelineTimer();
    runtime.timelineIndex = 0;
}

function scheduleTimelinePlayback(panel, options) {
    clearTimelineTimer();
    if (!runtime || runtime.finished || runtime.pendingMinigame) return;
    const timeline = currentTimeline();
    const item = timeline[runtime.timelineIndex];
    if (!item || isTimelineActivity(item)) return;
    runtime.timelineTimer = setTimeout(() => {
        if (!runtime || runtime.finished) return;
        runtime.timelineIndex = Math.min(timeline.length, (runtime.timelineIndex || 0) + 1);
        renderStoryPlayer(panel, { story: runtime.story }, options);
    }, STORY_LINE_ADVANCE_MS);
}

function sceneIndexOf(sceneId) {
    return runtime.story.scenes.findIndex(scene => scene.id === sceneId);
}

function goNext(panel, options) {
    const scene = currentScene();
    const explicitNext = scene?.nextSceneId;
    const nextIndex = explicitNext ? sceneIndexOf(explicitNext) : runtime.sceneIndex + 1;
    if (nextIndex >= 0 && nextIndex < runtime.story.scenes.length) {
        runtime.sceneIndex = nextIndex;
        runtime.sceneId = runtime.story.scenes[nextIndex].id;
        resetScenePlayback();
        renderStoryPlayer(panel, { story: runtime.story }, options);
        return;
    }
    clearTimelineTimer();
    runtime.finished = true;
    renderStoryPlayer(panel, { story: runtime.story }, options);
}

function completeActivity(index, panel, options) {
    const scene = currentScene();
    const activity = sceneActivities(scene)[index];
    if (!activity) return;
    const key = activityKey(activity, index);
    runtime.activityProgress[key] = Math.min(activityCount(activity), (runtime.activityProgress[key] || 0) + 1);
    if (runtime.activityProgress[key] >= activityCount(activity)) {
        runtime.timelineIndex = Math.min(currentTimeline().length, (runtime.timelineIndex || 0) + 1);
    }
    renderStoryPlayer(panel, { story: runtime.story }, options);
}

function runPetActivity(activity, panel, options, index) {
    const type = activity?.type || 'play';
    const actionMap = { clean: 'bath', bath: 'bath', feed: 'feed', tap: 'play', comfort: 'play', play: 'play' };
    const action = activity.actionKey && activity.actionKey !== 'minigame' ? activity.actionKey : (actionMap[type] || 'play');
    const ok = options?.onPetAction?.(action, activity) !== false;
    if (ok) {
        setAnim(type === 'feed' || type === 'comfort' || type === 'tap' ? 'happy' : 'idle', 1200);
        const line = activity.successText || (type === 'feed' ? '好吃！' : type === 'clean' || type === 'bath' ? '香香的！' : type === 'tap' ? '我收到你的轻拍啦！' : '我感觉好多啦');
        requestAnimationFrame(() => say(line, 2200));
    }
    completeActivity(index, panel, options);
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
    if (!runtime || runtime.story?.id !== story.id) {
        const startIndex = Math.max(0, story.scenes.findIndex(scene => scene.id === story.startSceneId));
        runtime = {
            story,
            sceneIndex: startIndex,
            sceneId: story.scenes[startIndex]?.id || story.startSceneId,
            timelineIndex: 0,
            selectedActorId: story.actors.find(actor => actor.allowUserSelection)?.id || story.actors[0]?.id || '',
            activityProgress: {},
            finished: false,
            pendingMinigame: null,
        };
    }
    clearTimelineTimer();
    runtime.panel = panel;
    runtime.options = options;

    const scene = currentScene();
    const selectableActors = story.actors.filter(actor => actor.allowUserSelection);
    const needsActorSelect = selectableActors.length > 1 && !runtime.actorConfirmed;
    const mainPet = storyPetForActor(selectedActor());
    const timeline = sceneTimeline(scene);
    runtime.timelineIndex = Math.max(0, Math.min(runtime.timelineIndex || 0, timeline.length));
    const visibleTimeline = timeline.slice(0, Math.min(timeline.length, runtime.timelineIndex + 1));
    const activeItem = timeline[runtime.timelineIndex] || null;
    const activeActivityIndex = isTimelineActivity(activeItem) ? timelineActivityIndex(timeline, runtime.timelineIndex) : -1;
    let renderActivityIndex = 0;
    const renderTimelineItem = (item) => {
        if (item?.kind === 'activity' || item?.type) return renderActivity(item, renderActivityIndex++);
        const line = resolveLine(item);
        return line ? renderLine(line) : '';
    };
    const canContinue = scene ? isSceneComplete(scene) : true;
    const progressText = scene ? `${runtime.sceneIndex + 1}/${story.scenes.length}` : '完成';
    const endingText = story.ending?.subtitle || '故事完成啦。';

    panel.innerHTML = `
        <style>
            ${sceneParticleCss()}
            .mh-story-root { position:absolute; inset:0; display:flex; flex-direction:column; background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 45%,#fef3c7 100%); color:var(--text-primary); }
            .mh-story-stage { flex:1; min-height:0; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
            .mh-story-hero { width:100%; max-width:360px; aspect-ratio:1/1; min-height:0; align-self:center; border-radius:18px; border:2px solid rgba(255,255,255,.78); background:var(--mh-story-scene-bg); background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; box-shadow:var(--game-shadow-small); }
            .mh-story-hero.has-action { padding-bottom:64px; }
            .mh-story-scene-label { position:absolute; top:10px; left:10px; z-index:4; border-radius:999px; background:rgba(255,255,255,.88); color:var(--accent-dark); font-size:12px; font-weight:900; padding:5px 9px; box-shadow:0 2px 8px rgba(15,39,71,.14); }
            .mh-story-pet { width:min(220px,58vw); height:min(220px,58vw); display:block; position:relative; z-index:2; }
            .mh-story-stage-cast { position:absolute; inset:0; z-index:2; transform-origin:50% 54%; transition:transform .42s ease; }
            .mh-story-stage-cast.is-zooming { transform:scale(1.08); }
            .mh-story-stage-actor { position:absolute; width:min(104px,30vw); height:min(104px,30vw); transform:translateX(-50%) scale(var(--stage-scale,1)); transform-origin:50% 100%; transition:left .38s ease,bottom .38s ease,transform .38s ease,filter .38s ease; }
            .mh-story-stage-actor.is-speaking { z-index:3; filter:drop-shadow(0 8px 10px rgba(14,116,144,.24)); transform:translateX(-50%) scale(calc(var(--stage-scale,1) * 1.16)); }
            .mh-story-stage-actor.is-sleep { opacity:.82; }
            .mh-story-stage-actor.is-sad { filter:saturate(.84) drop-shadow(0 6px 8px rgba(15,39,71,.18)); }
            .mh-story-stage-actor.is-happy { filter:saturate(1.14) drop-shadow(0 8px 10px rgba(14,116,144,.22)); }
            .mh-story-subtitle { position:absolute; left:12px; right:12px; bottom:10px; padding:9px 11px; border-radius:14px; background:rgba(15,39,71,.78); color:white; font-size:14px; font-weight:800; line-height:1.35; text-align:center; z-index:3; }
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
            .mh-story-actions { flex:0 0 auto; display:flex; align-items:center; gap:8px; overflow-x:auto; padding:8px 14px max(10px,env(safe-area-inset-bottom)); background:rgba(239,250,255,.9); border-top:1px solid rgba(125,211,252,.58); }
            .mh-story-actions > button:not(.dock-icon-btn) { flex:1; }
            .mh-story-actions .mh-story-dock-action { min-width:66px; height:54px; border-color:rgba(14,165,233,.48); background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.16)),linear-gradient(135deg,#ecfeff,#bae6fd); box-shadow:0 4px 0 rgba(14,116,144,.24),0 8px 16px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
            .mh-story-actions .mh-story-dock-action .dock-icon { font-size:18px; }
            .mh-story-actions .mh-story-dock-action .dock-label { max-width:58px; font-size:10.5px; font-weight:900; color:var(--accent-dark); }
            .mh-story-hero-action { position:absolute; left:10px; right:10px; bottom:8px; z-index:5; display:flex; align-items:center; gap:8px; overflow-x:auto; }
            .mh-story-hero-action .mh-story-dock-action { min-width:66px; height:54px; border-color:rgba(14,165,233,.48); background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.16)),linear-gradient(135deg,#ecfeff,#bae6fd); box-shadow:0 4px 0 rgba(14,116,144,.24),0 8px 16px rgba(15,39,71,.12),inset 0 1px 0 rgba(255,255,255,.85); }
            .mh-story-hero-action .mh-story-dock-action .dock-icon { font-size:18px; }
            .mh-story-hero-action .mh-story-dock-action .dock-label { max-width:58px; font-size:10.5px; font-weight:900; color:var(--accent-dark); }
            .mh-story-fallback-art { font-size:34px; font-weight:900; color:var(--accent-dark); }
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
                    <div class="mh-story-hero ${isTimelineActivity(activeItem) ? 'has-action' : ''}" style="--mh-story-scene-bg:${escapeHtml(sceneBackground(scene))}">
                        ${renderSceneParticles(scene)}
                        <div class="mh-story-scene-label">第${runtime.sceneIndex + 1}幕</div>
                        ${renderStageActors(timeline, runtime.timelineIndex)}
                        ${activeSubtitle(story, scene, timeline) ? `<div class="mh-story-subtitle">${escapeHtml(activeSubtitle(story, scene, timeline))}</div>` : ''}
                        ${isTimelineActivity(activeItem) ? `<div class="mh-story-hero-action">${renderActionButton(activeItem, activeActivityIndex)}</div>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px">
                        ${visibleTimeline.length ? visibleTimeline.map(renderTimelineItem).join('') : '<div class="mh-story-line is-narrator"><b>故事</b><span>这一幕开始了。</span></div>'}
                    </div>
                `}
            </div>
            ${runtime.finished || needsActorSelect || !isTimelineActivity(activeItem) ? `<div class="mh-story-actions">
                ${runtime.finished ? `<button class="btn-primary" id="mhStoryClaim">带它回家</button>` : needsActorSelect ? `<button class="btn-primary" id="mhStoryStart">开始故事</button>` : `<button class="btn-primary" id="mhStoryNext" ${canContinue ? '' : 'disabled'}>${canContinue ? (runtime.sceneIndex >= story.scenes.length - 1 ? '完成故事' : '下一幕') : '播放中...'}</button>`}
            </div>` : ''}
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
    if ($('mhStoryClaim')) $('mhStoryClaim').onclick = () => options.onRaisePet?.(story, selectedActor());
    panel.querySelectorAll('[data-story-activity]').forEach(btn => {
        btn.onclick = () => {
            const index = Number(btn.dataset.storyActivity) || 0;
            const activity = sceneActivities(currentScene())[index];
            if (!activity) return;
            if (activity.type === 'minigame') {
                runtime.pendingMinigame = { index, activity };
                options.onLaunchMinigame?.(activity);
                return;
            }
            runPetActivity(activity, panel, options, index);
        };
    });
    scanAndMount(panel);
    if (!needsActorSelect) scheduleTimelinePlayback(panel, options);
}
