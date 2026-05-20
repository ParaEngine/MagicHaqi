// 宠物列表视图（用于浏览所有宠物）
import { $, $$, coinIconSvg, escapeHtml } from './utils.js';
import { t } from './i18n.js';
import { formatDna, displayPetName, dnaDietPreference, dietPreferenceLabel } from './dna.js';
import { buildEggSvg, getPetSpriteCell, petArtHtml, SHEET_COLS, SHEET_ROWS } from './pet.js';
import { getCompanionDays, getPetBirthday, getPetFindTarget, getPetLocationInfo, getRuntimePetStats, isPetOnCurrentPlanet, isPetSelectable } from './petLifecycle.js';
import { getStageName } from './config.js';

// 阶段顺序（与 4×4 精灵图行对齐）：baby=0, teen=1, adult=2, elder=3
const ALBUM_STAGES = [
    { id: 'baby',  name: '幼年', emoji: '🐣' },
    { id: 'teen',  name: '青年', emoji: '🐥' },
    { id: 'adult', name: '成年', emoji: '🐉' },
    { id: 'elder', name: '长老', emoji: '🦄' },
];
const ALBUM_ANIMS = ['idle', 'happy', 'sad', 'sleep'];
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
        .mh-album-mask .modal-card { max-width: 460px; max-height:calc(100vh - 32px); padding:18px; overflow:hidden; display:flex; flex-direction:column; }
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

function rawPetArtHtml(pet, alt = '') {
    const url = pet?.imageSheetUrl || pet?.imageUrl || '';
    const cell = pet?.imageSheetUrl ? getPetSpriteCell(pet) : null;
    const safeAlt = escapeHtml(alt);

    if (pet?.imageUrl && !pet?.imageSheetUrl) {
        return `<div class="mh-pet-art mh-pet-list-raw" data-mh-raw-url="${escapeHtml(url)}" aria-label="${safeAlt}"
            style="width:100%;height:100%;display:block;background:#000;background-size:contain;background-position:center;background-repeat:no-repeat;image-rendering:auto"></div>`;
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
        style="width:100%;height:100%;display:block;background:#000;background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:auto"></div>`;
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

function petCardHtml(pet, isCurrent, allowSelect = false) {
    const lazy = !!pet.lazyPetRecord;
    const stats = lazy ? { hunger: 100, mood: 100 } : getRuntimePetStats(pet);
    const staminaBar = Math.round(stats.hunger || 0);
    const moodBar = Math.round(stats.mood || 0);
    const sheetReady = !!pet.imageSheetUrl;
    const planetName = window.MH_state?.planetName || '宠物星';
    const location = getPetLocationInfo(pet, planetName);
    const selectable = !lazy && isPetSelectable(pet);
    const onCurrentPlanet = isPetOnCurrentPlanet(pet);
    const canSelect = allowSelect && selectable;
    const findTarget = getPetFindTarget(pet);
    const name = lazy ? `宠物 ${String(pet.id || '').slice(0, 6)}` : displayPetName(pet);
    const hint = pet.stage === 'egg'
        ? (sheetReady ? '即将破壳…' : '正在孕育中…')
        : '';
        return `
                <div class="card-flat fade-in ${canSelect ? 'cursor-pointer' : ''} ${isCurrent ? 'mh-pet-card-current' : ''}"
                         data-pet-id="${escapeHtml(pet.id)}"
                         ${lazy ? 'data-pet-lazy="1"' : ''}
                         data-selectable="${canSelect ? '1' : '0'}"
                         style="display:flex;gap:12px;align-items:center;${isCurrent ? 'outline:2px solid var(--accent);outline-offset:-2px' : ''};opacity:${selectable ? '1' : '.88'}">
            <div style="width:72px;height:72px;border-radius:14px;background:var(--bg-pill);overflow:hidden;flex-shrink:0">
                ${lazy ? '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:12px">加载中</div>' : onCurrentPlanet ? petArtHtml(pet, { alt: displayPetName(pet) }) : rawPetArtHtml(pet, displayPetName(pet))}
            </div>
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
                    <span class="text-base font-bold" style="color:var(--text-primary)">${escapeHtml(name)}</span>
                    ${lazy ? '<span class="stage-badge">未加载</span>' : `<span class="stage-badge">${escapeHtml(getStageName(pet.stage, pet.stage || ''))}</span>`}
                    ${isCurrent ? '<span class="stage-badge" style="background:var(--accent);color:#fff">当前</span>' : ''}
                    <span class="stage-badge" style="background:#ecfeff;color:${escapeHtml(location.tone)}">${escapeHtml(location.label)}</span>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px;display:flex;gap:8px;flex-wrap:wrap">
                    ${lazy ? '<span>进入视野后加载资料</span>' : `<span>生日 ${escapeHtml(getPetBirthday(pet))}</span><span>陪伴第 ${getCompanionDays(pet)} 天</span>`}
                </div>
                ${lazy ? '' : `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:ui-monospace,Menlo,monospace">
                    DNA: ${escapeHtml(formatDna(pet.dna || ''))}
                </div>`}
                ${hint ? `<div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">${escapeHtml(hint)}</div>` : ''}
                <div style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--text-secondary)">
                        <span>⚡</span><div class="stat-bar" style="flex:1"><div style="width:${staminaBar}%;background:#84cc16"></div></div>
                    <span>😊</span><div class="stat-bar" style="flex:1"><div style="width:${moodBar}%;background:#f59e0b"></div></div>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-self:center;flex-shrink:0">
                ${findTarget ? `<button class="btn-secondary" data-find="${escapeHtml(pet.id)}" title="寻找 ${escapeHtml(name)}" style="padding:7px 10px;font-size:12px">寻找</button>` : ''}
                ${lazy ? '' : `<button class="btn-secondary" data-album="${escapeHtml(pet.id)}" title="查看 ${escapeHtml(name)} 的回忆相册" style="padding:7px 10px;font-size:12px">相册</button>`}
            </div>
        </div>`;
}

function setupLazyPetCards(panel, onLoadPet) {
    if (typeof onLoadPet !== 'function') return;
    const targets = $$('[data-pet-lazy="1"]', panel);
    if (!targets.length) return;
    const load = (el) => {
        const id = el?.dataset?.petId;
        if (!id || el.dataset.petLazyLoading === '1') return;
        el.dataset.petLazyLoading = '1';
        onLoadPet(id);
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

export function renderPetList(panel, { pets }, { onSelect, onBack, onFind, onLoadPet, allowSelect = false } = {}) {
    const list = sortPetsByRecentBirthday(pets || []);
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
                <span class="font-extrabold" style="color:var(--text-primary)">${escapeHtml(t('myPets'))}</span>
            </div>
            <span class="font-bold mh-coin-amount" style="color:var(--accent-dark)">${coinIconSvg()} ${window.MH_state?.coins || 0}</span>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:14px">
            <div class="text-base font-bold mb-1" style="color:var(--text-primary)">宠物列表（${list.length}）</div>
            <div class="text-xs mb-3" style="color:var(--text-muted)">记录每个宠物的生日、陪伴天数和当前位置。当前版本仅支持浏览宠物列表。</div>
            ${list.length === 0
                ? `<div class="card-flat text-center" style="color:var(--text-muted);padding:30px 14px">${escapeHtml(t('noPets'))}</div>`
                : `<div style="display:flex;flex-direction:column;gap:10px" id="mhPetList">
                    ${currentPets.map(p => petCardHtml(p, true, allowSelect)).join('')}
                    ${tipsHtml}
                    ${otherPets.map(p => petCardHtml(p, false, allowSelect)).join('')}
                </div>`}
            ${list.length === 0 ? tipsHtml : ''}
        </div>`;

    if ($('mhPetListBack')) $('mhPetListBack').onclick = () => onBack?.();

    const petById = new Map((pets || []).map(p => [p?.id, p]));
    $$('#mhPetList [data-pet-id]').forEach(el => {
        el.onclick = (e) => {
            if (e.target.closest('[data-find]')) return;
            if (e.target.closest('[data-album]')) return;
            if (el.dataset.selectable !== '1') return;
            onSelect?.(el.dataset.petId);
        };
    });
    $$('#mhPetList [data-find]').forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            onFind?.(el.dataset.find);
        };
    });
    $$('#mhPetList [data-album]').forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            const pet = petById.get(el.dataset.album);
            if (pet) openMemoryAlbum(pet);
        };
    });
    setupLazyRawPetImages(panel);
    setupLazyPetCards(panel, onLoadPet);
}
