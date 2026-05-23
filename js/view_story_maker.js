// 故事创作视图：移动端优先的轻量 AI story JSON maker。
import { $, escapeHtml, showToast } from './utils.js';
import { state } from './state.js';
import { petArtHtml, scanAndMount } from './pet.js';
import { displayPetName } from './dna.js';
import { loadPet, saveWorkspaceStory } from './storage.js';
import { renderPetList } from './view_petList.js';
import { assignPresetScenesToStory, renderSceneParticles, renderStorySceneMaker, sceneParticleCss, SCENE_TAG_PROMPT_HINT } from './view_story_scene_maker.js';
import SoundManager from './soundManager.js';
import ParticleEffects from './particleEffects.js';

const DEFAULT_SCENE_COUNT = 5;
const SCENE_BG_COLORS = ['#bae6fd', '#fde68a', '#bbf7d0', '#fecdd3', '#ddd6fe', '#fed7aa', '#ccfbf1', '#e0e7ff'];
const ACTIVITY_TYPES = [
    { value: 'feed', label: '喂养', actionKey: 'feed', source: 'CONFIG.actions.feed' },
    { value: 'bath', label: '洗澡/清洁', actionKey: 'bath', source: 'CONFIG.actions.bath' },
    { value: 'tap', label: '轻拍互动', actionKey: 'play', source: 'level_pet pet tapping feedback' },
    { value: 'comfort', label: '安抚', actionKey: 'play', source: 'CONFIG.actions.play' },
    { value: 'play', label: '玩耍', actionKey: 'play', source: 'CONFIG.actions.play' },
    { value: 'minigame', label: '小游戏', actionKey: 'minigame', source: 'view_minigames.MINIGAMES' },
];
const MINIGAMES = [
    { id: 'pet_tower_defense', title: '细胞免疫塔防' },
    { id: 'pet_bath', title: '萌宠爱洗澡' },
    { id: 'pet_snake', title: '宠物贪吃蛇大乱斗' },
    { id: 'bubble_pets', title: '宠物泡泡龙' },
    { id: 'match_three_pets', title: '宠物三消' },
    { id: 'food_stack_match', title: '宠物食物叠叠消' },
    { id: 'zuma', title: '宠物祖玛' },
    { id: 'food_hexcells', title: '宠物寻食蜂巢' },
    { id: 'canal_escape', title: '宠物运河营救' },
    { id: 'sokoban', title: '宠物推箱子' },
    { id: 'laser_maze', title: '宠物激光迷宫' },
    { id: 'lightbot', title: '宠物猎人编程' },
    { id: 'flappy_pet', title: '飞翔宠物' },
    { id: 'xiangqi', title: '宠物象棋' },
    { id: 'gomoku', title: '宠物五子棋' },
    { id: 'matrix_hack', title: '宠物矩阵破解' },
];
const REVIEW_LINE_ADVANCE_MS = 1200;
const soundManager = SoundManager.getInstance();

function sceneBg(index = 0, value = null) {
    const color = typeof value === 'string' && value ? value : SCENE_BG_COLORS[index % SCENE_BG_COLORS.length];
    if (value && typeof value === 'object') {
        return { type: value.type || 'color', color: value.color || color, imageUrl: value.imageUrl || '' };
    }
    return { type: 'color', color, imageUrl: '' };
}

function normalizeActivity(activity = {}) {
    const type = activity.type === 'clean' ? 'bath' : (activity.type || 'comfort');
    const def = ACTIVITY_TYPES.find(item => item.value === type) || ACTIVITY_TYPES[3];
    const gameId = activity.gameId || 'pet_tower_defense';
    const game = MINIGAMES.find(item => item.id === gameId);
    const result = {
        kind: 'activity',
        type: def.value,
        actionKey: activity.actionKey || def.actionKey,
        source: activity.source || def.source,
        title: activity.title || (def.value === 'minigame' ? game?.title : def.label) || '互动',
        count: Math.max(1, Number(activity.count ?? activity.times ?? 1) || 1),
        successText: activity.successText || '',
    };
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
            { kind: 'line', actor: '$narrator', text: index === 0 ? '新的故事从星光下开始。' : `第${index + 1}幕：伙伴们继续前进。` },
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
        title: promptText ? promptText.slice(0, 18) : '我的宠物故事',
        version: 1,
        selectionPrompt: '选择一位主角进入故事。',
        actors,
        startSceneId: scenes[0]?.id || 'scene_1',
        scenes,
        ending: { subtitle: '故事完成，宠物回到星球。', text: '这段冒险已经准备好分享给朋友。' },
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

function normalizeStoryForSave(story, actors) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    return {
        id: story?.id || `story_${Date.now()}`,
        title: story?.title || '我的宠物故事',
        version: 1,
        selectionPrompt: story?.selectionPrompt || '选择一位主角进入故事。',
        actors: Array.isArray(story?.actors) && story.actors.length ? story.actors : actors,
        startSceneId: story?.startSceneId || scenes[0]?.id || 'scene_1',
        scenes: scenes.map(sceneFromTimeline),
        ending: story?.ending || { subtitle: '故事完成。', text: '新的故事已经可以分享。' },
    };
}

function buildStoryPrompt(promptText, count, actors) {
    return [
        '请为一个移动端虚拟宠物游戏生成互动故事 JSON。只返回合法 JSON，不要 markdown。',
        `故事主题：${promptText || '温暖的宠物冒险'}`,
        `场景数量：${count}`,
        '顶层字段必须包含：id, title, version, selectionPrompt, actors, startSceneId, scenes, ending。',
        '每个 scene 字段：id, sceneTags, background, particles, bgMusic, timeline。不要使用 subtitle 字段；旁白/字幕必须写成 timeline 里的 line，actor 使用 "$narrator"。background 先使用 {"type":"color","color":"#bae6fd","imageUrl":""}。',
        `sceneTags 用英文短标签数组，优先从这些标签里选择：${SCENE_TAG_PROMPT_HINT}。每幕给 2-5 个标签，用来低成本匹配预生成背景图。`,
        'particles 是粒子效果数组，可选 sparkle, snow, rain, mist, bubbles, petals, embers；没有需要可为空数组。',
        `bgMusic 是背景音乐 key，可为空字符串；可选：${Object.keys(CONFIG.assets?.bgSounds || {}).join(', ')}。`,
        'timeline 是完整时间顺序数组，元素 kind 为 line 或 activity。line 格式 {"kind":"line","actor":"$selected","text":"..."}；旁白格式 {"kind":"line","actor":"$narrator","text":"..."}。',
        '人物对白可以用开头括号写舞台指示，例如 "(左侧，开心)我们出发吧"、"(中间)看这里"、"(远处,睡觉)呼呼"、"(近处,伤心)我有点难过"。括号中的文字只表示角色在场景里的位置/动作，播放时不显示。没有括号时，角色会自动在画面中间区域随机排开，并保持安全距离。',
        'activity 必须使用真实游戏数据：feed(actionKey feed, source CONFIG.actions.feed), bath(actionKey bath, source CONFIG.actions.bath), tap(actionKey play, source level_pet pet tapping feedback), comfort/play(actionKey play, source CONFIG.actions.play), minigame(source view_minigames.MINIGAMES)。',
        `可用 minigame id: ${MINIGAMES.map(game => `${game.id}=${game.title}`).join(', ')}。`,
        '活动格式示例 {"kind":"activity","type":"feed","actionKey":"feed","source":"CONFIG.actions.feed","title":"喂养","count":3,"successText":"好吃"}。小游戏示例 {"kind":"activity","type":"minigame","actionKey":"minigame","source":"view_minigames.MINIGAMES","title":"完成塔防","gameId":"pet_tower_defense","gameTitle":"细胞免疫塔防","count":1}。',
        '每幕建议 timeline 中 2-4 条对白，0-2 个活动，允许 line/activity 交错。对白短小，适合儿童，中文。',
        `actors: ${JSON.stringify(actors.map(actor => ({ id: actor.id, name: actor.name, allowUserSelection: actor.allowUserSelection, isMainActor: actor.isMainActor })))}`,
    ].join('\n');
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
    const userPrompt = buildStoryPrompt(promptText, count, actors);
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
    const opts = [{ id: '$selected', name: '玩家选择的主角' }, { id: '$narrator', name: '旁白' }, ...actors];
    return optionList(opts.map(actor => ({ value: actor.id, label: actor.name || actor.id })), selected || '$selected');
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

function moveIcon(direction) {
    const path = direction === 'up' ? 'M12 5l-6 6h4v8h4v-8h4z' : 'M12 19l6-6h-4V5h-4v8H6z';
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
}

function renderTimelineMoveButtons(itemIndex) {
    return `
        <div class="mh-scene-row-tools" aria-label="调整顺序">
            <button type="button" class="mh-maker-icon-btn" data-move-timeline="up" data-timeline-move-index="${itemIndex}" aria-label="上移" title="上移">${moveIcon('up')}</button>
            <button type="button" class="mh-maker-icon-btn" data-move-timeline="down" data-timeline-move-index="${itemIndex}" aria-label="下移" title="下移">${moveIcon('down')}</button>
        </div>`;
}

function renderLineEditor(line, itemIndex, actors) {
    return `
        <div class="mh-scene-row" data-timeline-index="${itemIndex}" data-timeline-kind="line">
            <div class="mh-scene-row-head">
                <span class="mh-scene-row-kind">${itemIndex + 1}. 对白</span>
                <div class="mh-scene-row-actions">
                    ${renderTimelineMoveButtons(itemIndex)}
                    <button type="button" class="mh-maker-mini danger" data-remove-timeline="${itemIndex}">删除</button>
                </div>
            </div>
            <select class="modal-input" data-line-actor>${actorOptions(actors, line?.actor)}</select>
            <textarea class="modal-input" data-line-text placeholder="角色台词">${escapeHtml(line?.text || line?.say || '')}</textarea>
        </div>`;
}

function renderActivityEditor(activity, itemIndex) {
    const type = activity?.type || 'comfort';
    const def = ACTIVITY_TYPES.find(item => item.value === type) || ACTIVITY_TYPES[3];
    return `
        <div class="mh-scene-row is-activity" data-timeline-index="${itemIndex}" data-timeline-kind="activity">
            <div class="mh-scene-row-head">
                <span class="mh-scene-row-kind">${itemIndex + 1}. 互动 · ${escapeHtml(def.source)}</span>
                <div class="mh-scene-row-actions">
                    ${renderTimelineMoveButtons(itemIndex)}
                    <button type="button" class="mh-maker-mini danger" data-remove-timeline="${itemIndex}">删除</button>
                </div>
            </div>
            <div class="mh-maker-row-2">
                <select class="modal-input" data-activity-type>${optionList(ACTIVITY_TYPES, type)}</select>
                <input class="modal-input" data-activity-count type="number" min="1" max="20" value="${Math.max(1, Number(activity?.count ?? activity?.times ?? 1) || 1)}" aria-label="次数">
            </div>
            <input class="modal-input" data-activity-title placeholder="互动标题" value="${escapeHtml(activity?.title || activity?.gameTitle || '')}">
            <input class="modal-input" data-activity-source placeholder="真实数据来源" value="${escapeHtml(activity?.source || def.source)}">
            <div class="mh-maker-game-fields" style="display:${type === 'minigame' ? 'grid' : 'none'};gap:8px">
                <select class="modal-input" data-activity-game>${optionList(MINIGAMES.map(game => ({ value: game.id, label: game.title })), activity?.gameId || 'pet_tower_defense')}</select>
            </div>
            <input class="modal-input" data-activity-success placeholder="完成提示" value="${escapeHtml(activity?.successText || '')}">
        </div>`;
}

function renderSceneEditorHtml(story, { onlySceneIndex = null } = {}) {
    if (!story?.scenes?.length) {
        return '<div class="mh-maker-empty">生成或粘贴故事 JSON 后，这里会出现每一幕的详细时间轴编辑器。</div>';
    }
    const actors = Array.isArray(story.actors) ? story.actors : [];
    return story.scenes.map((scene, sceneIndex) => ({ scene, sceneIndex }))
        .filter(({ sceneIndex }) => onlySceneIndex === null || sceneIndex === onlySceneIndex)
        .map(({ scene, sceneIndex }) => `
        <section class="mh-scene-card" data-scene-index="${sceneIndex}">
            <div class="mh-scene-titlebar">
                <div>
                    <strong>第${sceneIndex + 1}幕</strong>
                </div>
                <div class="mh-scene-actions">
                    <button type="button" class="mh-maker-mini" data-open-scene-maker>背景</button>
                    <button type="button" class="mh-maker-mini" data-add-line>+对白</button>
                    <button type="button" class="mh-maker-mini" data-add-activity>+互动</button>
                </div>
            </div>
            <div class="mh-maker-row-2" style="grid-template-columns:88px minmax(0,1fr)">
                <label class="mh-maker-label" style="margin:0;align-self:center">背景色</label>
                <input class="modal-input mh-scene-color-input" data-scene-bg-color type="color" value="${escapeHtml(sceneBg(sceneIndex, scene.background).color || SCENE_BG_COLORS[sceneIndex % SCENE_BG_COLORS.length])}" aria-label="背景色">
            </div>
            <input class="modal-input" data-scene-bg-image placeholder="背景图 URL（未来 AI 生成后填入）" value="${escapeHtml(sceneBg(sceneIndex, scene.background).imageUrl || '')}">
            <input class="modal-input" data-scene-tags placeholder="场景标签，例如 forest, spring, haqi" value="${escapeHtml((scene.sceneTags || scene.tags || []).join(', '))}">
            <input class="modal-input" data-scene-particles placeholder="粒子效果，例如 sparkle, snow, bubbles" value="${escapeHtml((scene.particles || []).join(', '))}">
            <input type="hidden" data-scene-bg-music value="${escapeHtml(scene.bgMusic || scene.background?.bgMusic || '')}">
            <div class="mh-scene-preview" style="background:${escapeHtml(sceneBg(sceneIndex, scene.background).color || '#bae6fd')};color:#0f2747">${renderSceneParticles(scene)}<span>背景预览</span></div>
            <div class="mh-scene-timeline">
                ${sceneTimeline(scene).map((item, itemIndex) => item.kind === 'activity'
                    ? renderActivityEditor(item, itemIndex)
                    : renderLineEditor(item, itemIndex, actors)).join('')}
            </div>
        </section>`).join('');
}

function storyPetForActor(actor) {
    if (!actor) return null;
    if (actor.sourcePetId && state.pets?.[actor.sourcePetId]) return state.pets[actor.sourcePetId];
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

function renderStoryStageActorsHtml(story, timeline, activeItemIndex) {
    const actors = Array.isArray(story?.actors) ? story.actors : [];
    const activeItem = timeline?.[activeItemIndex] || null;
    const activeActorId = !isTimelineActivity(activeItem) ? timelineActorId(story, activeItem?.actor) : '';
    const activeCue = !isTimelineActivity(activeItem) ? splitStageText(activeItem?.text || activeItem?.say || '').cue : '';
    const cast = actors.map((actor, index) => {
        const cue = actor.id === activeActorId ? activeCue : '';
        const style = stageCueStyle(cue, index, actors.length);
        const pet = storyPetForActor(actor);
        if (!pet) return '';
        return `
            <div class="mh-review-stage-actor ${actor.id === activeActorId ? 'is-speaking' : ''} ${style.mood ? `is-${style.mood}` : ''}" style="left:${style.left}%;bottom:${style.bottom}%;--stage-scale:${style.scale}">
                ${petArtHtml(pet, { alt: actor.name || pet.name || '', extraClass: actor.id === activeActorId ? 'pop-in' : 'floaty', requireProcessedTexture: false })}
            </div>`;
    }).join('');
    return `<div class="mh-review-stage-cast ${activeActorId ? 'is-zooming' : ''}">${cast}</div>`;
}

function mainStoryActor(story) {
    return story?.actors?.find(actor => actor.isMainActor) || story?.actors?.[0] || null;
}

function actorNameForTimeline(story, actorId) {
    if (actorId === '$narrator') return '旁白';
    const actor = actorId === '$selected' ? mainStoryActor(story) : story?.actors?.find(item => item.id === actorId);
    return actor?.name || '主角';
}

function isTimelineActivity(item) {
    return item?.kind === 'activity' || !!item?.type;
}

function activityTotal(activity) {
    const count = Number(activity?.count ?? activity?.times ?? 1);
    return Math.max(1, Number.isFinite(count) ? Math.round(count) : 1);
}

function activityTitle(activity) {
    const typeDef = ACTIVITY_TYPES.find(type => type.value === activity?.type) || ACTIVITY_TYPES[3];
    return activity?.type === 'minigame'
        ? (activity.gameTitle || activity.title || typeDef.label)
        : (activity?.title || typeDef.label);
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

function sceneBgMusic(scene) {
    return String(scene?.bgMusic || scene?.background?.bgMusic || '').trim();
}

function renderMusicToggleButton(track, className = 'mh-review-music-toggle') {
    if (!track) return '';
    const muted = soundManager.isBgMusicMuted?.();
    return `<button type="button" class="${className} ${muted ? 'is-muted' : ''}" data-review-music-toggle aria-label="${muted ? '开启音乐' : '静音'}" title="${muted ? '开启音乐' : '静音'}">${muted ? '♪' : '♫'}</button>`;
}

function reviewActionKey(sceneIndex, itemIndex, activity) {
    return `${sceneIndex}:${itemIndex}:${activity?.type || 'activity'}`;
}

function reviewPlaybackState(sceneIndex, timeline, playback) {
    if (!playback || playback.sceneIndex !== sceneIndex) {
        return { stepIndex: timeline.length, activeItem: null, actionProgress: {} };
    }
    const stepIndex = Math.max(0, Math.min(Number(playback.stepIndex) || 0, timeline.length));
    return { stepIndex, activeItem: timeline[stepIndex] || null, actionProgress: playback.actionProgress || {} };
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
    if (!story) return '<div class="mh-maker-empty">写一句故事想法，选择演员，然后生成第一版。</div>';
    const stats = storyStats(story);
    const ready = stats.scenes > 0 && stats.actors > 0 && stats.lines > 0;
    const title = titleText || (ready ? '可以试玩' : '需要补充');
    return `
        <div class="mh-maker-health">
            <div class="mh-maker-health-title">${escapeHtml(`${title}（${stats.scenes}幕）`)}</div>
            <div class="mh-maker-health-grid">
                <span>${stats.actors} 位演员</span>
                <span>${stats.lines} 句对白</span>
                <span>${stats.activities} 个互动</span>
                <span>${stats.minigames} 个小游戏</span>
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
                <span><b>${escapeHtml(title)} × ${activityTotal(item)}</b><small>${escapeHtml(active ? '等待互动' : typeDef.label)}</small></span>
            </button>`;
    }
    return `
        <button type="button" class="mh-review-beat ${active ? 'is-active' : ''}" data-edit-scene data-edit-item="${itemIndex}">
            <span class="mh-review-beat-icon">💬</span>
            <span><b>${escapeHtml(actorNameForTimeline(story, item.actor))}</b><small>${escapeHtml(visibleLineText(item.text || '新的对白'))}</small></span>
        </button>`;
}

function renderReviewActionBar(sceneIndex, itemIndex, activity, actionProgress) {
    if (!isTimelineActivity(activity)) return '';
    const total = activityTotal(activity);
    const done = Math.min(total, actionProgress[reviewActionKey(sceneIndex, itemIndex, activity)] || 0);
    const left = Math.max(0, total - done);
    return `
        <div class="mh-review-action-bar mh-dock-row mh-scroll-x dock-action-row">
            <button type="button" class="btn-secondary action-btn dock-icon-btn mh-story-dock-action" data-review-action="${itemIndex}" ${left <= 0 ? 'disabled' : ''}>
                <span class="dock-icon">${activityIcon(activity)}</span>
                <span class="dock-label">${escapeHtml(activityTitle(activity))} × ${left}</span>
            </button>
        </div>`;
}

function reviewSubtitleText(story, scene, timeline, playbackState) {
    const active = playbackState.activeItem;
    if (!active) return scene?.subtitle || '这一幕播放完成。';
    if (isTimelineActivity(active)) {
        return scene?.subtitle || '';
    }
    return `${actorNameForTimeline(story, active.actor)}：${visibleLineText(active.text || active.say || '')}`;
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
        <button type="button" class="mh-review-layout-icon" data-review-layout-toggle="${next}" aria-label="切换预览布局" title="切换预览布局">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconPath}</svg>
        </button>`;
}

function renderReviewHtml(story, sceneIndex = 0, layout = defaultReviewLayout(), playback = null) {
    const reviewLayout = layout === 'landscape' ? 'landscape' : 'portrait';
    if (!story?.scenes?.length) {
        return `
            <div class="mh-maker-empty">
                生成故事后，这里会变成可滑看的故事预览。你可以先像试玩一样检查每一幕，再点某一幕微调细节。
            </div>
            <button type="button" class="btn-primary" data-maker-mode-to="draft">去生成故事</button>`;
    }
    if (sceneIndex < 0) {
        const actor = mainStoryActor(story);
        const pet = storyPetForActor(actor);
        return `
            <div class="mh-review-nav">
                <div class="mh-review-pager">
                    <button type="button" class="is-active mh-review-cover-tab" data-review-scene="-1">封面</button>
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
                        <div class="mh-review-cover-title">${escapeHtml(story.title || '我的宠物故事')}</div>
                        <div class="mh-review-cover-subtitle">${escapeHtml(story.selectionPrompt || '选择一位主角进入故事。')}</div>
                    </div>
                </div>
                ${renderStoryHealthHtml(story, '故事概要')}
                <button type="button" class="btn-primary" data-review-scene="0">进入第一幕</button>
            </section>
            <div class="mh-review-ai">
                <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更短、更适合手机快速游玩。">变短</button>
                <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更温暖，增加照顾宠物的情绪。">更温暖</button>
                <button type="button" class="mh-maker-mini" data-ai-tweak="至少加入一个合适的小游戏互动。">加小游戏</button>
                <button type="button" class="mh-maker-mini" data-ai-tweak="让对白更有趣，但保持儿童友好。">更有趣</button>
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
                <button type="button" class="mh-review-cover-tab" data-review-scene="-1">封面</button>
                ${story.scenes.map((item, index) => `<button type="button" class="${index === safeIndex ? 'is-active' : ''}" data-review-scene="${index}">${index + 1}</button>`).join('')}
            </div>
            ${renderReviewLayoutToggle(reviewLayout)}
        </div>
        <section class="mh-review-scene is-${reviewLayout}" data-edit-scene="${safeIndex}">
            <div class="mh-review-hero ${isTimelineActivity(playbackState.activeItem) ? 'has-action' : ''}" data-open-scene-maker data-scene-maker-index="${safeIndex}" role="button" tabindex="0" title="选择背景场景" style="background:${sceneBackgroundStyle(scene, safeIndex)}">
                <div class="mh-review-phone-canvas">
                    ${renderSceneParticles(scene)}
                    ${renderMusicToggleButton(sceneBgMusic(scene))}
                    <div class="mh-review-scene-label">第${safeIndex + 1}幕</div>
                    ${renderStoryStageActorsHtml(story, timeline, activeItemIndex)}
                    ${reviewSubtitleText(story, scene, timeline, playbackState) ? `<div class="mh-review-subtitle">${escapeHtml(reviewSubtitleText(story, scene, timeline, playbackState))}</div>` : ''}
                    ${renderReviewActionBar(safeIndex, activeItemIndex, playbackState.activeItem, playbackState.actionProgress)}
                </div>
            </div>
            <div class="mh-review-scene-detail">
                <div class="mh-review-beats">
                    ${timeline.length ? timeline.map((item, itemIndex) => renderBeatHtml(story, item, itemIndex, itemIndex === activeItemIndex)).join('') : '<div class="mh-maker-empty">这一幕还没有对白或互动。</div>'}
                </div>
            </div>
        </section>
        <div class="mh-review-ai">
            <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更短、更适合手机快速游玩。">变短</button>
            <button type="button" class="mh-maker-mini" data-ai-tweak="让故事更温暖，增加照顾宠物的情绪。">更温暖</button>
            <button type="button" class="mh-maker-mini" data-ai-tweak="至少加入一个合适的小游戏互动。">加小游戏</button>
            <button type="button" class="mh-maker-mini" data-ai-tweak="让对白更有趣，但保持儿童友好。">更有趣</button>
        </div>`;
}

export function renderStoryMaker(panel, data = {}, { onBack, onPlayStory } = {}) {
    const initialStory = data?.story || null;
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
                <button type="button" class="mh-maker-delete" data-maker-delete-actor="${escapeHtml(pet.id)}" aria-label="删除演员" title="删除演员">×</button>
                <span class="mh-maker-main-badge" style="display:${isMain ? 'block' : 'none'}">主角</span>
                <div class="mh-maker-art">${petArtHtml(pet, { alt: displayPetName(pet), requireProcessedTexture: false })}</div>
                <input class="mh-maker-name-input" data-maker-name maxlength="24" aria-label="演员名字" value="${escapeHtml(actorSettings.get(pet.id)?.name || displayPetName(pet))}">
            </div>`;
        }).join('') : '';
        return `${cards}
            <button type="button" class="mh-maker-pet mh-maker-add-card" data-maker-add-actor aria-label="添加演员" title="添加演员">
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

    const startReviewScenePlayback = (sceneIndex) => {
        if (!currentStory?.scenes?.[sceneIndex]) return;
        clearReviewPlaybackTimer();
        reviewSceneIndex = sceneIndex;
        reviewPlayback = { sceneIndex, stepIndex: 0, actionProgress: {} };
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
        reviewPlaybackTimer = setTimeout(() => {
            if (!reviewPlayback || reviewPlayback.sceneIndex !== reviewSceneIndex) return;
            reviewPlayback.stepIndex = Math.min(timeline.length, reviewPlayback.stepIndex + 1);
            renderReviewPanel();
            scheduleReviewPlayback();
        }, REVIEW_LINE_ADVANCE_MS);
    };

    const clickReviewAction = (itemIndex) => {
        if (!currentStory || !reviewPlayback || reviewPlayback.sceneIndex !== reviewSceneIndex || itemIndex !== reviewPlayback.stepIndex) return;
        const scene = currentStory.scenes[reviewPlayback.sceneIndex];
        const timeline = sceneTimeline(scene);
        const activity = timeline[itemIndex];
        if (!isTimelineActivity(activity)) return;
        const key = reviewActionKey(reviewPlayback.sceneIndex, itemIndex, activity);
        const total = activityTotal(activity);
        reviewPlayback.actionProgress[key] = Math.min(total, (reviewPlayback.actionProgress[key] || 0) + 1);
        if (reviewPlayback.actionProgress[key] >= total) reviewPlayback.stepIndex = Math.min(timeline.length, reviewPlayback.stepIndex + 1);
        renderReviewPanel();
        scheduleReviewPlayback();
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
                .mh-review-hero { width:min(100%,230px); aspect-ratio:9/16; min-height:0; align-self:center; border-radius:22px; position:relative; overflow:hidden; display:block; border:3px solid rgba(255,255,255,.9); box-shadow:0 0 0 2px rgba(14,165,233,.3),0 10px 26px rgba(15,39,71,.18),inset 0 0 0 1px rgba(15,39,71,.08); cursor:pointer; background-size:cover; background-position:center; container-type:inline-size; }
                .mh-review-hero:focus-visible { outline:3px solid rgba(14,165,233,.45); outline-offset:3px; }
                .mh-review-phone-canvas { --mh-phone-rem:2.777777cqw; position:absolute; inset:0; overflow:hidden; border-radius:inherit; font-size:var(--mh-phone-rem); }
                .mh-review-phone-canvas::before { content:''; position:absolute; top:.8em; left:50%; z-index:6; width:8.4em; height:.55em; border-radius:999px; background:rgba(15,39,71,.2); transform:translateX(-50%); box-shadow:0 1px 0 rgba(255,255,255,.45); pointer-events:none; }
                .mh-review-phone-canvas::after { content:''; position:absolute; left:50%; bottom:.7em; z-index:6; width:10.2em; height:.42em; border-radius:999px; background:rgba(15,39,71,.24); transform:translateX(-50%); pointer-events:none; }
                .mh-review-music-toggle { position:absolute; top:1.8em; right:1em; z-index:8; width:3.4em; height:3.4em; border-radius:1em; border:.18em solid rgba(255,255,255,.92); background:rgba(14,165,233,.92); color:white; font-size:1em; font-weight:900; line-height:1; display:grid; place-items:center; box-shadow:0 .35em 0 rgba(37,99,235,.34),0 .7em 1.5em rgba(15,39,71,.16); }
                .mh-review-music-toggle.is-muted { background:rgba(255,255,255,.92); color:var(--accent-dark); }
                .mh-review-pet { width:min(210px,58vw); height:min(210px,58vw); display:block; position:relative; z-index:2; }
                .mh-review-stage-cast { position:absolute; inset:0; z-index:2; transform-origin:50% 54%; transition:transform .42s ease; }
                .mh-review-stage-cast.is-zooming { transform:scale(1.08); }
                .mh-review-stage-actor { position:absolute; width:9.2em; height:9.2em; transform:translateX(-50%) scale(var(--stage-scale,1)); transform-origin:50% 100%; transition:left .38s ease,bottom .38s ease,transform .38s ease,filter .38s ease; }
                .mh-review-stage-actor.is-speaking { z-index:3; filter:drop-shadow(0 .8em 1em rgba(14,116,144,.24)); transform:translateX(-50%) scale(calc(var(--stage-scale,1) * 1.16)); }
                .mh-review-stage-actor.is-sleep { opacity:.82; }
                .mh-review-stage-actor.is-sad { filter:saturate(.84) drop-shadow(0 .6em .8em rgba(15,39,71,.18)); }
                .mh-review-stage-actor.is-happy { filter:saturate(1.14) drop-shadow(0 .8em 1em rgba(14,116,144,.22)); }
                .mh-review-subtitle { position:absolute; left:1em; right:1em; bottom:2em; border-radius:1.3em; background:rgba(15,39,71,.78); color:white; padding:.8em 1em; text-align:center; font-size:1.4em; font-weight:900; line-height:1.35; z-index:3; max-height:5.8em; overflow:hidden; }
                .mh-review-scene-label { position:absolute; top:2.2em; left:1em; z-index:4; border-radius:999px; background:rgba(255,255,255,.88); color:var(--accent-dark); font-size:1.2em; font-weight:900; padding:.5em .9em; box-shadow:0 .2em .8em rgba(15,39,71,.14); }
                .mh-review-scene-detail { display:flex; flex-direction:column; gap:10px; min-width:0; }
                .mh-review-titlebar { display:flex; align-items:center; justify-content:space-between; gap:8px; }
                .mh-review-titlebar strong { display:block; font-size:15px; color:var(--text-primary); }
                .mh-review-beats { display:flex; flex-direction:column; gap:7px; }
                .mh-review-beat { width:100%; border:1.5px solid rgba(14,165,233,.28); border-radius:13px; background:#f8fdff; padding:9px; display:grid; grid-template-columns:34px minmax(0,1fr); gap:8px; align-items:center; text-align:left; color:var(--text-primary); }
                .mh-review-beat.is-activity { border-color:rgba(245,158,11,.42); background:#fffbeb; }
                .mh-review-beat.is-active { box-shadow:0 0 0 3px rgba(14,165,233,.18); }
                .mh-review-beat-icon { width:34px; height:34px; border-radius:12px; display:grid; place-items:center; background:rgba(255,255,255,.82); font-size:18px; }
                .mh-review-beat b { display:block; font-size:13px; color:var(--accent-dark); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .mh-review-beat small { display:block; font-size:13px; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
                .mh-review-hero.has-action .mh-review-subtitle { bottom:7em; font-size:1.2em; padding:.6em .8em; line-height:1.25; max-height:4.8em; }
                .mh-review-action-bar { position:absolute; left:.9em; right:.9em; bottom:1.7em; z-index:5; justify-content:flex-start; gap:.6em; padding:0; margin:0; overflow-x:auto; }
                .mh-review-action-bar .mh-story-dock-action { min-width:6.8em; height:5em; padding:.45em .55em; border-radius:1.3em; gap:.25em; font-size:var(--mh-phone-rem); line-height:1.05; border-color:rgba(14,165,233,.48); background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.16)),linear-gradient(135deg,#ecfeff,#bae6fd); box-shadow:0 .4em 0 rgba(14,116,144,.24),0 .8em 1.6em rgba(15,39,71,.12),inset 0 .1em 0 rgba(255,255,255,.85); }
                .mh-review-action-bar .mh-story-dock-action .dock-icon { font-size:1.7em; }
                .mh-review-action-bar .mh-story-dock-action .dock-label { max-width:6em; font-size:1em; font-weight:900; color:var(--accent-dark); }
                .mh-review-action-bar.is-idle { min-height:4.4em; border:.15em dashed rgba(14,165,233,.28); border-radius:1.4em; background:rgba(239,250,255,.72); display:grid; place-items:center; color:var(--text-muted); font-size:1.2em; font-weight:900; }
                .mh-review-ai { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:14px; }
                .mh-review-scene.is-portrait .mh-review-pet { width:min(190px,46vw); height:min(190px,46vw); }
                .mh-review-cover.is-landscape .mh-review-cover-main { display:grid; grid-template-columns:minmax(0,1.12fr) minmax(150px,.88fr); align-items:stretch; text-align:left; }
                .mh-review-cover.is-landscape .mh-review-cover-art { width:min(100%,220px); justify-self:center; }
                .mh-review-cover.is-landscape .mh-review-cover-info { justify-content:center; padding:8px 4px; }
                .mh-review-scene.is-landscape { display:grid; grid-template-columns:minmax(0,1.18fr) minmax(150px,.82fr); align-items:start; }
                .mh-review-scene.is-landscape .mh-review-hero { width:min(100%,220px); align-self:start; justify-self:center; }
                .mh-review-scene.is-landscape .mh-review-pet { width:min(210px,36vw); height:min(210px,36vw); }
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
                    <span class="font-bold" style="color:var(--text-primary)">故事创作</span>
                    <button id="mhMakerSave" class="btn-primary mh-maker-save-top">保存</button>
                </div>
                <div class="mh-maker-tabs">
                    <button type="button" data-maker-mode="draft">创作</button>
                    <button type="button" data-maker-mode="review">预览</button>
                    <button type="button" data-maker-play>试玩</button>
                    <button type="button" data-maker-mode="advanced">高级</button>
                </div>
                </div>
                <div class="mh-maker-body">
                    <section class="mh-maker-panel" data-maker-panel="draft">
                    <div class="card-flat">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                            <div style="font-size:14px;font-weight:900">选择演员</div>
                        </div>
                        <div class="mh-maker-pets" id="mhMakerActorList">
                            ${actorCardsHtml()}
                        </div>
                    </div>
                    <div class="card-flat" style="display:flex;flex-direction:column;gap:9px">
                        <label style="font-size:13px;font-weight:900;color:var(--text-primary)">故事提示词</label>
                        <textarea id="mhMakerPrompt" class="modal-input" style="min-height:92px" placeholder="例如：抱抱龙在星球上发现一颗会唱歌的水晶，需要照顾伙伴并完成小游戏。"></textarea>
                        <input id="mhMakerSceneCount" type="hidden" value="${DEFAULT_SCENE_COUNT}">
                        <div class="mh-maker-presets">
                            <button type="button" data-scene-count="3">短故事</button>
                            <button type="button" class="is-active" data-scene-count="5">标准</button>
                            <button type="button" data-scene-count="8">长故事</button>
                        </div>
                        <button id="mhMakerGenerate" class="btn-primary" ${busy ? 'disabled' : ''}>${busy ? '生成中...' : 'AI 生成故事'}</button>
                        <div id="mhMakerStatus" class="mh-maker-status">等待生成。</div>
                    </div>
                    <div id="mhMakerDraftSummary">${renderStoryHealthHtml(currentStory)}</div>
                    </section>
                    <section class="mh-maker-panel" data-maker-panel="review">
                        <div id="mhMakerReview">${renderReviewHtml(currentStory, reviewSceneIndex, reviewLayout)}</div>
                    </section>
                    <section class="mh-maker-panel" data-maker-panel="advanced">
                    <div class="mh-advanced-tabs" aria-label="高级编辑模式">
                        <button type="button" class="${advancedTab === 'visual' ? 'is-active' : ''}" data-advanced-tab="visual">可视化编辑</button>
                        <button type="button" class="${advancedTab === 'json' ? 'is-active' : ''}" data-advanced-tab="json">JSON文本</button>
                    </div>
                    <div class="card-flat mh-advanced-panel ${advancedTab === 'visual' ? 'is-active' : ''}" data-advanced-panel="visual">
                        <div style="font-size:14px;font-weight:900">详细时间轴</div>
                        <div id="mhMakerSceneEditor" class="mh-scene-stack">${renderSceneEditorHtml(currentStory)}</div>
                    </div>
                    <div class="card-flat mh-advanced-panel ${advancedTab === 'json' ? 'is-active' : ''}" data-advanced-panel="json">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                            <div>
                                <div style="font-size:14px;font-weight:900">JSON 数据</div>
                                <div class="mh-maker-status">完整故事 JSON，可直接编辑、粘贴后保存。</div>
                            </div>
                            <button id="mhMakerFormat" class="btn-primary">保存</button>
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
                showToast('JSON 格式错误，暂时停留在文本编辑', 'error');
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
            if (!quiet) showToast('请先生成或粘贴故事 JSON', 'info');
            return null;
        }
        const parsed = extractJson(text);
        if (!parsed) {
            if (!quiet) showToast('JSON 格式错误，无法解析', 'error');
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
                const type = row.querySelector('[data-activity-type]')?.value || 'comfort';
                const def = ACTIVITY_TYPES.find(item => item.value === type) || ACTIVITY_TYPES[3];
                return normalizeActivity({
                    type,
                    actionKey: def.actionKey,
                    source: row.querySelector('[data-activity-source]')?.value || def.source,
                    title: row.querySelector('[data-activity-title]')?.value || def.label,
                    count: Math.max(1, Number(row.querySelector('[data-activity-count]')?.value) || 1),
                    gameId: row.querySelector('[data-activity-game]')?.value || 'pet_tower_defense',
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
                    <strong>第${sceneIndex + 1}幕</strong>
                    <button type="button" class="mh-maker-mini" data-close-edit-sheet>完成</button>
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

    function openGenerationModal(title = 'AI 正在生成故事') {
        document.getElementById('mhMakerStreamModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'mhMakerStreamModal';
        modal.className = 'mh-maker-stream-modal';
        modal.innerHTML = `
            <div class="mh-maker-stream-panel">
                <div class="mh-maker-stream-head">
                    <strong>${escapeHtml(title)}</strong>
                    <button type="button" class="mh-maker-mini danger" data-abort-generation>终止</button>
                </div>
                <div class="mh-maker-stream-hint">请耐心等待，AI 会把内容实时写到下面。生成完成后会自动关闭。</div>
                <div id="mhMakerStreamOutput" class="mh-maker-stream-output is-empty">等待 AI 返回内容...</div>
                <div class="mh-maker-stream-actions">
                    <button type="button" class="btn-secondary" data-abort-generation>终止生成</button>
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

    function abortGeneration() {
        if (!generationController || generationController.signal.aborted) return;
        generationController.abort();
        setStatus('已终止生成。');
        showToast('已终止生成', 'info', 1600);
        closeGenerationModal();
    }

    async function runGenerate(tweakText = '') {
        if (busy) return;
        const actors = selectedActorsFromPanel(panel);
        if (!actors.length) { showToast('请至少选择一只宠物演员', 'info'); return; }
        busy = true;
        const generateBtn = $('mhMakerGenerate');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.textContent = tweakText ? '调整中...' : '生成中...';
        }
        generationController = new AbortController();
        openGenerationModal(tweakText ? 'AI 正在调整故事' : 'AI 正在生成故事');
        const previousStory = currentStory;
        const previousStoryJson = tweakText && currentStory ? JSON.stringify(currentStory) : '';
        setJsonText('');
        currentStory = null;
        refreshStoryPanels();
        setStatus(tweakText ? 'AI 正在重新调整故事...' : 'AI 正在流式生成故事...');
        try {
            const count = Math.max(1, Math.min(12, Number($('mhMakerSceneCount')?.value) || DEFAULT_SCENE_COUNT));
            const basePrompt = $('mhMakerPrompt')?.value || '';
            const prompt = tweakText
                ? `${basePrompt || '温暖的宠物冒险'}\n调整要求：${tweakText}\n请基于当前故事继续修改，不要丢失原有演员和可玩结构。\n当前故事 JSON：${previousStoryJson}`
                : basePrompt;
            try {
                const result = await generateStoryWithAI(prompt, count, actors, {
                    signal: generationController.signal,
                    abortController: generationController,
                    onChunk: (_delta, fullText) => {
                        setJsonText(fullText);
                        setGenerationModalText(fullText);
                        setStatus(`AI 正在生成... ${fullText.length} 字`);
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
                currentStory = await assignPresetScenesToStory(fallbackStory(prompt, count, actors));
                showToast('AI 生成不可用，已创建可编辑草稿', 'info', 2200);
            }
            reviewSceneIndex = -1;
            syncJsonFromStory();
            refreshStoryPanels();
            setMode('review');
            setStatus(`已生成 ${currentStory.scenes.length} 幕，可在预览中检查和微调。`);
            showToast('故事已生成', 'success', 1600);
        } finally {
            generationController = null;
            closeGenerationModal();
            busy = false;
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.textContent = 'AI 生成故事';
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
        readActorSettings();
        const overlay = document.createElement('div');
        overlay.className = 'mh-maker-actor-picker';
        overlay.style.cssText = 'position:absolute;inset:0;z-index:30;background:var(--bg-page,#e0f7ff)';
        panel.appendChild(overlay);
        const close = () => overlay.remove();
        const rerender = () => renderPetList(overlay, { pets: petListRecords() }, {
            pickerMode: true,
            multiple: true,
            selectedIds: actorPetIds,
            title: '添加演员',
            confirmText: '加入舞台',
            onBack: close,
            onLoadPet: async (id) => {
                await loadPet(id).catch(() => null);
                if (overlay.isConnected) rerender();
            },
            onConfirm: async (ids) => {
                const uniqueIds = [...new Set(ids.filter(Boolean))];
                if (!uniqueIds.length) { showToast('请至少选择一只宠物演员', 'info'); return; }
                await ensureActorPetsLoaded(uniqueIds);
                readActorSettings();
                actorPetIds = uniqueIds.filter(id => state.pets?.[id]);
                if (!actorPetIds.length) { showToast('选择的宠物资料还没有加载完成', 'info'); return; }
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
            setStatus(`已解析 ${currentStory.scenes.length} 幕，可继续编辑。`);
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
        setStatus(`已解析 ${currentStory.scenes.length} 幕，可继续编辑。`);
        return currentStory;
    }

    async function saveCurrentStory() {
        const story = parseEditorStory();
        if (!story) return;
        try {
            const result = await saveWorkspaceStory(story, story.id || story.title);
            $('mhMakerSaved').textContent = `已保存到 ${result.path}，分享参数：?story=${result.path}`;
            showToast('故事已保存', 'success');
        } catch (e) {
            showToast('保存失败：' + (e?.message || e), 'error');
        }
    }

    function playCurrentStory() {
        const story = parseEditorStory();
        if (!story) return;
        onPlayStory?.(story);
    }

    function addLine(sceneIndex) {
        currentStory = readStoryFromSceneEditor() || currentStory;
        const scene = currentStory?.scenes?.[sceneIndex];
        if (!scene) return;
        scene.timeline = sceneTimeline(scene);
        scene.timeline.push({ kind: 'line', actor: '$selected', text: '新的对白。' });
        Object.assign(scene, sceneFromTimeline(scene, sceneIndex));
        refreshStoryPanels();
        syncJsonFromStory();
    }

    function addActivity(sceneIndex) {
        currentStory = readStoryFromSceneEditor() || currentStory;
        const scene = currentStory?.scenes?.[sceneIndex];
        if (!scene) return;
        scene.timeline = sceneTimeline(scene);
        scene.timeline.push(normalizeActivity({ type: 'tap', title: '轻拍互动', count: 1, successText: '完成啦。' }));
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
            showToast('打开场景素材失败：' + (e?.message || e), 'error');
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
        $('mhMakerBack').onclick = () => onBack?.();
        $('mhMakerGenerate').onclick = () => runGenerate();
        $('mhMakerFormat').onclick = saveCurrentStory;
        $('mhMakerSave').onclick = saveCurrentStory;
        panel.addEventListener('input', (e) => {
            if (e.target.closest?.('#mhMakerActorList')) {
                readActorSettings();
                syncStoryActorsAfterPicker();
                return;
            }
            if (e.target.closest?.('#mhMakerSceneEditor') || e.target.closest?.('#mhMakerEditSheet')) syncSceneEditorToJson();
        });
        panel.addEventListener('change', (e) => {
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
                const source = row.querySelector('[data-activity-source]');
                const def = ACTIVITY_TYPES.find(item => item.value === e.target.value);
                if (source && def) source.value = def.source;
            }
            if (e.target.closest?.('#mhMakerSceneEditor') || e.target.closest?.('#mhMakerEditSheet')) syncSceneEditorToJson();
        });
        panel.addEventListener('pointerdown', (e) => {
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
        });
        panel.addEventListener('pointermove', (e) => {
            if (!reviewPagerDrag || reviewPagerDrag.pointerId !== e.pointerId) return;
            const deltaX = e.clientX - reviewPagerDrag.startX;
            if (Math.abs(deltaX) > 4) {
                reviewPagerDrag.moved = true;
                suppressReviewPagerClick = true;
            }
            reviewPagerDrag.pager.scrollLeft = reviewPagerDrag.scrollLeft - deltaX;
            if (reviewPagerDrag.moved) e.preventDefault();
        });
        panel.addEventListener('pointerup', (e) => {
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
        });
        panel.addEventListener('pointercancel', (e) => {
            if (reviewPagerDrag && reviewPagerDrag.pointerId === e.pointerId) {
                reviewPagerDrag.pager.classList.remove('is-dragging');
                reviewPagerDrag = null;
            }
            actorPress = null;
        });
        panel.addEventListener('click', (e) => {
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
        });
    }

    draw();
    ensureActorPetsLoaded().then(() => {
        if (panel?.isConnected) renderActorCards();
    });
}
