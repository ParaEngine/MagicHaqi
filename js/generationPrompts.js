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
        traitPrompt ? '重要：生成结果必须一眼能看出当前配置属性中的种类、血统、元素属性、颜色、眼睛和配饰；不要出现与这些属性冲突的外观。' : (customPrompt ? '重要：生成结果必须一眼能看出玩家许愿的核心内容，不能只生成普通随机萌宠。' : ''),
        referenceImage ? '参考图片是玩家提供的外观方向，请提取其中的主要轮廓、颜色、纹理、配饰或气质，并转化成同一只二头身萌宠；不要照搬照片背景或文字。' : '',
        '生成一张 4×4 共 16 格的精灵图（sprite sheet），所有格子尺寸相同、严格对齐网格、单元间无缝隙。',
        '4 个成长阶段的宠物在各自格子中的视觉尺寸必须保持一致，不要因为年龄变化而明显变大或变小；做动作时也必须完整留在格子内，头部、身体、四肢、尾巴、耳朵、翅膀、配饰和特效都不能超出格子或被裁切。',
        '每一行代表同一只宠物的同一成长阶段（共 4 个阶段）：第 1 行=宝宝/幼年（几乎只有一个圆圆大头，身体极小，只露出小短手小短脚，像头部占画面主体的婴儿萌宠, 不要暴漏主要生物特征和元素特征），第 2 行=青少年（标准二头身，可以展示没有完全发育的主要生物特征），第 3 行=成年（仍然是二头身，呈现出完整的主要生物特点），第 4 行=年长/长老（仍然是二头身，增加元素特征）。',
        '每一行的 4 列代表同一阶段下的 4 种情绪/状态：第 1 列=idle（待机、自然站立、平静微笑），第 2 列=happy（开心、咧嘴大笑、雀跃姿态），第 3 列=sad（难过、眼角垂泪、垂头丧气），第 4 列=sleep（睡觉、闭眼、放松或蜷缩, 可正对，背对或侧卧等姿势皆可）。同一行的 4 个变体必须保持相同的种类、毛色、配饰，明显是同一只宠物。',
        '严格背景要求：背景必须是**纯黑色 #000000** 填充整张图（每个格子内的背景也都是纯黑），不能有任何阴影、渐变、白边、灰边、网格线或其他颜色；宠物本体不能整体过暗或全黑，要明亮饱和、与黑色背景对比强烈。每个格子内只有一只宠物完整居中、四肢/头部不被裁切，宠物之间不重叠、不互相遮挡。',
        '风格要求（重要）：参考 Tamagotchi Paradise / Sanrio 系列吉祥物 —— 超扁平 2D 卡通插画，糖果色明亮饱和，超大水汪汪眼睛，小圆身体，整体必须是二头身可爱比例；宝宝阶段要更夸张，几乎只有头。柔和但清晰的深色描边，单色简单上色加少量高光，不要厚重写实质感，不要 3D 皮克斯风格，不要复杂阴影，不要任何文字，不要超出格子。',
    ].filter(Boolean).join(' ');
}

export function buildSceneImagePrompt(promptText, tags = [], referenceCount = 0, options = {}) {
    const normalizeTags = typeof options.normalizeTags === 'function' ? options.normalizeTags : splitPromptTags;
    const description = String(promptText || options.title || '').trim() || '温暖的2D游戏场景背景图';
    return [
        '生成一个卡通风格的2D游戏场景背景图，采用第一人称视角往下微微俯视，只要场景，不要角色，不要文字，不要水印。',
        `场景描述：${description}`,
        `场景标签：${normalizeTags(tags).join(', ') || 'haqi, spring, outdoor'}`,
        referenceCount ? `参考图数量：${referenceCount}。请提取构图、颜色和材质作为参考，不要复制文字或人物。` : '',
        '风格：明亮、干净、童话感、适合手机故事播放器，画面中央保留空地。',
    ].filter(Boolean).join('\n');
}