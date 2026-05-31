// 宠物列表视图（用于浏览所有宠物）
import { $, $$, coinIconSvg, confirm, escapeHtml, randId, showToast } from './utils.js';
import { t } from './i18n.js';
import { formatDna, displayPetName, dnaDietPreference, dietPreferenceLabel, decodeDna, ELEMENTAL_ATTRIBUTES } from './dna.js';
import { buildEggSvg, getPetSpriteCell, SHEET_COLS, SHEET_ROWS } from './pet.js';
import { defaultPermanentTrauma, defaultStats, eggStats, applyStage } from './petTick.js';
import { markPetReleased, getCompanionDays, getPetBirthday, getPetFindTarget, getPetLocationInfo, getRuntimePetStats, isPetOnCurrentPlanet, isPetSelectable } from './petLifecycle.js';
import { savePet, setCurrentPetPersisted, saveUserProfileDebounced, ensurePetData } from './storage.js';
import { notify, setView, state } from './state.js';
import { getStageName } from './config.js';

// 阶段顺序（与 4×4 精灵图行对齐）：baby=0, teen=1, adult=2, elder=3
const ALBUM_STAGES = [
    { id: 'baby',  name: '幼年', emoji: '🐣' },
    { id: 'teen',  name: '青年', emoji: '🐥' },
    { id: 'adult', name: '成年', emoji: '🐉' },
    { id: 'elder', name: '长老', emoji: '🦄' },
];
const ALBUM_ANIMS = ['idle', 'happy', 'sad', 'sleep'];
const PET_LIST_TABS = [
    { id: 'mine', label: '我的宠物' },
    { id: 'rare', label: '稀有宠物' },
];
let activePetListTab = 'mine';
let activeFamousPetFilter = 'all';
let famousPetsIndex = null;
let famousPetsIndexPromise = null;
let famousPetsFilterMetadataPromise = null;
let famousPetFilterTabsScrollLeft = 0;
const FAMOUS_PET_FILTERS = [
    { id: 'all', label: '全部', type: 'all' },
    { id: 'element:天空', label: '天空', type: 'element', value: '天空' },
    { id: 'element:陆地', label: '陆地', type: 'element', value: '陆地' },
    { id: 'element:水系', label: '海洋', type: 'element', value: '水系' },
    ...ELEMENTAL_ATTRIBUTES.map(value => ({ id: `attribute:${value}`, label: value, type: 'attribute', value })),
];
// 16 个 (stage, anim) 格子，每格多条候选小标题，按 seed 选其一。
const ALBUM_CAPTIONS = {
    baby: [
        // idle
        [
            '你呆呆望着世界的样子',
            '第一次看见太阳的小眼神',
            '蛋壳碎片还挂在头顶呢',
            '你愣愣地认识这个新家',
            '小小的你，安静得像颗糖',
        ],
        // happy
        [
            '你第一次咯咯笑出声',
            '小爪爪举起来的瞬间',
            '咿呀咿呀地跟我打招呼',
            '笑得眼睛都弯成月牙啦',
            '蹦了一下，超开心的你',
        ],
        // sad
        [
            '我心疼你委屈的小脸',
            '你嘟着嘴看我的时候',
            '小小的眼泪在打转',
            '你咬着尾巴生闷气',
            '别难过，我马上来抱你',
        ],
        // sleep
        [
            '我希望你睡觉的样子',
            '你蜷成一小团的午觉',
            '呼噜呼噜的奶气小鼾',
            '梦里在追什么呀',
            '小手抓着空气也要睡',
        ],
    ],
    teen: [
        // idle
        [
            '你独自散步的背影',
            '你站在风里发呆',
            '你认真打量新世界',
            '青春期的你不爱说话',
            '你偷偷望着远方',
        ],
        // happy
        [
            '你蹦蹦跳跳的青春',
            '你笑得肆无忌惮',
            '满世界都是你的回声',
            '你抓住夕阳的样子',
            '一起冒险的兴奋脸',
        ],
        // sad
        [
            '你偷偷掉眼泪的瞬间',
            '你蹲在角落不说话',
            '我读得懂你的失落',
            '你说"没事"的时候',
            '想抱你一下，可以吗',
        ],
        // sleep
        [
            '你打盹时小小的呼吸',
            '你在树荫下睡着了',
            '蓬松的尾巴盖住眼睛',
            '少年的梦轻轻晃动',
            '别醒，我替你看世界',
        ],
    ],
    adult: [
        // idle
        [
            '你认真凝望远方',
            '你站成了我的依靠',
            '风把你的鬃毛吹乱',
            '你沉默时也很温柔',
            '你像一座小小的山',
        ],
        // happy
        [
            '你欢呼雀跃的高光时刻',
            '你笑起来像烟花',
            '你转圈圈逗我开心',
            '我们击掌的那一刻',
            '世界因你闪闪发光',
        ],
        // sad
        [
            '想紧紧抱住难过的你',
            '你眉头微皱的样子',
            '成年的你也可以哭',
            '别一个人扛着所有事',
            '让我做你的盔甲',
        ],
        // sleep
        [
            '你梦里一定有星星',
            '你靠在我肩上睡着了',
            '呼吸均匀像一首歌',
            '今晚的月亮替我守你',
            '愿你梦里没有坏事',
        ],
    ],
    elder: [
        // idle
        [
            '你眼里藏着岁月',
            '你慢慢地走，我陪你',
            '你看着我，像看孩子',
            '皱纹里都是温柔',
            '你成了我的整个宇宙',
        ],
        // happy
        [
            '你笑起来还像个孩子',
            '你眼角的皱纹也是糖',
            '你哼起年轻时的歌',
            '夕阳下你最美',
            '我们一起笑到流泪',
        ],
        // sad
        [
            '陪你度过的每一次失落',
            '你叹气时我也心疼',
            '别担心，我都记得',
            '把忧愁交给我吧',
            '你哭过的事，我都会记住',
        ],
        // sleep
        [
            '愿你安稳入睡到永远',
            '你睡得像个老小孩',
            '我会守着你的梦',
            '今晚的星星都属于你',
            '晚安，我永远的伙伴',
        ],
    ],
};
const ALBUM_BG_PALETTE = [
    '#fff7ed', '#fef3c7', '#ecfccb', '#d1fae5', '#cffafe',
    '#dbeafe', '#ede9fe', '#fce7f3', '#fee2e2', '#fef9c3',
    '#e0f2fe', '#f0fdf4', '#fdf2f8', '#f5f3ff', '#ffe4e6', '#f0fdfa',
];
const ELEMENTAL_ATTRIBUTE_BACKGROUNDS = {
    '自然': '#d9f99d',
    '火': '#fed7aa',
    '冰': '#bae6fd',
    '生命': '#bbf7d0',
    '暗': '#ddd6fe',
    '雷': '#fef08a',
};
const DEFAULT_PET_ART_BACKGROUND = '#dff7ff';

function _stageReachedIndex(stage) {
    const idx = ALBUM_STAGES.findIndex(s => s.id === stage);
    return idx; // egg/unknown → -1
}

function _hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
}

function _photoFrameHtml(pet, stageIdx, animIdx, captionText) {
    const sheetUrl = pet.imageSheetUrl;
    const seed = _hashStr(`${pet.id || pet.dna || ''}|${stageIdx}|${animIdx}`);
    const bg = ALBUM_BG_PALETTE[seed % ALBUM_BG_PALETTE.length];
    const rotate = (((seed >> 4) % 1200) / 100 - 6).toFixed(2); // -6 ~ +6 度
    const offsetX = (((seed >> 8) % 80) / 10 - 4).toFixed(2);
    const offsetY = (((seed >> 12) % 60) / 10 - 3).toFixed(2);
    const bgPosX = (animIdx * 100 / 3).toFixed(4);
    const bgPosY = (stageIdx * 100 / 3).toFixed(4);
    const imageStyle = sheetUrl
        ? `background-image:url('${sheetUrl}');background-size:400% 400%;background-position:${bgPosX}% ${bgPosY}%;background-repeat:no-repeat;background-color:${bg}`
        : `background:${bg};display:flex;align-items:center;justify-content:center;font-size:32px;color:#9ca3af`;
    const placeholder = sheetUrl ? '' : '🥚';
    return `
        <div class="mh-album-photo" style="transform:translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg)">
            <div class="mh-album-photo-image" style="${imageStyle}">${placeholder}</div>
            <div class="mh-album-photo-caption">${escapeHtml(captionText)}</div>
        </div>`;
}

function _albumStageBlock(pet, stage, stageIdx) {
    const photos = ALBUM_ANIMS.map((anim, animIdx) => {
        const options = ALBUM_CAPTIONS[stage.id]?.[animIdx] || [''];
        const seed = _hashStr(`${pet.id || pet.dna || ''}|cap|${stageIdx}|${animIdx}`);
        const caption = options[seed % options.length] || '';
        return _photoFrameHtml(pet, stageIdx, animIdx, caption);
    }).join('');
    return `
        <div class="mh-album-stage">
            <div class="mh-album-stage-title">
                <span style="font-size:18px">${stage.emoji}</span>
                <span class="font-bold">${escapeHtml(stage.name)}</span>
                <span class="text-xs" style="color:var(--text-muted)">的回忆</span>
            </div>
            <div class="mh-album-grid">${photos}</div>
        </div>`;
}

function _ensureAlbumStyles() {
    if (document.getElementById('mh-album-styles')) return;
    const style = document.createElement('style');
    style.id = 'mh-album-styles';
    style.textContent = `
        .mh-album-mask { zoom:1 !important; align-items:flex-start; padding:12px 16px; overflow:hidden; }
        .mh-album-mask .modal-card { width:min(460px, calc(100vw - 32px)); max-width:460px; max-height:calc(100dvh - 24px); padding:18px; overflow:hidden; display:flex; flex-direction:column; }
        .mh-album-header { flex:0 0 auto; display:flex; flex-direction:column; gap:4px; padding-bottom:10px; margin-bottom:10px; border-bottom:1px dashed #d4d4d8; }
        .mh-album-meta { display:flex; flex-wrap:wrap; gap:6px 12px; font-size:12px; color:var(--text-secondary); }
        .mh-album-meta b { color:var(--text-primary); font-weight:600; }
        .mh-album-wish { font-size:12px; color:#a16207; background:#fef9c3; border-radius:8px; padding:6px 8px; margin-top:6px; }
        .mh-album-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:0 4px 2px; margin:0 -4px; overscroll-behavior:contain; }
        .mh-album-empty { text-align:center; color:var(--text-muted); padding:30px 14px; font-size:13px; }
        .mh-album-stage { margin-top:14px; }
        .mh-album-stage:first-child { margin-top:4px; }
        .mh-album-stage-title { display:flex; align-items:center; gap:6px; margin-bottom:8px; color:var(--text-primary); font-size:13px; }
        .mh-album-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:14px 10px; padding:6px 4px 10px; }
        .mh-album-photo { background:#ffffff; border:1px solid #e5e7eb; border-radius:6px; padding:6px 6px 8px; box-shadow:0 3px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08); transition: transform .2s ease; }
        .mh-album-photo:hover { transform: translate(0,0) rotate(0deg) scale(1.04) !important; z-index:2; position:relative; }
        .mh-album-photo-image { width:100%; aspect-ratio:1/1; border-radius:3px; image-rendering: pixelated; }
        .mh-album-photo-caption { margin-top:6px; font-size:11px; line-height:1.3; text-align:center; color:#4b5563; font-family: 'Kalam', 'Caveat', cursive, system-ui; min-height:1.3em; }
        .mh-album-close-row { flex:0 0 auto; display:flex; justify-content:flex-end; margin-top:12px; padding-top:10px; border-top:1px dashed #d4d4d8; }
    `;
    document.head.appendChild(style);
}

function openMemoryAlbum(pet) {
    if (!pet) return;
    _ensureAlbumStyles();
    const reachedIdx = _stageReachedIndex(pet.stage);
    const dietLabel = dietPreferenceLabel(dnaDietPreference(pet.dna || ''));
    const days = getCompanionDays(pet);
    const wish = (typeof pet.wishPrompt === 'string') ? pet.wishPrompt.trim() : '';

    let bodyHtml;
    if (reachedIdx < 0) {
        bodyHtml = `<div class="mh-album-empty">蛋还没有破壳，相册里暂时一片空白 🥚<br/>等你陪它长大，回忆就会一页页填满。</div>`;
    } else {
        const blocks = ALBUM_STAGES
            .slice(0, reachedIdx + 1)
            .map((stage, idx) => _albumStageBlock(pet, stage, idx))
            .join('');
        bodyHtml = blocks;
    }

    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-album-mask';
    mask.innerHTML = `
        <div class="modal-card">
            <div class="mh-album-header">
                <div class="flex items-center gap-2">
                    <span style="font-size:20px">📷</span>
                    <span class="font-extrabold" style="color:var(--text-primary)">${escapeHtml(displayPetName(pet))} · 回忆相册</span>
                </div>
                <div class="mh-album-meta">
                    <span>🎂 生日 <b>${escapeHtml(getPetBirthday(pet))}</b></span>
                    <span>🗓️ 陪伴第 <b>${days}</b> 天</span>
                    <span>🌱 阶段 <b>${escapeHtml(getStageName(pet.stage, pet.stage || ''))}</b></span>
                    <span>🍽️ 喜欢 <b>${escapeHtml(dietLabel)}</b></span>
                </div>
                ${wish ? `<div class="mh-album-wish">🌠 我的许愿：${escapeHtml(wish)}</div>` : ''}
            </div>
            <div class="mh-album-scroll">
                ${bodyHtml}
            </div>
            <div class="mh-album-close-row">
                <button class="btn-primary" data-album-close>关上相册</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask) { close(); return; }
        if (e.target.closest?.('[data-album-close]')) close();
    });
    document.body.appendChild(mask);
}

function sortPetsByRecentBirthday(pets) {
    return [...(pets || [])].sort((a, b) => {
        const aBornAt = Number(a?.bornAt) || 0;
        const bBornAt = Number(b?.bornAt) || 0;
        if (aBornAt !== bBornAt) return bBornAt - aBornAt;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}

export async function loadFamousPetsIndex() {
    if (Array.isArray(famousPetsIndex)) return famousPetsIndex;
    if (!famousPetsIndexPromise) {
        // `import.meta.url + ''` keeps Vite from statically analyzing this URL
        // and emitting a hashed copy of the verbatim-shipped famous-pets file.
        const indexUrl = new URL('../famous-pets/_pet_index.json', import.meta.url + '');
        famousPetsIndexPromise = fetch(indexUrl.href, { cache: 'no-cache' })
            .then(response => response.ok ? response.json() : [])
            .then(data => {
                const list = Array.isArray(data) ? data : (Array.isArray(data?.pets) ? data.pets : []);
                famousPetsIndex = list
                    .map(item => normalizeFamousPetIndexEntry(item, indexUrl.href))
                    .filter(item => item.id)
                    .sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || a.id.localeCompare(b.id));
                return famousPetsIndex;
            })
            .catch((e) => {
                console.warn('加载稀有宠物索引失败', e);
                famousPetsIndex = [];
                return famousPetsIndex;
            })
            .finally(() => { famousPetsIndexPromise = null; });
    }
    return famousPetsIndexPromise;
}

function normalizeFamousPetIndexEntry(item, baseUrl) {
    const entry = item && typeof item === 'object' ? { ...item } : {};
    const decodedTraits = entry.dna ? decodeDna(entry.dna) : null;
    entry.id = String(entry.id || '').trim();
    entry.name = String(entry.name || '').trim();
    entry.imageSheetUrl = resolveFamousPetIndexAssetUrl(entry.imageSheetUrl, baseUrl);
    entry.imageUrl = resolveFamousPetIndexAssetUrl(entry.imageUrl, baseUrl);
    entry.traits = normalizeFamousPetTraits(entry.traits || decodedTraits || entry);
    entry.rarity = Number(entry.rarity) || 0;
    entry.price = Math.max(0, Math.round(Number(entry.price ?? 100) || 100));
    entry.filterMetadataLoaded = true;
    return entry;
}

function resolveFamousPetIndexAssetUrl(value, baseUrl) {
    const raw = String(value || '').trim();
    if (!raw || /^(?:https?:|data:|blob:|\/)/i.test(raw)) return raw;
    try { return new URL(raw, baseUrl).href; }
    catch (_) { return raw; }
}

function normalizeFamousPetElement(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'sky' || raw.includes('天空')) return '天空';
    if (raw === 'land' || raw.includes('陆地')) return '陆地';
    if (raw === 'water' || raw === 'ocean' || raw.includes('水') || raw.includes('海')) return '水系';
    return String(value || '').trim();
}

function normalizeFamousPetTraits(source) {
    const traits = source?.traits && typeof source.traits === 'object' ? source.traits : source;
    if (!traits || typeof traits !== 'object') return {};
    const element = normalizeFamousPetElement(traits.element || traits.habitat || traits.category || traits.field);
    const elementalAttribute = String(traits.elementalAttribute || traits.attribute || '').trim();
    return {
        ...traits,
        ...(element ? { element } : {}),
        ...(elementalAttribute ? { elementalAttribute } : {}),
    };
}

function petElementalAttribute(petOrEntry) {
    const traits = normalizeFamousPetTraits(petOrEntry?.traits || petOrEntry || {});
    if (traits.elementalAttribute) return traits.elementalAttribute;
    if (petOrEntry?.dna) {
        try { return decodeDna(petOrEntry.dna)?.elementalAttribute || ''; }
        catch (_) { return ''; }
    }
    return '';
}

function petArtBackground(petOrEntry) {
    return ELEMENTAL_ATTRIBUTE_BACKGROUNDS[petElementalAttribute(petOrEntry)] || DEFAULT_PET_ART_BACKGROUND;
}

function applyFamousPetConfigMetadata(entry, config) {
    if (!entry) return entry;
    if (!config) {
        entry.filterMetadataLoaded = true;
        return entry;
    }
    const decodedTraits = config.dna ? decodeDna(config.dna) : null;
    entry.traits = normalizeFamousPetTraits(config.traits || decodedTraits || entry.traits || {});
    entry.dna = config.dna || entry.dna || '';
    entry.filterMetadataLoaded = true;
    return entry;
}

function needsFamousPetFilterMetadata(list) {
    return Array.isArray(list) && list.some(entry => !(entry?.filterMetadataLoaded || entry?.traits?.element || entry?.traits?.elementalAttribute));
}

async function loadFamousPetFilterMetadata() {
    const list = await loadFamousPetsIndex();
    if (!needsFamousPetFilterMetadata(list)) return list;
    if (!famousPetsFilterMetadataPromise) {
        famousPetsFilterMetadataPromise = Promise.all(list.map(async (entry) => {
            if (entry.filterMetadataLoaded || entry.traits?.element || entry.traits?.elementalAttribute) return entry;
            const config = await loadFamousPetConfig(entry);
            return applyFamousPetConfigMetadata(entry, config);
        })).then(() => list).finally(() => { famousPetsFilterMetadataPromise = null; });
    }
    return famousPetsFilterMetadataPromise;
}

function hasHatchedFamousPet(entry, pets) {
    const id = String(entry?.id || '').trim();
    const name = String(entry?.name || '').trim();
    if (!id && !name) return false;
    return (pets || []).some(pet => {
        if (!pet) return false;
        const petId = String(pet.id || '').trim();
        if (pet.lazyPetRecord) return !!id && petId === id;
        const petName = String(pet.name || '').trim();
        return (!!id && petId === id) || (!!name && petName === name);
    });
}

function rarePetArtHtml(entry, unlocked) {
    const canShowBaby = !!(entry?.imageSheetUrl || entry?.imageUrl);
    if (!unlocked && !canShowBaby) {
        return `<div class="mh-rare-pet-unknown" aria-label="未发现">?</div>`;
    }
    const pet = {
        id: entry.id,
        stage: unlocked ? 'adult' : 'baby',
        anim: 'happy',
        imageUrl: entry.imageUrl || null,
        imageSheetUrl: entry.imageSheetUrl || null,
        dna: entry.dna || '',
        traits: entry.traits || null,
    };
    return rawPetArtHtml(pet, entry.name || entry.id);
}

function rarePetCardHtml(entry, pets) {
    const unlocked = hasHatchedFamousPet(entry, pets);
    const name = unlocked ? (entry.name || entry.id) : '???';
    const rarity = Math.max(0, Math.round(Number(entry.rarity) || 0));
    return `
        <button class="card-flat fade-in mh-rare-pet-card ${unlocked ? 'is-unlocked' : 'is-locked'}" data-rare-pet-id="${escapeHtml(entry.id)}" type="button">
            <div class="mh-rare-pet-portrait">
                ${rarePetArtHtml(entry, unlocked)}
            </div>
            <div class="mh-rare-pet-info">
                <div class="mh-rare-pet-name">${escapeHtml(name)}</div>
                <div class="mh-rare-pet-meta">
                    <span class="stage-badge" style="background:${unlocked ? '#ecfeff' : '#f3f4f6'};color:${unlocked ? 'var(--accent-dark)' : '#6b7280'}">稀有度 ${rarity}</span>
                    <span>${unlocked ? '已发现' : '未发现'}</span>
                </div>
            </div>
        </button>`;
}

function famousPetFilterMatches(entry, filterId = activeFamousPetFilter) {
    if (!filterId || filterId === 'all') return true;
    const filter = FAMOUS_PET_FILTERS.find(item => item.id === filterId);
    if (!filter) return true;
    const traits = normalizeFamousPetTraits(entry?.traits || {});
    if (filter.type === 'element') return traits.element === filter.value;
    if (filter.type === 'attribute') return traits.elementalAttribute === filter.value;
    return true;
}

function filteredFamousPets(list) {
    return (list || []).filter(entry => famousPetFilterMatches(entry));
}

function famousPetFilterTabsHtml(list) {
    const safeList = Array.isArray(list) ? list : [];
    const countFor = (filter) => filter.id === 'all'
        ? safeList.length
        : safeList.filter(entry => famousPetFilterMatches(entry, filter.id)).length;
    return `
        <div class="mh-famous-filter-tabs" role="tablist" aria-label="稀有宠物分类">
            ${FAMOUS_PET_FILTERS.map(filter => {
                const active = activeFamousPetFilter === filter.id;
                const count = countFor(filter);
                return `
                    <button class="mh-famous-filter-tab ${active ? 'active' : ''}" data-famous-pet-filter="${escapeHtml(filter.id)}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}">
                        ${escapeHtml(filter.label)}<span>${count}</span>
                    </button>`;
            }).join('')}
        </div>`;
}


function rememberFamousPetFilterScroll(panel) {
    const tabs = panel?.querySelector?.('.mh-famous-filter-tabs');
    if (tabs) famousPetFilterTabsScrollLeft = tabs.scrollLeft || 0;
}

function restoreFamousPetFilterScroll(panel) {
    const tabs = panel?.querySelector?.('.mh-famous-filter-tabs');
    if (!tabs) return;
    const restore = () => { tabs.scrollLeft = famousPetFilterTabsScrollLeft; };
    restore();
    requestAnimationFrame(restore);
    tabs.addEventListener('scroll', () => {
        famousPetFilterTabsScrollLeft = tabs.scrollLeft || 0;
    }, { passive: true });
}

function rarePetPrice(entry) {
    return Math.max(0, Math.round(Number(entry?.price ?? 100) || 100));
}

function rarePetPhotoCellHtml(entry, stageIdx, animIdx, unlocked) {
    const canReveal = unlocked || stageIdx === 0;
    const seed = _hashStr(`${entry?.id || ''}|rare|${stageIdx}|${animIdx}`);
    const rotate = (((seed >> 4) % 1000) / 100 - 5).toFixed(2);
    const offsetX = (((seed >> 8) % 60) / 10 - 3).toFixed(2);
    const offsetY = (((seed >> 12) % 50) / 10 - 2.5).toFixed(2);
    if (!canReveal || !entry?.imageSheetUrl) {
        return `
            <div class="mh-rare-album-photo" style="transform:translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg)">
                <div class="mh-rare-album-image mh-rare-photo-unknown">?</div>
            </div>`;
    }
    const bx = (animIdx * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (stageIdx * 100 / (SHEET_ROWS - 1)).toFixed(3);
    const bg = petArtBackground(entry);
    return `
        <div class="mh-rare-album-photo" style="transform:translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg)">
            <div class="mh-rare-album-image mh-rare-photo-image mh-pet-list-raw" data-mh-raw-url="${escapeHtml(entry.imageSheetUrl)}" style="background-color:${bg};background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:auto"></div>
        </div>`;
}

function rarePetPhotoGridHtml(entry, unlocked) {
    const stages = unlocked ? ALBUM_STAGES : ALBUM_STAGES.slice(0, 1);
    const blocks = stages.map((stage, stageIdx) => {
        const cells = [];
        for (let animIdx = 0; animIdx < SHEET_COLS; animIdx++) {
            cells.push(rarePetPhotoCellHtml(entry, stageIdx, animIdx, unlocked));
        }
        return `
            <div class="mh-rare-album-stage">
                <div class="mh-rare-album-stage-title">
                    <span style="font-size:18px">${stage.emoji}</span>
                    <span class="font-bold">${escapeHtml(stage.name)}</span>
                </div>
                <div class="mh-rare-album-grid">${cells.join('')}</div>
            </div>`;
    }).join('');
    return `<div class="mh-rare-album-scroll">${blocks}</div>`;
}

async function loadFamousPetConfig(entry) {
    const id = String(entry?.id || '').trim();
    if (!id) return null;
    return {
        ...entry,
        id,
        name: entry.name || id,
        imageUrl: entry.imageUrl || null,
        imageSheetUrl: entry.imageSheetUrl || null,
        traits: normalizeFamousPetTraits(entry.traits || entry),
    };
}

function openRarePetModal(entry, pets, refreshPetList) {
    const unlocked = hasHatchedFamousPet(entry, pets);
    const price = rarePetPrice(entry);
    const canAfford = (Number(state.coins) || 0) >= price;
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-rare-modal-mask';
    mask.innerHTML = `
        <div class="modal-card mh-rare-modal-card">
            <div class="mh-rare-modal-head">
                <div>
                    <div class="mh-rare-modal-title">${escapeHtml(unlocked ? (entry.name || entry.id) : '???')}</div>
                    <div class="mh-rare-modal-subtitle">稀有度 ${escapeHtml(Math.round(Number(entry.rarity) || 0))}</div>
                </div>
                <button class="mh-rare-modal-close" data-rare-close type="button" aria-label="关闭">×</button>
            </div>
            ${rarePetPhotoGridHtml(entry, unlocked)}
            <div class="mh-rare-modal-actions">
                ${unlocked
                    ? '<button class="btn-secondary" data-rare-close type="button">已拥有</button>'
                    : `<button class="btn-primary" data-rare-hatch type="button" ${canAfford ? '' : 'disabled'}>孵化 ${coinIconSvg()} ${price}</button>`}
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-rare-close]')) { close(); return; }
        if (e.target.closest?.('[data-rare-hatch]')) hatchRarePet(entry, mask, refreshPetList);
    });
    document.body.appendChild(mask);
    setupLazyRawPetImages(mask);
    if (!unlocked && !canAfford) showToast(`金币不足，需要 ${price} 金币`, 'error', 1800);
}

async function hatchRarePet(entry, mask, refreshPetList) {
    const price = rarePetPrice(entry);
    if ((Number(state.coins) || 0) < price) {
        showToast(`金币不足，需要 ${price} 金币`, 'error', 1800);
        return;
    }
    const button = mask.querySelector('[data-rare-hatch]');
    if (button?.disabled) return;
    if (button) button.disabled = true;

    const current = state.currentPetId ? state.pets[state.currentPetId] : null;
    if (current && isPetOnCurrentPlanet(current)) {
        const targetName = entry?.name || entry?.id || '稀有宠物';
        const ok = await confirm(`孵化 ${targetName} 前，${current.name || '当前宠物'} 会被放养到星球中，无法重新召回；随后会扣除 ${price} 金币。确定继续吗？`, {
            okText: '放养并孵化',
            cancelText: '再想想',
        });
        if (!ok) {
            if (button) button.disabled = false;
            return;
        }
    }

    const config = await loadFamousPetConfig(entry);
    if (!config?.id) {
        showToast('稀有宠物配置不存在', 'error', 2200);
        if (button) button.disabled = false;
        return;
    }

    if (current && isPetOnCurrentPlanet(current)) {
        markPetReleased(current, state.planetName || '宠物星');
        await savePet(current);
    }

    const now = Date.now();
    const pet = {
        ...JSON.parse(JSON.stringify(config)),
        id: config.id || entry.id || `rare_${randId(8)}`,
        name: config.name || entry.name || config.id || entry.id || '稀有宠物',
        imageUrl: config.imageUrl || null,
        imageSheetUrl: config.imageSheetUrl || entry.imageSheetUrl || null,
        source: 'famous-pets',
        sourcePetId: `famous-pets/${entry.id}`,
        stats: eggStats(),
        permanentTrauma: defaultPermanentTrauma(),
        bornAt: now,
        lastTickAt: now,
        lastCareAt: now,
        parents: null,
        stage: 'egg',
        anim: 'idle',
        activeRoom: 'living',
        eggHatchPending: true,
        eggHatchQueuedAt: now,
    };

    state.coins = Math.max(0, (Number(state.coins) || 0) - price);
    await savePet(pet);
    await setCurrentPetPersisted(pet.id);
    saveUserProfileDebounced();
    try { await ensurePetData(pet.id); } catch (_) {}
    mask.remove();
    showToast(`${pet.name} 的蛋已经来到星球`, 'success', 1800);
    notify();
    setView('home');

    setTimeout(async () => {
        const currentPet = state.pets[pet.id];
        if (!currentPet || currentPet.stage !== 'egg') return;
        currentPet.stage = 'baby';
        currentPet.anim = 'happy';
        currentPet.stats = defaultStats();
        currentPet.bornAt = Date.now();
        currentPet.lastTickAt = currentPet.bornAt;
        currentPet.lastCareAt = currentPet.bornAt;
        delete currentPet.eggHatchPending;
        delete currentPet.eggHatchQueuedAt;
        delete currentPet.eggHatchRequestedAt;
        try { applyStage(currentPet); } catch (_) {}
        await savePet(currentPet);
        notify();
        showToast(`${currentPet.name || '稀有宠物'} 孵化啦`, 'success', 2000);
        refreshPetList?.();
    }, 2000);
}

function petListTabsHtml({ petCount = 0, rareUnlockedCount = 0, rareTotalCount = 0 } = {}) {
    return `
        <div class="mh-pet-list-tabs" role="tablist" aria-label="宠物列表分类">
            ${PET_LIST_TABS.map(tab => `
                <button class="mh-pet-list-tab ${activePetListTab === tab.id ? 'active' : ''}" data-pet-list-tab="${escapeHtml(tab.id)}" type="button" role="tab" aria-selected="${activePetListTab === tab.id ? 'true' : 'false'}">
                    ${escapeHtml(tab.id === 'mine' ? `${tab.label}（${petCount}）` : `${tab.label}（${rareUnlockedCount}/${rareTotalCount}）`)}
                </button>`).join('')}
        </div>`;
}

function ensurePetListTabStyles() {
    if (document.getElementById('mh-pet-list-tab-styles')) return;
    const style = document.createElement('style');
    style.id = 'mh-pet-list-tab-styles';
    style.textContent = `
        .mh-pet-card-title-row { display:flex; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap; }
        .mh-pet-card-name { color:var(--text-primary); min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .mh-pet-card-location-row { display:flex; align-items:center; gap:6px; margin-bottom:5px; }
        .mh-pet-list-tabs { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px; margin-bottom:12px; }
        .mh-pet-list-tab { height:34px; border-radius:999px; border:1.5px solid var(--border-card); background:#effaff; color:var(--text-secondary); font-size:13px; font-weight:900; cursor:pointer; box-shadow:inset 0 1px 0 rgba(255,255,255,0.78); }
        .mh-pet-list-tab.active { background:linear-gradient(135deg, var(--accent-light), var(--accent-dark)); color:#fff; border-color:var(--accent); text-shadow:0 1px 0 rgba(15,23,42,0.45); }
        .mh-famous-filter-tabs { display:flex; gap:6px; overflow-x:auto; padding:0 0 10px; margin:-2px 0 10px; overscroll-behavior-x:contain; scrollbar-width:none; }
        .mh-famous-filter-tabs::-webkit-scrollbar { display:none; }
        .mh-famous-filter-tab { flex:0 0 auto; height:30px; border-radius:999px; border:1.5px solid var(--border-card); background:#fff; color:var(--text-secondary); font-size:12px; font-weight:900; padding:0 10px; display:inline-flex; align-items:center; gap:5px; cursor:pointer; }
        .mh-famous-filter-tab span { min-width:16px; height:16px; padding:0 4px; border-radius:999px; background:#f1f5f9; color:#64748b; font-size:10px; line-height:16px; text-align:center; }
        .mh-famous-filter-tab.active { background:linear-gradient(135deg, #e0f7ff, #8edfff); border-color:#38bdf8; color:var(--text-primary); box-shadow:inset 0 1px 0 rgba(255,255,255,.82), 0 2px 5px rgba(14,116,144,.16); }
        .mh-famous-filter-tab.active span { background:rgba(255,255,255,.72); color:var(--accent-dark); }
        .mh-rare-pet-list { display:grid; grid-template-columns:repeat(auto-fill, minmax(138px, 1fr)); gap:10px; }
        .mh-rare-pet-card { appearance:none; font:inherit; cursor:pointer; min-height:184px; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; }
        .mh-rare-pet-card:hover { transform:translateY(-2px); border-color:var(--accent); }
        .mh-rare-pet-card.is-locked { filter:saturate(.75); }
        .mh-rare-pet-portrait { width:96px; height:96px; border-radius:16px; background:var(--bg-pill); overflow:hidden; flex:0 0 auto; box-shadow:inset 0 2px 8px rgba(14,116,144,0.16); }
        .mh-rare-pet-unknown { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:48px; font-weight:900; background:linear-gradient(135deg, #f8fafc, #dbeafe); }
        .mh-rare-pet-info { width:100%; min-width:0; display:flex; flex-direction:column; gap:6px; }
        .mh-rare-pet-name { color:var(--text-primary); font-size:15px; font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .mh-rare-pet-meta { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:6px; font-size:11px; color:var(--text-muted); }
        .mh-rare-modal-mask { zoom:1 !important; align-items:flex-start; padding:12px 16px; overflow:hidden; }
        .mh-rare-modal-card { width:min(460px, calc(100vw - 32px)); max-width:460px; max-height:calc(100dvh - 24px); overflow:hidden; display:flex; flex-direction:column; gap:12px; }
        .mh-rare-modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .mh-rare-modal-title { color:var(--text-primary); font-size:18px; font-weight:900; }
        .mh-rare-modal-subtitle { color:var(--text-muted); font-size:12px; font-weight:800; margin-top:2px; }
        .mh-rare-modal-close { width:36px; height:36px; border-radius:50%; border:1.5px solid var(--border-card); background:#fff; color:var(--text-primary); font-size:24px; line-height:1; cursor:pointer; }
        .mh-rare-album-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:0 4px 2px; margin:0 -4px; overscroll-behavior:contain; }
        .mh-rare-album-stage { margin-top:14px; }
        .mh-rare-album-stage:first-child { margin-top:2px; }
        .mh-rare-album-stage-title { display:flex; align-items:center; gap:6px; margin-bottom:8px; color:var(--text-primary); font-size:13px; }
        .mh-rare-album-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px 10px; padding:6px 4px 10px; }
        .mh-rare-album-photo { background:#ffffff; border:1px solid #e5e7eb; border-radius:6px; padding:6px; box-shadow:0 3px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08); transition:transform .2s ease; }
        .mh-rare-album-photo:hover { transform:translate(0,0) rotate(0deg) scale(1.04) !important; z-index:2; position:relative; }
        .mh-rare-album-image { width:100%; aspect-ratio:1/1; border-radius:3px; overflow:hidden; }
        .mh-rare-photo-image { display:block; background-color:#effaff; }
        .mh-rare-photo-unknown { display:flex; align-items:center; justify-content:center; color:#64748b; font-size:28px; font-weight:900; background:linear-gradient(135deg, #f8fafc, #dbeafe); }
        .mh-rare-modal-actions { flex:0 0 auto; display:flex; justify-content:flex-end; gap:8px; padding-top:10px; border-top:1px dashed #d4d4d8; }
        .mh-rare-modal-actions .btn-primary { min-width:128px; }
        .mh-rare-modal-actions .hud-coin-icon { width:15px; height:15px; }
        @media (max-width:420px) { .mh-rare-album-grid { gap:12px 8px; } .mh-rare-album-photo { padding:5px; } }
    `;
    document.head.appendChild(style);
}

function rawPetArtHtml(pet, alt = '') {
    const url = pet?.imageSheetUrl || pet?.imageUrl || '';
    const cell = pet?.imageSheetUrl ? getPetSpriteCell(pet) : null;
    const safeAlt = escapeHtml(alt);
    const bg = petArtBackground(pet);

    if (pet?.imageUrl && !pet?.imageSheetUrl) {
        return `<div class="mh-pet-art mh-pet-list-raw" data-mh-raw-url="${escapeHtml(url)}" aria-label="${safeAlt}"
            style="width:100%;height:100%;display:block;background:${bg};background-size:contain;background-position:center;background-repeat:no-repeat;image-rendering:auto"></div>`;
    }

    if (!url || !cell) {
        return `<div class="mh-pet-art mh-pet-art-egg" aria-label="${safeAlt}"
            style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
            ${buildEggSvg(pet)}
        </div>`;
    }

    const bx = (cell.col * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (cell.row * 100 / (SHEET_ROWS - 1)).toFixed(3);
    return `<div class="mh-pet-art mh-pet-art-sprite mh-pet-list-raw" data-mh-raw-url="${escapeHtml(url)}" aria-label="${safeAlt}"
        style="width:100%;height:100%;display:block;background:${bg};background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:auto"></div>`;
}

function setupLazyRawPetImages(root) {
    const targets = $$('.mh-pet-list-raw[data-mh-raw-url]', root).filter(el => el.dataset.mhRawLoaded !== '1');
    if (!targets.length) return;

    const load = (el) => {
        if (!el || el.dataset.mhRawLoaded === '1') return;
        const url = el.dataset.mhRawUrl || '';
        if (!url) return;
        el.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
        el.dataset.mhRawLoaded = '1';
    };

    if (typeof IntersectionObserver === 'undefined') {
        targets.forEach(load);
        return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
            load(entry.target);
            obs.unobserve(entry.target);
        });
    }, { root: null, rootMargin: '120px 0px', threshold: 0.01 });

    targets.forEach(el => observer.observe(el));
}

function petCardHtml(pet, isCurrent, allowSelect = false, picker = null, canDelete = false) {
    const lazy = !!pet.lazyPetRecord;
    const isPicker = !!picker;
    const stats = lazy ? { hunger: 100, mood: 100 } : getRuntimePetStats(pet);
    const staminaBar = Math.round(stats.hunger || 0);
    const moodBar = Math.round(stats.mood || 0);
    const sheetReady = !!pet.imageSheetUrl;
    const planetName = window.MH_state?.planetName || '宠物星';
    const location = getPetLocationInfo(pet, planetName);
    const selectable = !lazy && (isPicker || isPetSelectable(pet));
    const canSelect = (allowSelect || isPicker) && selectable;
    const picked = isPicker && picker.selectedIds?.has?.(pet.id);
    const findTarget = getPetFindTarget(pet);
    const name = lazy ? `宠物 ${String(pet.id || '').slice(0, 6)}` : displayPetName(pet);
    const hint = pet.stage === 'egg'
        ? (sheetReady ? '即将破壳…' : '正在孕育中…')
        : '';
        return `
                <div class="card-flat fade-in ${canSelect ? 'cursor-pointer' : ''} ${isCurrent ? 'mh-pet-card-current' : ''} ${picked ? 'mh-pet-card-picked' : ''}"
                         data-pet-id="${escapeHtml(pet.id)}"
                         ${lazy ? 'data-pet-lazy="1"' : ''}
                         data-selectable="${canSelect ? '1' : '0'}"
                         style="display:flex;gap:12px;align-items:center;${isCurrent ? 'outline:2px solid var(--accent);outline-offset:-2px' : ''};${picked ? 'box-shadow:0 0 0 2px var(--accent) inset;' : ''};opacity:${selectable ? '1' : '.88'};position:relative">
            ${canDelete && !lazy ? `<button class="btn-secondary" data-delete-pet="${escapeHtml(pet.id)}" title="流放 ${escapeHtml(name)} 到随机星球" aria-label="流放 ${escapeHtml(name)} 到随机星球" style="position:absolute;top:8px;right:8px;width:24px;height:24px;padding:0;border-radius:50%;font-size:15px;line-height:1;color:#c08497;background:rgba(255,255,255,.72);border-color:rgba(244,114,182,.28);box-shadow:0 1px 3px rgba(15,23,42,.06)">×</button>` : ''}
            <div style="width:72px;height:72px;border-radius:14px;background:var(--bg-pill);overflow:hidden;flex-shrink:0">
                ${lazy ? '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:12px">加载中</div>' : rawPetArtHtml(pet, displayPetName(pet))}
            </div>
            <div style="flex:1;min-width:0">
                <div class="mh-pet-card-title-row">
                    <span class="text-base font-bold mh-pet-card-name">${escapeHtml(name)}</span>
                    ${lazy ? '<span class="stage-badge">未加载</span>' : `<span class="stage-badge">${escapeHtml(getStageName(pet.stage, pet.stage || ''))}</span>`}
                    ${isCurrent ? '<span class="stage-badge" style="background:var(--accent);color:#fff">当前</span>' : ''}
                </div>
                <div class="mh-pet-card-location-row">
                    <span class="stage-badge" style="background:#ecfeff;color:${escapeHtml(location.tone)}">${escapeHtml(location.label)}</span>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px;display:flex;gap:8px;flex-wrap:wrap">
                    ${lazy ? '<span>进入视野后加载资料</span>' : `<span>生日 ${escapeHtml(getPetBirthday(pet))}</span><span>陪伴第 ${getCompanionDays(pet)} 天</span>`}
                </div>
                ${lazy || isPicker ? '' : `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:ui-monospace,Menlo,monospace">
                    DNA: ${escapeHtml(formatDna(pet.dna || ''))}
                </div>`}
                ${hint ? `<div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">${escapeHtml(hint)}</div>` : ''}
                ${isPicker ? '' : `<div style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--text-secondary)">
                        <span>⚡</span><div class="stat-bar" style="flex:1"><div style="width:${staminaBar}%;background:#84cc16"></div></div>
                    <span>😊</span><div class="stat-bar" style="flex:1"><div style="width:${moodBar}%;background:#f59e0b"></div></div>
                </div>`}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-self:center;flex-shrink:0">
                ${isPicker && !lazy ? `<span class="stage-badge" data-picker-state style="align-self:flex-end;background:${picked ? 'var(--accent)' : '#effaff'};color:${picked ? '#fff' : 'var(--text-secondary)'}">${picked ? '已选' : '选择'}</span>` : ''}
                ${!isPicker && findTarget ? `<button class="btn-secondary" data-find="${escapeHtml(pet.id)}" title="寻找 ${escapeHtml(name)}" style="padding:7px 10px;font-size:12px">寻找</button>` : ''}
                ${!isPicker && !lazy ? `<button class="btn-secondary" data-album="${escapeHtml(pet.id)}" title="查看 ${escapeHtml(name)} 的回忆相册" style="padding:7px 10px;font-size:12px">相册</button>` : ''}
            </div>
        </div>`;
}

function setupLazyPetCards(panel, onLoadPet, { renderLoadedCard, onCardReady } = {}) {
    if (typeof onLoadPet !== 'function') return;
    const targets = $$('[data-pet-lazy="1"]', panel);
    if (!targets.length) return;
    const load = async (el) => {
        const id = el?.dataset?.petId;
        if (!id || el.dataset.petLazyLoading === '1') return;
        el.dataset.petLazyLoading = '1';
        const loadedPet = await onLoadPet(id, el);
        if (!loadedPet || !el.isConnected || typeof renderLoadedCard !== 'function') return;
        const holder = document.createElement('div');
        holder.innerHTML = renderLoadedCard(loadedPet);
        const next = holder.firstElementChild;
        if (!next) return;
        el.replaceWith(next);
        setupLazyRawPetImages(next);
        onCardReady?.(next, loadedPet);
    };
    if (typeof IntersectionObserver !== 'undefined') {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
                load(entry.target);
                obs.unobserve(entry.target);
            });
        }, { root: null, rootMargin: '140px 0px', threshold: 0.01 });
        targets.forEach(el => observer.observe(el));
        return;
    }
    const scroller = panel.querySelector('[style*="overflow-y:auto"]') || panel;
    const check = () => {
        const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
        targets.forEach((el) => {
            const rect = el.getBoundingClientRect?.();
            if (rect && rect.bottom > -140 && rect.top < vh + 140) load(el);
        });
    };
    scroller.addEventListener?.('scroll', check, { passive: true });
    requestAnimationFrame(check);
}

export function renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onLoadPet, allowSelect = false, pickerMode = false, multiple = false, selectedIds = [], onConfirm, title, confirmText } = {}) {
    ensurePetListTabStyles();
    rememberFamousPetFilterScroll(panel);
    const list = sortPetsByRecentBirthday(pets || []);
    const rareList = Array.isArray(famousPetsIndex) ? famousPetsIndex : [];
    const rareFilteredList = filteredFamousPets(rareList);
    const rareUnlockedCount = rareList.filter(item => hasHatchedFamousPet(item, pets || [])).length;
    const isPicker = !!pickerMode;
    if (isPicker) activePetListTab = 'mine';
    const isRareTab = !isPicker && activePetListTab === 'rare';
    const pickedIds = new Set((Array.isArray(selectedIds) ? selectedIds : []).filter(Boolean));
    const picker = isPicker ? { selectedIds: pickedIds } : null;
    const currentId = (typeof window !== 'undefined' && window.MH_state) ? window.MH_state.currentPetId : null;
    const currentPets = currentId ? list.filter(p => p.id === currentId) : [];
    const otherPets = currentId ? list.filter(p => p.id !== currentId) : list;
    const tipsHtml = `
            <div class="card-flat mt-3 text-xs" style="color:var(--text-muted);background:#fffbeb">
                💡 领养新蛋请前往孵化仓。放养、哈奇岛和其它星球的宠物会保留在画册里，但不能被召回。
            </div>`;
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhPetListBack" title="返回" style="width:36px;height:36px;font-size:18px">‹</button>
            <div class="flex items-center gap-2">
                <span style="font-size:22px">🐾</span>
                <span class="font-extrabold" style="color:var(--text-primary)">${escapeHtml(title || t('myPets'))}</span>
            </div>
            ${isPicker ? '<span style="width:36px;height:36px"></span>' : `<span class="font-bold mh-coin-amount" style="color:var(--accent-dark)">${coinIconSvg()} ${window.MH_state?.coins || 0}</span>`}
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:${isPicker && multiple ? '62px' : '0'};overflow-y:auto;padding:14px">
            ${isPicker ? '' : petListTabsHtml({ petCount: list.length, rareUnlockedCount, rareTotalCount: rareList.length })}
            ${isRareTab
                ? (Array.isArray(famousPetsIndex)
                    ? (rareList.length === 0
                        ? `<div class="card-flat text-center" style="color:var(--text-muted);padding:30px 14px">暂无稀有宠物记录。</div>`
                        : `${famousPetFilterTabsHtml(rareList)}${rareFilteredList.length === 0
                            ? `<div class="card-flat text-center" style="color:var(--text-muted);padding:30px 14px">这个分类里暂时没有稀有宠物。</div>`
                            : `<div class="mh-rare-pet-list" id="mhRarePetList">${rareFilteredList.map(item => rarePetCardHtml(item, pets || [])).join('')}</div>`}`)
                    : `<div class="card-flat text-center" style="color:var(--text-muted);padding:30px 14px">正在加载稀有宠物...</div>`)
                : (list.length === 0
                ? `<div class="card-flat text-center" style="color:var(--text-muted);padding:30px 14px">${escapeHtml(t('noPets'))}</div>`
                : `<div style="display:flex;flex-direction:column;gap:10px" id="mhPetList">
                    ${currentPets.map(p => petCardHtml(p, true, allowSelect, picker, false)).join('')}
                    ${isPicker ? '' : tipsHtml}
                    ${otherPets.map(p => petCardHtml(p, false, allowSelect, picker, typeof onDelete === 'function' && !isPicker)).join('')}
                </div>`)}
            ${!isPicker && !isRareTab && list.length === 0 ? tipsHtml : ''}
        </div>
        ${isPicker && multiple ? `<div class="absolute" style="left:0;right:0;bottom:0;padding:10px 14px max(12px,env(safe-area-inset-bottom));background:rgba(239,250,255,.95);border-top:1px solid rgba(125,211,252,.58);display:flex;gap:8px;align-items:center">
            <div data-picker-count style="flex:1;color:var(--text-muted);font-size:12px;font-weight:800">已选择 ${pickedIds.size} 只</div>
            <button class="btn-primary" id="mhPetPickerConfirm" type="button">${escapeHtml(confirmText || '确定')}</button>
        </div>` : ''}`;

    if (isRareTab) restoreFamousPetFilterScroll(panel);

    if ($('mhPetListBack')) $('mhPetListBack').onclick = () => onBack?.();
    $$('[data-pet-list-tab]', panel).forEach(el => {
        el.onclick = () => {
            const next = el.dataset.petListTab || 'mine';
            if (activePetListTab === next) return;
            activePetListTab = next;
            renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onLoadPet, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        };
    });

    if (!isPicker && !Array.isArray(famousPetsIndex)) {
        loadFamousPetsIndex().then(() => {
            if (panel?.isConnected) renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onLoadPet, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        });
    }

    if (isRareTab && needsFamousPetFilterMetadata(famousPetsIndex) && !famousPetsFilterMetadataPromise) {
        loadFamousPetFilterMetadata().then(() => {
            if (panel?.isConnected) renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onLoadPet, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        });
    }

    $$('[data-famous-pet-filter]', panel).forEach(el => {
        el.onclick = () => {
            const next = el.dataset.famousPetFilter || 'all';
            if (activeFamousPetFilter === next) return;
            activeFamousPetFilter = FAMOUS_PET_FILTERS.some(filter => filter.id === next) ? next : 'all';
            renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onLoadPet, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        };
    });

    $$('#mhRarePetList [data-rare-pet-id]', panel).forEach(el => {
        el.onclick = () => {
            const entry = rareList.find(item => item.id === el.dataset.rarePetId);
            if (entry) openRarePetModal(entry, pets || [], () => renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onLoadPet, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText }));
        };
    });

    const petById = new Map((pets || []).map(p => [p?.id, p]));
    const updatePickerCardState = (el, picked) => {
        el.classList.toggle('mh-pet-card-picked', picked);
        el.style.boxShadow = picked ? '0 0 0 2px var(--accent) inset' : '';
        const badge = el.querySelector('[data-picker-state]');
        if (badge) {
            badge.textContent = picked ? '已选' : '选择';
            badge.style.background = picked ? 'var(--accent)' : '#effaff';
            badge.style.color = picked ? '#fff' : 'var(--text-secondary)';
        }
        const count = panel.querySelector('[data-picker-count]');
        if (count) count.textContent = `已选择 ${pickedIds.size} 只`;
    };
    const bindPetCardEvents = (el) => {
        el.onclick = (e) => {
            if (e.target.closest('[data-find]')) return;
            if (e.target.closest('[data-album]')) return;
            if (e.target.closest('[data-delete-pet]')) return;
            if (el.dataset.selectable !== '1') return;
            const id = el.dataset.petId;
            if (isPicker) {
                if (multiple) {
                    const picked = !pickedIds.has(id);
                    if (picked) pickedIds.add(id);
                    else pickedIds.delete(id);
                    updatePickerCardState(el, picked);
                } else {
                    onSelect?.(id);
                    onConfirm?.([id]);
                }
                return;
            }
            onSelect?.(id);
        };
        const findButton = el.querySelector('[data-find]');
        if (findButton) findButton.onclick = (e) => {
            e.stopPropagation();
            onFind?.(findButton.dataset.find);
        };
        const albumButton = el.querySelector('[data-album]');
        if (albumButton) albumButton.onclick = (e) => {
            e.stopPropagation();
            const pet = petById.get(albumButton.dataset.album);
            if (pet) openMemoryAlbum(pet);
        };
        const deleteButton = el.querySelector('[data-delete-pet]');
        if (deleteButton) deleteButton.onclick = (e) => {
            e.stopPropagation();
            onDelete?.(deleteButton.dataset.deletePet);
        };
    };
    $$('#mhPetList [data-pet-id]').forEach(bindPetCardEvents);
    if ($('mhPetPickerConfirm')) $('mhPetPickerConfirm').onclick = () => onConfirm?.([...pickedIds]);
    setupLazyRawPetImages(panel);
    setupLazyPetCards(panel, onLoadPet, {
        renderLoadedCard: (loadedPet) => petCardHtml(
            loadedPet,
            loadedPet?.id === currentId,
            allowSelect,
            picker,
            typeof onDelete === 'function' && !isPicker && loadedPet?.id !== currentId,
        ),
        onCardReady: (el, loadedPet) => {
            if (loadedPet?.id) petById.set(loadedPet.id, loadedPet);
            bindPetCardEvents(el);
        },
    });
}
