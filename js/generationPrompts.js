import { dnaToPrompt } from './dna.js';

function splitPromptTags(value) {
    const raw = Array.isArray(value) ? value : String(value || '').replace(/[，、；;|/]/g, ',').split(',');
    return [...new Set(raw.map(item => String(item || '').trim()).filter(Boolean))];
}

function buildTraitPrompt(name = '', traits = {}) {
    const safeTraits = traits && typeof traits === 'object' && !Array.isArray(traits) ? traits : {};
    const knownKeys = new Set(['element', 'elementalAttribute', 'species', 'color', 'eyes', 'accessory']);
    const extraTraits = Object.entries(safeTraits)
        .filter(([key, value]) => !knownKeys.has(key) && value != null && value !== '')
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    const appearance = [
        name ? `名字：${name}` : '',
        `血统：${safeTraits.element || '未指定'}`,
        `元素属性：${safeTraits.elementalAttribute || '未指定'}`,
        `种类：${safeTraits.species || '未指定'}`,
        `颜色：${safeTraits.color || '未指定'}`,
        `眼睛：${safeTraits.eyes || '未指定'}`,
        `配饰：${safeTraits.accessory || '未指定'}`,
        extraTraits.length ? `额外 traits：${extraTraits.join('，')}` : '',
    ].filter(Boolean).join('；');
    return `${appearance}。`;
}

function buildActorAppearance(actor = {}) {
    const pet = actor.petTemplate || actor.pet || {};
    const traits = pet.traits && typeof pet.traits === 'object' && !Array.isArray(pet.traits) ? pet.traits : {};
    return [
        traits.color,
        traits.elementalAttribute ? `${traits.elementalAttribute}属性` : '',
        traits.species,
        traits.element ? `${traits.element}血统` : '',
        traits.eyes,
        traits.accessory && traits.accessory !== '没有任何配饰' ? traits.accessory : '',
    ].filter(Boolean).join('，') || pet.name || actor.name || '可爱的宠物角色';
}

function normalizePetSheetBackgroundColor(value) {
    const color = String(value || '').trim().toLowerCase();
    return color === '#000000' ? '#000000' : '#ffffff';
}

export function buildStoryPrompt(promptText, count, actors = [], options = {}) {
    const sceneTagPromptHint = options.sceneTagPromptHint || 'indoor, outdoor, land, sky, ocean, playground, bathroom, living room, shop, school, spring, winter, seaside, haqi, townhall, forest, sand, hospital';
    const bgMusicKeys = Array.isArray(options.bgMusicKeys) ? options.bgMusicKeys : [];
    const minigames = Array.isArray(options.minigames) ? options.minigames : [];
    const lang = options.lang === 'en' ? 'en' : 'zh';
    const langName = lang === 'en' ? 'English' : '简体中文';
    const languageInstruction = lang === 'en'
        ? `Output language: ALL player-facing text (title, selectionPrompt, every timeline line text, activity title/successText, ending subtitle/text) MUST be written in English, unless the story theme explicitly requests another language. Do NOT use Chinese for player-facing text. JSON keys and enum values (kind, type, sceneTags, gameId, bgMusic, etc.) stay in English as defined.`
        : `输出语言：所有面向玩家的文字（title、selectionPrompt、每条 timeline line 的 text、activity 的 title/successText、ending 的 subtitle/text）都必须使用简体中文，除非故事主题明确要求使用其他语言。JSON 的 key 和枚举值（kind、type、sceneTags、gameId、bgMusic 等）保持英文不变。`;
    const promptActors = actors.map((actor, index) => ({
        id: `actor_${index + 1}`,
        name: actor.name,
        sourcePetId: actor.sourcePetId || actor.petTemplate?.id || actor.pet?.id || '',
        allowUserSelection: actor.allowUserSelection,
        isMainActor: actor.isMainActor,
        appearance: buildActorAppearance(actor),
    }));
    const fallbackActors = [
        { id: 'actor_1', name: '小露', sourcePetId: 'pet_demo1', isMainActor: true, appearance: '蓝色水系小鹿，亮晶晶的眼睛，戴着小铃铛' },
        { id: 'actor_2', name: '阿团', sourcePetId: 'pet_demo2', isMainActor: false, appearance: '杏色圆圆小伙伴，生命属性，系着围巾' },
    ];
    const sampleActors = promptActors.length ? promptActors : fallbackActors;
    const actorA = sampleActors[0] || { id: '$selected', name: '主角' };
    const actorB = sampleActors[1] || actorA;
    const exampleStory = {
        id: 'story_example_helping_water',
        title: '一桶水的约定',
        version: 1,
        selectionPrompt: '选择一位主角，带大家完成今天的约定。',
        actors: sampleActors,
        startSceneId: 'scene_1',
        scenes: [
            {
                id: 'scene_1',
                sceneTags: ['mountain', 'spring', 'outdoor'],
                background: { type: 'color', color: '#bae6fd'},
                particles: ['sparkle'],
                bgMusic: 'forest',
                timeline: [
                    { kind: 'line', actor: '$narrator', text: '山上的小屋快没水了，水桶安静地躺在门口。' },
                    { kind: 'line', actor: actorA.id, text: `(左侧，开心)${actorA.name}，我们一起去打水吧。` },
                    { kind: 'line', actor: actorB.id, text: `(右侧)好呀，一个人累，两个人就轻一点。` },
                    { kind: 'activity', type: 'tap', title: '拍手约定', count: 3, successText: '大家说好轮流帮忙。' },
                ],
            },
            {
                id: 'scene_2',
                sceneTags: ['living room', 'indoor'],
                background: { type: 'color', color: '#fde68a'},
                particles: [],
                bgMusic: 'select',
                timeline: [
                    { kind: 'line', actor: '$narrator', text: '到了第二天，谁也不想先拿水桶。' },
                    { kind: 'line', actor: actorA.id, text: `(中间，伤心)如果大家都等别人，小屋就没有水喝了。` },
                    { kind: 'activity', type: 'feed', target: actorA.id, title: '补充力气', count: 2, successText: '有力气，就能多帮一点忙。' },
                    { kind: 'activity', type: 'bath', target: actorB.id, title: '洗干净水桶', count: 1, successText: '水桶亮晶晶，可以装清水了。' },
                    { kind: 'line', actor: actorB.id, text: `(近处，开心)那我们做一张轮值表吧。` },
                ],
            },
            {
                id: 'scene_3',
                sceneTags: ['forest', 'outdoor'],
                background: { type: 'color', color: '#bbf7d0'},
                particles: ['petals'],
                bgMusic: 'forest',
                timeline: [
                    { kind: 'line', actor: '$narrator', text: '小路被弯弯的小渠挡住了，清水还差最后一步。' },
                    { kind: 'activity', type: 'minigame', title: '完成运水小游戏', gameId: 'canal_escape', gameTitle: '宠物运河营救', count: 1, successText: '清水顺着小渠流回来了。' },
                    { kind: 'line', actor: actorA.id, text: `(中间，开心)我们真的把水带回来了！` },
                ],
            },
        ],
        ending: { subtitle: '大家学会了分工。', text: '一个人推给别人，水桶会空；大家各尽一份力，清水就会回来。' },
    };
    const childAudienceLine = lang === 'en'
        ? 'For children: short warm sentences, vivid and visual; avoid long preachy paragraphs, hide the moral in the actions and the ending.'
        : '面向儿童：短句、温暖、有画面感；避免说教长段落，把寓意藏在行动和结尾里。';
    return [
        '你是儿童互动故事设计师。请为一个移动端虚拟宠物游戏生成高质量互动故事 JSON。只返回合法 JSON，不要 markdown，不要解释。',
        languageInstruction,
        `故事主题：${promptText || '温暖的宠物冒险'}`,
        `必须生成 ${count} 个 scenes，不能少也不能多。`,
        '故事质量要求：有清晰开端、问题升级、一次可玩的互动选择、角色合作解决、结尾点出寓意；不要流水账；每幕都要推动剧情。',
        childAudienceLine,
        '顶层字段必须包含：id, title, version, selectionPrompt, actors, startSceneId, scenes, ending。',
        'actors 字段必须基于下面的输入演员数组，保留 sourcePetId/allowUserSelection/isMainActor，不要删角色、不要改 sourcePetId、不要发明新演员。id 是故事内角色 id，可以保留 actor_1/actor_2/actor_3，也可以根据剧情需要改成更有意义的 id；name 可以保留，也可以根据故事改动。appearance 只作为外观参考，不要求输出。',
        `输入演员数组：${JSON.stringify(promptActors)}`,
        'timeline 里对白 actor 必须只使用："$narrator"、"$selected"，或最终 actors 数组里的 id。主角对白优先使用主角 actor id。activity.target 也必须使用最终 actors 数组里的 id。',
        '每个 scene 字段：id, sceneTags, background, particles, bgMusic, timeline。不要使用 subtitle 字段；旁白/字幕必须写成 timeline 里的 line，actor 使用 "$narrator"。background 先使用 {"type":"color","color":"#bae6fd","imageUrl":""}。',
        `sceneTags 用英文短标签数组，优先从这些标签里选择：${sceneTagPromptHint}。每幕给 2-5 个标签，用来低成本匹配预生成背景图。`,
        'particles 是粒子效果数组，可选 sparkle, snow, rain, mist, bubbles, petals, embers；没有需要可为空数组。',
        `bgMusic 是背景音乐 key，可为空字符串；可选：${bgMusicKeys.join(', ')}。`,
        'timeline 是完整时间顺序数组，元素 kind 为 line 或 activity。每幕 3-6 个 timeline 元素，其中 2-4 条对白，0-2 个活动，允许 line/activity 交错。',
        'line 格式 {"kind":"line","actor":"actor_pet_xxx","text":"..."}；旁白格式 {"kind":"line","actor":"$narrator","text":"..."}。',
        '人物对白可以用开头括号写舞台指示，例如 "(左侧，开心)我们出发吧"、"(中间)看这里"、"(远处,睡觉)呼呼"、"(近处,伤心)我有点难过"。括号中的文字只表示角色在场景里的位置/动作，播放时不显示。没有括号时，角色会自动在画面中间区域随机排开，并保持安全距离。',
        'activity 只支持四种 type：feed, bath, tap, minigame。不要输出其他 type。只输出 kind, type, title, count, successText；feed/bath/tap 可额外输出 target；minigame 必须额外输出 gameId，可输出 gameTitle。',
        'target 是可选的演员 id，只能使用 "$selected" 或输入演员数组里的 id；省略 target 表示任意演员都可以完成该互动。',
        `可用 minigame id: ${minigames.map(game => `${game.id}=${game.title}`).join(', ')}。`,
        '每个故事至少包含 2 个 activity，其中至少 1 个是 tap/feed/bath，最多 1 个 minigame。activity 的 successText 要和剧情结果有关。',
        '活动格式示例 {"kind":"activity","type":"feed","target":"actor_pet_xxx","title":"补充力气","count":3,"successText":"大家又有力气去帮忙了。"}。小游戏示例 {"kind":"activity","type":"minigame","title":"完成运水小游戏","gameId":"canal_escape","gameTitle":"宠物运河营救","count":1,"successText":"清水顺着小渠流回来了。"}。',
        '参考 JSON 示例如下。只学习结构、节奏、对白颗粒度和互动写法；不要照抄标题、情节；实际输出必须使用输入演员数组，并生成指定场景数量。',
        JSON.stringify(exampleStory, null, 2),
    ].join('\n');
}

export function buildPetSheetPrompt(dna, name = '', options = {}) {
    const customPrompt = (options && typeof options.customPrompt === 'string')
        ? options.customPrompt.trim()
        : '';
    const referenceImage = (options && typeof options.referenceImage === 'string')
        ? options.referenceImage.trim()
        : '';
    const traits = options && options.traits && typeof options.traits === 'object' && !Array.isArray(options.traits)
        ? options.traits
        : null;
    const backgroundColor = normalizePetSheetBackgroundColor(options?.backgroundColor);
    const backgroundName = backgroundColor === '#000000' ? '纯黑色' : '纯白色';
    const traitPrompt = traits ? buildTraitPrompt(name, traits) : '';
    const dnaPrompt = traitPrompt ? '' : dnaToPrompt(dna, { name });
    const sheetTheme = '';
    const base = traitPrompt
        ? [
            sheetTheme,
            customPrompt ? `核心外观：${customPrompt}。` : '',
            traitPrompt,
        ].join(' ')
        : customPrompt
        ? [
            sheetTheme,
            `玩家许愿外观（最高优先级，必须具体体现在宠物种类、身体结构、颜色、眼睛、装饰或气质上）：${customPrompt}。`,
            '如果玩家许愿与默认 DNA 外观有冲突，以玩家许愿为准；DNA 只作为补充灵感，不要覆盖玩家许愿。',
            `默认 DNA 灵感（低优先级，仅用于补充没有被许愿指定的细节）：${dnaPrompt}`,
        ].join(' ')
        : [sheetTheme, dnaPrompt].join(' ');

    return [
        base,
        traitPrompt ? '重要：生成结果必须一眼能看出外观特征。' : (customPrompt ? '重要：生成结果必须一眼能看出玩家许愿的核心内容。' : ''),
        referenceImage ? '参考图片是玩家提供的外观方向，请提取其中的主要轮廓、颜色、纹理、配饰或气质；不要照搬照片背景或文字。' : '',
        '生成一张 4×4 共 16 格的精灵图（sprite sheet），所有格子尺寸相同、严格对齐网格、单元间无缝隙；绝对不要生成任何格子分隔线。',
        '4 个成长阶段的宠物在各自格子中的视觉尺寸必须保持一致，不要因为年龄变化而明显变大或变小；做动作时也必须完整留在格子内，头部、身体、四肢、尾巴、耳朵、翅膀、配饰和特效都不能超出格子或被裁切。',
        '每一行代表同一只宠物的同一成长阶段（共 4 个阶段）：第 1 行=宝宝/幼年（圆圆大头，身体极小，只露出小短手小短脚，像头部占画面主体的婴儿萌宠, 不要暴漏主要生物特征和元素特征），第 2 行=青少年（圆润可爱的卡通比例，可以展示没有完全发育的主要生物特征），第 3 行=成年（仍然保持卡通萌宠比例，呈现出完整的主要生物特点），第 4 行=隐藏形态（仍然保持卡通萌宠比例，是更稀有、更神秘的隐藏进化形态，强化元素特征，加入独特的纹路或饰物等隐藏特效，让人一眼看出与成年形态不同）。',
        '每一行的 4 列代表同一阶段下的 4 种情绪/状态：第 1 列=idle（待机、自然站立、平静微笑），第 2 列=happy（开心、咧嘴大笑、雀跃姿态），第 3 列=sad（难过、眼角垂泪、垂头丧气），第 4 列=sleep（睡觉、闭眼、放松或蜷缩, 可正对，背对或侧卧等姿势皆可）。同一行的 4 个变体必须保持相同的种类、毛色、配饰，明显是同一只宠物。',
        `严格背景要求：背景必须是**完全${backgroundName} ${backgroundColor}** 填充整张图（每个格子内的背景也都是${backgroundName}），16 格之间也必须连续${backgroundName}，不能有任何分隔线；`,
        '风格要求（重要）：超扁平 2D 卡通插画，整体必须是圆润可爱的卡通萌宠比例；宝宝阶段要更夸张，几乎只有头。描边只能是清晰实线，宠物外轮廓绝对不能发光。不要3D皮克斯风格，不要阴影，不要投影，不要复杂光照，不要任何文字，不要超出格子,不要绘制格子。',
    ].filter(Boolean).join(' ');
}

export function buildSceneImagePrompt(promptText, tags = [], referenceCount = 0, options = {}) {
    const normalizeTags = typeof options.normalizeTags === 'function' ? options.normalizeTags : splitPromptTags;
    const description = String(promptText || options.title || '').trim() || '温暖的2D游戏场景背景图';
    return [
        '生成一个卡通风格的2D游戏场景背景图，采用第一人称视角往下微微俯视，只要场景，不要角色，不要文字，不要水印。',
        '严格禁止黑边，画面内容必须铺满整张图片。',
        '用途：这张图相当于是 2D 横版滚动游戏的背景图，画面需要有横向延展感和清晰的前景、中景、远景层次。',
        `场景描述：${description}`,
        `场景标签：${normalizeTags(tags).join(', ') || 'haqi, spring, outdoor'}`,
        referenceCount ? `参考图数量：${referenceCount}。请提取构图、颜色和材质作为参考，不要复制文字或人物。` : '',
        '风格：明亮、干净、童话感、适合手机故事播放器，画面中央保留空地。',
    ].filter(Boolean).join('\n');
}