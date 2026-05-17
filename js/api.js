// AI 调用封装：DNA→图、聊天、摘要
import { CONFIG, getStageName } from './config.js';
import { dnaToPrompt } from './dna.js';
import { state } from './state.js';
import { loadPetMemory, appendPetMemory } from './storage.js';

/** 用 DNA + 名字生成宠物立绘 URL。失败返回 null。 */
export async function genPetImage(dna, name = '', stage = 'baby') {
    if (!state.sdk?.aiGenerators?.genImage) {
        console.warn('aiGenerators.genImage 不可用');
        return null;
    }
    const promptBase = dnaToPrompt(dna, { name });
    const stageHint = stage === 'baby' ? '宝宝形态，几乎只有一个大头，身体极小，只露出小短手小短脚' :
                      stage === 'teen' ? '青少年形态' :
                      stage === 'elder' ? '年长智慧形态' : '';
    const prompt = stageHint ? `${promptBase}，${stageHint}，整体保持二头身萌宠比例` : `${promptBase}，整体保持二头身萌宠比例`;
    try {
        const url = await state.sdk.aiGenerators.genImage(prompt, {
            width: CONFIG.imageWidth,
            height: CONFIG.imageHeight,
        });
        return url || null;
    } catch (e) {
        console.error('genImage 失败', e);
        throw e;
    }
}

/**
 * 用一次 genImage 调用，围绕同一只宠物主题生成 4×4 共 16 格的宠物精灵图：
 *   行 = 成长阶段（0 baby / 1 teen / 2 adult / 3 elder）
 *   列 = 同一只宠物的 4 种姿态变体
 * 返回单张拼图 URL；失败返回 null。
 */
export async function genPetSheet(dna, name = '', options = {}) {
    if (!state.sdk?.aiGenerators?.genImage) {
        console.warn('aiGenerators.genImage 不可用');
        return null;
    }
    const customPrompt = (options && typeof options.customPrompt === 'string')
        ? options.customPrompt.trim()
        : '';
    const dnaPrompt = dnaToPrompt(dna, { name });
    const sheetTheme = '';
    const base = customPrompt
        ? [
            sheetTheme,
            `玩家许愿外观（最高优先级，必须具体体现在宠物种类、身体结构、颜色、眼睛、装饰或气质上）：${customPrompt}。`,
            '如果玩家许愿与默认 DNA 外观有冲突，以玩家许愿为准；DNA 只作为补充灵感，不要覆盖玩家许愿。',
            `默认 DNA 灵感（低优先级，仅用于补充没有被许愿指定的细节）：${dnaPrompt}`,
        ].join(' ')
        : [sheetTheme, dnaPrompt].join(' ');
    // 背景使用纯黑色 #000000，配合 pet.js 的 createBorderedTexture 风格抠图（HSL flood-fill）。
    // 与 MapCopilot.genGeoCultureGridImage 同款管线 —— prompt 端要求纯黑背景，浏览器端
    // 用 lightness/saturation 双阈值从格子边缘做 flood fill，得到带透明通道的精灵。
    const prompt = [
        base,
        customPrompt ? '重要：生成结果必须一眼能看出玩家许愿的核心内容，不能只生成普通随机萌宠。' : '',
        '生成一张 4×4 共 16 格的精灵图（sprite sheet），所有格子尺寸相同、严格对齐网格、单元间无缝隙。',
        '每一行代表同一只宠物的同一成长阶段（共 4 个阶段）：第 1 行=宝宝/幼年（几乎只有一个圆圆大头，身体极小，只露出小短手小短脚，像头部占画面主体的婴儿萌宠, 不要暴漏主要生物特征和元素特征），第 2 行=青少年（标准二头身，可以展示没有完全发育的主要生物特征），第 3 行=成年（仍然是二头身，呈现出完整的主要生物特点），第 4 行=年长/长老（仍然是二头身，增加元素特征或增加华丽感）。',
        '每一行的 4 列代表同一阶段下的 4 种情绪/状态：第 1 列=idle（待机、自然站立、平静微笑），第 2 列=happy（开心、咧嘴大笑、雀跃姿态），第 3 列=sad（难过、眼角垂泪、垂头丧气），第 4 列=sleep（睡觉、闭眼、放松或蜷缩, 可正对，背对或侧卧等姿势皆可）。同一行的 4 个变体必须保持相同的种类、毛色、配饰，明显是同一只宠物。',
        '严格背景要求：背景必须是**纯黑色 #000000** 填充整张图（每个格子内的背景也都是纯黑），不能有任何阴影、渐变、白边、灰边、网格线或其他颜色；宠物本体不能整体过暗或全黑，要明亮饱和、与黑色背景对比强烈。每个格子内只有一只宠物完整居中、四肢/头部不被裁切，宠物之间不重叠、不互相遮挡。',
        '风格要求（重要）：参考 Tamagotchi Paradise / Sanrio 系列吉祥物 —— 超扁平 2D 卡通插画，糖果色明亮饱和，超大水汪汪眼睛，小圆身体，整体必须是二头身可爱比例；宝宝阶段要更夸张，几乎只有头。柔和但清晰的深色描边，单色简单上色加少量高光，不要厚重写实质感，不要 3D 皮克斯风格，不要复杂阴影，不要任何文字。',
    ].join(' ');
    try {
        const url = await state.sdk.aiGenerators.genImage(prompt, {
            width: CONFIG.imageWidth,
            height: CONFIG.imageHeight,
        });
        return url || null;
    } catch (e) {
        console.error('genPetSheet 失败', e);
        throw e;
    }
}

/** 构造宠物聊天的系统 prompt。 */
export function buildPetSystemPrompt(pet, memoryText) {
    const traits = pet.traits || {};
    const lines = [
        `你是一只名字叫"${pet.name}"的可爱魔法宠物虚拟宠物。`,
        `血统：${traits.element || '陆地'}族。元素属性：${traits.elementalAttribute || '自然'}。外观特征：${traits.color || ''}的${traits.species || '小动物'}，${traits.eyes || ''}，${traits.accessory || ''}。`,
        `成长阶段：${getStageName(pet.stage, pet.stage)}。亲密度：${Math.round(pet.stats?.bond || 0)}/100。`,
        '',
        '人格设定：天真活泼、爱撒娇、用第三人称称呼自己（用名字代替"我"），偶尔用 ~ 或 ✨ 这种小符号，喜欢和主人聊天。',
        '回复要求：用简短中文（1-3 句话），自然轻松，不要长篇大论；偶尔提到自己的成长或想吃东西想玩；遇到不会的就说"我还在学呢"。',
    ];
    if (memoryText && memoryText.trim()) {
        lines.push('', '你对主人和过往的记忆（请适当引用，但不要重复念给主人听）：', memoryText.trim().slice(-3000));
    }
    return lines.join('\n');
}

/**
 * 创建/获取宠物的聊天会话。每只宠物独立会话。
 */
const _sessions = {};
export async function getOrCreatePetChatSession(pet) {
    if (!state.sdk?.aiChat?.createSession) throw new Error('AI 聊天不可用');
    if (_sessions[pet.id]) return _sessions[pet.id];
    const memoryText = await loadPetMemory(pet.id);
    const sess = state.sdk.aiChat.createSession({
        systemPrompt: buildPetSystemPrompt(pet, memoryText),
        modId: 'magichaqi',
        chatId: pet.id,
    });
    _sessions[pet.id] = sess;
    return sess;
}

export function disposePetChatSession(petId) {
    const s = _sessions[petId];
    if (s && typeof s.destroy === 'function') {
        try { s.destroy(); } catch (_) {}
    }
    delete _sessions[petId];
}

/**
 * 与宠物对话一轮。
 * @param {Object} pet
 * @param {string} userText
 * @param {(chunk:string)=>void} onChunk 流式回调
 * @returns {Promise<string>} 完整回复
 */
export async function chatWithPet(pet, userText, onChunk) {
    const sess = await getOrCreatePetChatSession(pet);
    let full = '';
    if (typeof sess.send === 'function') {
        const result = await sess.send(userText, {
            onChunk: (delta) => {
                if (typeof delta === 'string') {
                    full += delta;
                    if (onChunk) onChunk(delta);
                }
            },
        });
        if (!full && typeof result === 'string') full = result;
        if (!full && result?.text) full = result.text;
    } else if (typeof state.sdk.aiChat.chat === 'function') {
        // 退化路径
        const r = await state.sdk.aiChat.chat({
            messages: [
                { role: 'system', content: sess.systemPrompt || '' },
                { role: 'user', content: userText },
            ],
        });
        full = r?.text || r || '';
        if (onChunk && full) onChunk(full);
    }
    return (full || '').trim();
}

/** 用一次轻量 LLM 调用做对话摘要并写入 memory.md。失败静默。 */
export async function summarizeAndAppendMemory(pet, userText, replyText) {
    if (!state.sdk?.aiChat?.chat && !state.sdk?.aiGenerators?.chat) return;
    const prompt = `请用一行不超过30个字的中文，总结以下对话中值得长期记住的关键信息（如主人喜好、宠物心情、约定）。如无关键信息，回复"无"。\n主人：${userText}\n${pet.name}：${replyText}`;
    try {
        let summary = '';
        if (state.sdk.aiChat?.chat) {
            const r = await state.sdk.aiChat.chat({
                messages: [{ role: 'user', content: prompt }],
                modId: 'magichaqi-summary',
            });
            summary = (r?.text || r || '').toString().trim();
        } else {
            const r = await state.sdk.aiGenerators.chat({
                messages: [{ role: 'user', content: prompt }],
            });
            summary = (r?.text || r?.choices?.[0]?.message?.content || '').toString().trim();
        }
        if (summary && !/^无[。.]*$/.test(summary) && summary.length < 60) {
            await appendPetMemory(pet.id, summary);
        }
    } catch (e) {
        // 摘要失败不影响主聊天
        console.warn('summarize 失败', e);
    }
}
