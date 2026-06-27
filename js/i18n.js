// ============================================================
// i18n: 中文 / English 本地化
// 所有面向玩家的 UI 文案集中在此处。
// 用法：
//   import { t } from './i18n.js';
//   t('login')                         // 简单取词
//   t('greeting', { name: '小哈' })     // 带变量插值（{name} 占位）
//   setLang('en'); getLang();          // 切换 / 读取语言
//   onLangChange(fn);                  // 订阅语言变化
// ============================================================

import { zhCN } from './i18n/zh.js';
import { enUS } from './i18n/en.js';

const LANG_STORAGE_KEY = 'magichaqi.lang';
export const SUPPORTED_LANGS = ['zh', 'en'];

export { zhCN, enUS };

const DICTS = { zh: zhCN, en: enUS };

// 相册诗意小标题：[stage][animIdx] -> 候选文案数组（idle/happy/sad/sleep）
const ALBUM_CAPTIONS_BY_LANG = {
    zh: {
        baby: [
            ['你呆呆望着世界的样子', '第一次看见太阳的小眼神', '蛋壳碎片还挂在头顶呢', '你愣愣地认识这个新家', '小小的你，安静得像颗糖'],
            ['你第一次咯咯笑出声', '小爪爪举起来的瞬间', '咿呀咿呀地跟我打招呼', '笑得眼睛都弯成月牙啦', '蹦了一下，超开心的你'],
            ['我心疼你委屈的小脸', '你嘟着嘴看我的时候', '小小的眼泪在打转', '你咬着尾巴生闷气', '别难过，我马上来抱你'],
            ['我希望你睡觉的样子', '你蜷成一小团的午觉', '呼噜呼噜的奶气小鼾', '梦里在追什么呀', '小手抓着空气也要睡'],
        ],
        teen: [
            ['你独自散步的背影', '你站在风里发呆', '你认真打量新世界', '青春期的你不爱说话', '你偷偷望着远方'],
            ['你蹦蹦跳跳的青春', '你笑得肆无忌惮', '满世界都是你的回声', '你抓住夕阳的样子', '一起冒险的兴奋脸'],
            ['你偷偷掉眼泪的瞬间', '你蹲在角落不说话', '我读得懂你的失落', '你说"没事"的时候', '想抱你一下，可以吗'],
            ['你打盹时小小的呼吸', '你在树荫下睡着了', '蓬松的尾巴盖住眼睛', '少年的梦轻轻晃动', '别醒，我替你看世界'],
        ],
        adult: [
            ['你认真凝望远方', '你站成了我的依靠', '风把你的鬃毛吹乱', '你沉默时也很温柔', '你像一座小小的山'],
            ['你欢呼雀跃的高光时刻', '你笑起来像烟花', '你转圈圈逗我开心', '我们击掌的那一刻', '世界因你闪闪发光'],
            ['想紧紧抱住难过的你', '你眉头微皱的样子', '成年的你也可以哭', '别一个人扛着所有事', '让我做你的盔甲'],
            ['你梦里一定有星星', '你靠在我肩上睡着了', '呼吸均匀像一首歌', '今晚的月亮替我守你', '愿你梦里没有坏事'],
        ],
        elder: [
            ['你眼里藏着岁月', '你慢慢地走，我陪你', '你看着我，像看孩子', '皱纹里都是温柔', '你成了我的整个宇宙'],
            ['你笑起来还像个孩子', '你眼角的皱纹也是糖', '你哼起年轻时的歌', '夕阳下你最美', '我们一起笑到流泪'],
            ['陪你度过的每一次失落', '你叹气时我也心疼', '别担心，我都记得', '把忧愁交给我吧', '你哭过的事，我都会记住'],
            ['愿你安稳入睡到永远', '你睡得像个老小孩', '我会守着你的梦', '今晚的星星都属于你', '晚安，我永远的伙伴'],
        ],
    },
    en: {
        baby: [
            ['The way you gaze blankly at the world', 'Your first little look at the sun', 'Eggshell bits still on your head', 'Quietly getting to know this new home', 'Tiny you, quiet as a candy'],
            ['Your very first giggle', 'The moment you raised a little paw', 'Babbling a hello to me', 'Eyes curved into crescents from laughing', 'A little hop — so happy'],
            ['My heart aches for your pouty face', 'When you pout up at me', 'Tiny tears welling up', 'Sulking, biting your tail', 'Don\'t be sad, I\'m coming to hug you'],
            ['How I love to see you sleep', 'Curled into a tiny ball for a nap', 'Soft milky little snores', 'What are you chasing in your dream?', 'Sleeping even while grabbing at the air'],
        ],
        teen: [
            ['Your back as you walk alone', 'Standing in the wind, lost in thought', 'Studying the new world carefully', 'A quiet teen who won\'t talk much', 'Secretly gazing into the distance'],
            ['Your bouncing, leaping youth', 'Laughing without a care', 'Your echo fills the whole world', 'The way you catch the sunset', 'An excited face, off on adventure'],
            ['The moment you secretly cried', 'Crouched in a corner, silent', 'I can read your disappointment', 'When you say "I\'m fine"', 'May I give you a hug?'],
            ['Your tiny breaths as you doze', 'You fell asleep in the shade', 'Fluffy tail covering your eyes', 'A young dream gently swaying', 'Don\'t wake — I\'ll watch the world for you'],
        ],
        adult: [
            ['You gaze earnestly into the distance', 'You\'ve become someone I can lean on', 'The wind tousles your mane', 'Even your silence is gentle', 'You\'re like a small mountain'],
            ['Your shining moment of cheer', 'You laugh like fireworks', 'Spinning around to cheer me up', 'The moment we high-fived', 'The world sparkles because of you'],
            ['I want to hold the sad you tight', 'The way your brow softly furrows', 'Even grown-up you can cry', 'Don\'t carry everything alone', 'Let me be your armor'],
            ['Surely there are stars in your dream', 'You fell asleep on my shoulder', 'Your breathing even like a song', 'Tonight\'s moon guards you for me', 'May no bad things enter your dream'],
        ],
        elder: [
            ['Years hidden in your eyes', 'Walk slowly, I\'ll go with you', 'You look at me like at a child', 'Tenderness in every wrinkle', 'You\'ve become my whole universe'],
            ['You still laugh like a child', 'The wrinkles at your eyes are sweet too', 'You hum a song from younger days', 'You\'re most beautiful in the sunset', 'We laughed together until we cried'],
            ['Every low moment I spent with you', 'When you sigh, my heart aches too', 'Don\'t worry, I remember it all', 'Hand your worries to me', 'Everything you cried over, I\'ll remember'],
            ['May you sleep soundly forever', 'You sleep like an old little child', 'I\'ll keep watch over your dreams', 'Tonight\'s stars all belong to you', 'Good night, my forever friend'],
        ],
    },
};

/** 取当前语言的相册小标题结构 */
export function getAlbumCaptions() {
    return ALBUM_CAPTIONS_BY_LANG[_lang] || ALBUM_CAPTIONS_BY_LANG.zh;
}

function detectInitialLang() {
    // 1) localStorage 用户选择
    try {
        const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem(LANG_STORAGE_KEY) : null;
        if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
    } catch (_) {}
    // 2) 浏览器语言：非中文则默认 English
    try {
        const nav = (typeof navigator !== 'undefined') ? (navigator.language || navigator.userLanguage || '') : '';
        if (nav && !/^zh/i.test(nav)) return 'en';
    } catch (_) {}
    // 3) 默认中文
    return 'zh';
}

let _lang = detectInitialLang();
const _listeners = new Set();

/** 当前语言 'zh' | 'en' */
export function getLang() { return _lang; }

/** 切换语言并持久化，触发订阅者。返回是否发生变化。 */
export function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang) || lang === _lang) return false;
    _lang = lang;
    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch (_) {}
    try { document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en'); } catch (_) {}
    _listeners.forEach((fn) => { try { fn(lang); } catch (_) {} });
    return true;
}

/** 在中英之间切换 */
export function toggleLang() {
    return setLang(_lang === 'zh' ? 'en' : 'zh');
}

/** 订阅语言变化，返回取消订阅函数 */
export function onLangChange(fn) {
    if (typeof fn === 'function') _listeners.add(fn);
    return () => _listeners.delete(fn);
}

/**
 * 取词 + 可选变量插值。
 * @param {string} key 文案键
 * @param {Record<string, any>} [vars] 变量，模板里用 {name} 占位
 */
export function t(key, vars) {
    const dict = DICTS[_lang] || zhCN;
    let str = (dict[key] != null) ? dict[key] : (zhCN[key] != null ? zhCN[key] : key);
    if (vars && typeof str === 'string') {
        str = str.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
    }
    return str;
}

/** Translate shop/item display names. Chinese names are used directly as i18n keys. */
export function itemName(name) {
    return name ? t(name) : '';
}

/** Translate official planet names/titles. Chinese names are used directly as i18n keys. */
export function planetName(name) {
    return name ? t(name) : '';
}

// ---- Shared name localization helpers ----

const FIELD_NAME_I18N = {
    land: 'fieldLand',
    water: 'fieldWater',
    sky: 'fieldSky',
    fire: 'fieldVolcano',
    ice: 'fieldIce',
    life: 'fieldTree',
    dark: 'fieldCave',
    thunder: 'fieldThunder',
};

const ROOM_NAME_I18N = {
    bedroom: 'roomBedroom',
    kitchen: 'roomKitchen',
    bath: 'roomBath',
    living: 'roomLiving',
    garden: 'roomGarden',
};

/** Localize a field/type object using explicit slot names first, then type i18n. */
export function localizeFieldName(field) {
    if (field && typeof field === 'object') {
        const name = String(field.name || '').trim();
        const id = String(field.id || '').trim();
        const typeId = String(field.typeId || field.fieldId || '').trim();
        const isNamedSlot = !!typeId && (!id || id !== typeId || field.index != null || field.slotId != null || field.positionLabel);
        if (name && isNamedSlot) return name;
    }
    const typeId = field?.typeId || field?.id || '';
    const key = FIELD_NAME_I18N[typeId];
    return key ? t(key) : (field?.name || '');
}

/** Localize a room object using its id. Fallback to .name. */
export function localizeRoomName(room) {
    const key = ROOM_NAME_I18N[room?.id];
    return key ? t(key) : (room?.name || '');
}

// 初始化 <html lang>
try { document.documentElement.setAttribute('lang', _lang === 'zh' ? 'zh-CN' : 'en'); } catch (_) {}
