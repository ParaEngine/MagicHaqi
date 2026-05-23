// DNA 算法：编码 / 解码 / 父母交叉 / 突变 / DNA→prompt
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// DNA = 18 字符 = 6 段 × 3 字符
// 段位含义: [element, species, color, eyes, accessory, elementalAttribute]
//   element ∈ { 陆地 land, 水系 water, 天空 sky } —— 决定基础血统与可选种类。
//   species 索引到 SPECIES_BY_ELEMENT[element]，每族 16 种 Tamagotchi 风格的萌系生物。
//   elementalAttribute 是宠物的元素属性，可由远程星球 DNA 信号决定。
// 旧 12/15 位 DNA 会自动补足为 18 位（normalizeDna 内确定性补齐），element 随机派生。
const ELEMENTS = ['陆地', '水系', '天空'];
const ELEMENTAL_ATTRIBUTES = ['自然', '火', '冰', '生命', '暗'];
const SPECIES_BY_ELEMENT = {
    // 陆地族：毛茸茸、四脚、植物系小兽
    陆地: [
        '小毛球兽', '草芽鹿', '泥团仔', '蘑菇兔', '苹果熊', '萝卜狗', '橡果狐', '土豆猫',
        '羊毛卷羊', '小石龟', '蜂蜜熊', '麦穗鼠', '南瓜獾', '苔藓貂', '红薯獭', '松果鼯',
    ],
    // 水系：圆润、果冻质感、海洋小生物
    水系: [
        '水滴鱼', '果冻水母', '气泡章鱼', '珍珠贝宝', '小海豚', '蓝鲸宝宝', '虾米仔', '气球河豚',
        '海星酥', '泡泡蛙', '冰沙海狮', '水晶虾', '雪球海豹', '螺旋蜗', '蓝莓乌贼', '波浪海马',
    ],
    // 天空：羽毛/翅膀、云朵质感、轻盈飞行
    天空: [
        '云朵雀', '彩虹蝶', '棉糖鹦鹉', '星星雏鸟', '羽毛猫头鹰', '气球蝙蝠', '风铃蜂鸟', '糖果蜻蜓',
        '月亮兔耳鸟', '泡泡龙幼崽', '雨滴小燕', '彩带鹤', '蜜糖蜜蜂', '云海鳐', '风车幼鸟', '极光雀',
    ],
};

const TRAIT_TABLE = {
    element: ELEMENTS,
    elementalAttribute: ELEMENTAL_ATTRIBUTES,
    color: [
        '雪白色', '奶白色', '金黄色', '焦糖色', '巧克力色', '粉色',
        '薄荷绿', '天蓝色', '薰衣草紫', '玫瑰红', '彩虹色', '渐变色',
        '银灰色', '黑色', '橘色', '杏色',
    ],
    eyes: [
        '圆圆的大眼睛', '星星眼', '月牙眼', '蓝宝石眼睛', '翡翠绿眼睛',
        '紫水晶眼睛', '金色眼睛', '异色瞳', '小眯眯眼', '亮晶晶的眼睛',
        '琥珀色眼睛', '彩虹色眼睛', '小桃心眼', '黑曜石眼睛', '蜂蜜色眼睛', '冰蓝眼睛',
    ],
    accessory: [
        '戴着小蝴蝶结', '戴着草莓帽子', '系着围巾', '戴着小皇冠',
        '背着小书包', '挂着小铃铛', '戴着花环', '披着小披风',
        '戴着小眼镜', '叼着小花', '戴着耳机', '戴着围嘴',
        '戴着魔法师帽', '系着领结', '抱着小球', '没有任何配饰',
    ],
};

const SEGMENT_KEYS = ['element', 'species', 'color', 'eyes', 'accessory', 'elementalAttribute'];
const SEGMENT_LEN = 3;
const DIET_PREFS = ['meat', 'vegetables', 'both'];

function ch2idx(ch) {
    const i = ALPHABET.indexOf(String(ch).toUpperCase());
    return i >= 0 ? i : 0;
}

function randomChar() {
    return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
}

function normalizeTraitText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function scoreTraitTextMatch(input, candidate) {
    const source = normalizeTraitText(input);
    const target = normalizeTraitText(candidate);
    if (!source && !target) return 1;
    if (!source || !target) return 0;
    if (source === target) return 10000 + target.length;
    if (source.includes(target) || target.includes(source)) return 5000 + Math.min(source.length, target.length);
    const sourceChars = [...source];
    const targetChars = [...target];
    const used = new Array(targetChars.length).fill(false);
    let score = 0;
    sourceChars.forEach((ch, sourceIndex) => {
        const targetIndex = targetChars.findIndex((targetCh, index) => !used[index] && targetCh === ch);
        if (targetIndex < 0) return;
        used[targetIndex] = true;
        score += 10;
        if (sourceIndex === targetIndex) score += 1;
    });
    return score;
}

function bestTraitIndex(value, list) {
    const choices = Array.isArray(list) && list.length ? list : [''];
    let bestIndex = 0;
    let bestScore = -1;
    choices.forEach((candidate, index) => {
        const score = scoreTraitTextMatch(value, candidate);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });
    return bestIndex;
}

function segmentForTraitIndex(index, listLength) {
    const size = Math.max(1, Number(listLength) || 1);
    const target = ((Number(index) || 0) % size + size) % size;
    for (let a = 0; a < ALPHABET.length; a++) {
        for (let b = 0; b < ALPHABET.length; b++) {
            for (let c = 0; c < ALPHABET.length; c++) {
                if ((a * 7 + b * 3 + c) % size === target) return ALPHABET[a] + ALPHABET[b] + ALPHABET[c];
            }
        }
    }
    return ALPHABET[0] + ALPHABET[0] + ALPHABET[target % ALPHABET.length];
}

export function randomDna() {
    let s = '';
    for (let i = 0; i < SEGMENT_KEYS.length * SEGMENT_LEN; i++) s += randomChar();
    return s;
}

export function randomDnaForElementalAttribute(attribute) {
    const target = ELEMENTAL_ATTRIBUTES.includes(attribute) ? attribute : ELEMENTAL_ATTRIBUTES[0];
    let dna = randomDna();
    const index = ELEMENTAL_ATTRIBUTES.indexOf(target);
    const forcedSegment = ALPHABET[0] + ALPHABET[0] + ALPHABET[index % ALPHABET.length];
    const start = SEGMENT_KEYS.indexOf('elementalAttribute') * SEGMENT_LEN;
    dna = dna.slice(0, start) + forcedSegment + dna.slice(start + SEGMENT_LEN);
    return dna;
}

// 场景 → DNA 段位偏置映射
// land/water/sky 影响 element 段；fire/ice/life/dark 影响 elementalAttribute 段。
const FIELD_TO_ELEMENT = { land: '陆地', water: '水系', sky: '天空' };
const FIELD_TO_ATTRIBUTE = { fire: '火', ice: '冰', life: '生命', dark: '暗' };

/**
 * 将 DNA 偏置到某场景"领地"对应的特征。
 * 默认概率 0.75 命中（其他场景仍可能因随机出现）。
 * 用于"宠物在领地房屋中养育更可能具备该领地 DNA 特征"。
 */
export function biasDnaForFieldId(dna, fieldId, { probability = 0.75 } = {}) {
    if (!fieldId) return dna;
    let s = normalizeDna(dna);
    const roll = Math.random();
    if (roll > probability) return s;

    if (FIELD_TO_ELEMENT[fieldId]) {
        const idx = ELEMENTS.indexOf(FIELD_TO_ELEMENT[fieldId]);
        if (idx >= 0) {
            const start = SEGMENT_KEYS.indexOf('element') * SEGMENT_LEN;
            // 强制段位首字符让 decode 选中目标 element：sum % ELEMENTS.length === idx
            // sum = ch2idx(c0)*7 + ch2idx(c1)*3 + ch2idx(c2)
            // 简单办法：c1=A、c2=A，则 sum = ch2idx(c0)*7；找到一个让 (c0*7) % 3 === idx 的 c0。
            for (let i = 0; i < ALPHABET.length; i++) {
                if ((i * 7) % ELEMENTS.length === idx) {
                    s = s.slice(0, start) + ALPHABET[i] + ALPHABET[0] + ALPHABET[0] + s.slice(start + SEGMENT_LEN);
                    break;
                }
            }
        }
    } else if (FIELD_TO_ATTRIBUTE[fieldId]) {
        const idx = ELEMENTAL_ATTRIBUTES.indexOf(FIELD_TO_ATTRIBUTE[fieldId]);
        if (idx >= 0) {
            const start = SEGMENT_KEYS.indexOf('elementalAttribute') * SEGMENT_LEN;
            for (let i = 0; i < ALPHABET.length; i++) {
                if ((i * 7) % ELEMENTAL_ATTRIBUTES.length === idx) {
                    s = s.slice(0, start) + ALPHABET[i] + ALPHABET[0] + ALPHABET[0] + s.slice(start + SEGMENT_LEN);
                    break;
                }
            }
        }
    }
    return s;
}

// trait → 倾向的 element / species 编号偏置
const TRAIT_TO_ELEMENT = {
    catLike: '陆地', rabbitLike: '陆地', fruitLike: '陆地', sweetLike: '陆地',
    fishLike: '水系',
    birdLike: '天空', dragonLike: '天空',
};

/**
 * 根据某个种族 trait（catLike / fishLike / birdLike / ...）偏置 DNA，
 * 让蛋孵化后更倾向于该种族外观（影响 element 段，进而影响 species 子列表）。
 */
export function biasDnaForTrait(dna, traitId, { probability = 1 } = {}) {
    if (!traitId) return dna;
    const element = TRAIT_TO_ELEMENT[traitId];
    if (!element) return dna;
    let s = normalizeDna(dna);
    if (Math.random() > probability) return s;
    const idx = ELEMENTS.indexOf(element);
    if (idx < 0) return s;
    const start = SEGMENT_KEYS.indexOf('element') * SEGMENT_LEN;
    for (let i = 0; i < ALPHABET.length; i++) {
        if ((i * 7) % ELEMENTS.length === idx) {
            s = s.slice(0, start) + ALPHABET[i] + ALPHABET[0] + ALPHABET[0] + s.slice(start + SEGMENT_LEN);
            break;
        }
    }
    return s;
}

/** 标准化输入：去掉非字母数字，转大写，截断 / 补齐到 18 位。
 *  补齐使用基于已有内容的确定性 hash，保证同一输入始终得到同一结果（兼容旧 12 位 DNA）。 */
export function normalizeDna(input) {
    let s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const target = SEGMENT_KEYS.length * SEGMENT_LEN;
    if (s.length === 0) {
        // 完全空：用真随机生成
        for (let i = 0; i < target; i++) s += randomChar();
        return s;
    }
    if (s.length < target) {
        // 用内容 hash 派生确定性补位
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h * 16777619) >>> 0;
        }
        while (s.length < target) {
            h = (h * 16777619 + 1) >>> 0;
            s += ALPHABET[h % ALPHABET.length];
        }
    }
    return s.slice(0, target);
}

/** 显示用格式：3-3-3-3 用 - 分隔。 */
export function formatDna(dna) {
    const s = normalizeDna(dna);
    const parts = [];
    for (let i = 0; i < SEGMENT_KEYS.length; i++) {
        parts.push(s.slice(i * SEGMENT_LEN, (i + 1) * SEGMENT_LEN));
    }
    return parts.join('-');
}

/** 解码 DNA → 中文特征。每段取首字符索引到表里。 */
export function decodeDna(dna) {
    const s = normalizeDna(dna);
    const traits = {};
    // 先解 element（固定表），再用它选 species 的子表。
    SEGMENT_KEYS.forEach((key, i) => {
        const seg = s.slice(i * SEGMENT_LEN, (i + 1) * SEGMENT_LEN);
        const sum = ch2idx(seg[0]) * 7 + ch2idx(seg[1]) * 3 + ch2idx(seg[2]);
        let list;
        if (key === 'species') {
            list = SPECIES_BY_ELEMENT[traits.element] || SPECIES_BY_ELEMENT[ELEMENTS[0]];
        } else {
            list = TRAIT_TABLE[key];
        }
        traits[key] = list[sum % list.length];
    });
    return traits;
}

export function traitsToDna(traits = {}) {
    const source = traits && typeof traits === 'object' && !Array.isArray(traits) ? traits : {};
    const elementIndex = bestTraitIndex(source.element, ELEMENTS);
    const element = ELEMENTS[elementIndex] || ELEMENTS[0];
    const speciesList = SPECIES_BY_ELEMENT[element] || SPECIES_BY_ELEMENT[ELEMENTS[0]];
    const indexes = {
        element: elementIndex,
        species: bestTraitIndex(source.species, speciesList),
        color: bestTraitIndex(source.color, TRAIT_TABLE.color),
        eyes: bestTraitIndex(source.eyes, TRAIT_TABLE.eyes),
        accessory: bestTraitIndex(source.accessory, TRAIT_TABLE.accessory),
        elementalAttribute: bestTraitIndex(source.elementalAttribute, ELEMENTAL_ATTRIBUTES),
    };
    return SEGMENT_KEYS.map(key => {
        const list = key === 'species'
            ? speciesList
            : (key === 'element' ? ELEMENTS : TRAIT_TABLE[key]);
        return segmentForTraitIndex(indexes[key], list.length);
    }).join('');
}

export function dnaDietPreference(dna) {
    const s = normalizeDna(dna);
    const speciesStart = SEGMENT_KEYS.indexOf('species') * SEGMENT_LEN;
    const seg = s.slice(speciesStart, speciesStart + SEGMENT_LEN);
    const score = ch2idx(seg[0]) * 5 + ch2idx(seg[1]) * 2 + ch2idx(seg[2]);
    return DIET_PREFS[score % DIET_PREFS.length];
}

export function dietPreferenceLabel(preference) {
    if (preference === 'meat') return '肉食';
    if (preference === 'vegetables') return '素食';
    return '杂食';
}

export function dietPreferenceIcons(preference) {
    if (preference === 'meat') return ['meat'];
    if (preference === 'vegetables') return ['vegetables'];
    return ['meat', 'vegetables'];
}

/** 父母 DNA 交叉 + 5% 突变。返回子代 DNA。 */
export function crossover(dnaA, dnaB) {
    const a = normalizeDna(dnaA);
    const b = normalizeDna(dnaB);
    let child = '';
    for (let i = 0; i < SEGMENT_KEYS.length; i++) {
        const aSeg = a.slice(i * SEGMENT_LEN, (i + 1) * SEGMENT_LEN);
        const bSeg = b.slice(i * SEGMENT_LEN, (i + 1) * SEGMENT_LEN);
        // 整段以 50/50 选父母
        let seg = Math.random() < 0.5 ? aSeg : bSeg;
        // 每位 8% 概率突变
        let mutated = '';
        for (const ch of seg) mutated += Math.random() < 0.08 ? randomChar() : ch;
        child += mutated;
    }
    return child;
}

/** 由 DNA 生成 AI 立绘 prompt。Tamagotchi Paradise 风格的迷你萌宠。 */
export function dnaToPrompt(dna, { name = '' } = {}) {
    const t = decodeDna(dna);
    const elementHint = t.element === '水系'
        ? '海洋/水系血统：身体圆润半透明、有水珠或鳃鳍等水生元素'
        : t.element === '天空'
        ? '天空血统：带翅膀/羽毛/云朵元素，体态轻盈，有腾空感'
        : '陆地血统：四脚/小短腿，毛茸茸或植物系，踏实呆萌';
    const elementalHint = t.elementalAttribute && t.elementalAttribute !== '自然'
        ? `额外元素属性：${t.elementalAttribute}，在花纹、光效或小装饰中自然体现。`
        : '';
    return [
        `一只${t.color}的${t.species}（${elementHint}），${t.eyes}，${t.accessory}。`,
        elementalHint,
        '艺术风格：Tamagotchi Paradise / Sanrio 风格的萌宠吉祥物，超扁平 2D 卡通插画，超大眼睛、小圆身体、二头身比例，',
        '线条柔和但有清晰的深色描边，配色明亮饱和、糖果色，单色简单上色加少量高光，避免厚重写实质感、避免3D写实渲染。',
        '正面朝向镜头，全身居中构图，可爱呆萌表情。',
        name ? `名字：${name}。` : '',
    ].filter(Boolean).join('');
}

/** 给定 DNA 返回稀有度 0-100（基于 DNA hash）。 */
export function dnaRarity(dna) {
    const s = normalizeDna(dna);
    let h = 0;
    for (const ch of s) h = (h * 31 + ch2idx(ch)) >>> 0;
    return h % 101;
}

// ---------- 名字生成 ----------
// 名字由 DNA 决定，是宠物的"真名"。游戏规则：宠物长大成年后才会显露。
const NAME_CONS = ['M','N','L','R','S','T','K','D','B','F','G','H','J','P','V','Z','Ch','Sh','Th'];
const NAME_VOWS = ['a','i','o','u','e','ya','io','ai','ou','ei'];
const NAME_TAILS = ['', '', '', 'n', 'r', 'l', 's'];

/** DNA → 拼音风格的真名（确定性）。 */
export function dnaToName(dna) {
    const s = normalizeDna(dna);
    const sylls = 2 + (ch2idx(s[0]) % 2); // 2 或 3 音节
    let name = '';
    for (let i = 0; i < sylls; i++) {
        const a = ch2idx(s[(i * 3) % s.length]);
        const b = ch2idx(s[(i * 3 + 1) % s.length]);
        const c = ch2idx(s[(i * 3 + 2) % s.length]);
        const con = NAME_CONS[a % NAME_CONS.length];
        const vow = NAME_VOWS[b % NAME_VOWS.length];
        const tail = (i === sylls - 1) ? NAME_TAILS[c % NAME_TAILS.length] : '';
        name += (i === 0 ? con : con.toLowerCase()) + vow + tail;
    }
    return name;
}

/** 当前阶段是否已经成年（可以揭示真名）。 */
export function isAdultStage(stage) {
    return stage === 'adult' || stage === 'elder';
}

/** UI 用：成年前隐藏真名，显示一个 DNA 前缀的占位符。 */
export function displayPetName(pet) {
    if (!pet) return '';
    if (isAdultStage(pet.stage)) return pet.name || dnaToName(pet.dna || '');
    const tag = normalizeDna(pet.dna || '').slice(0, 4);
    return `幼崽 #${tag}`;
}

export { TRAIT_TABLE, ELEMENTS, ELEMENTAL_ATTRIBUTES, SPECIES_BY_ELEMENT };
