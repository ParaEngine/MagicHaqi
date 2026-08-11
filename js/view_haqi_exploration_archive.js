import { escapeHtml } from './utils.js';
import { getHaqiWeeklyProgress } from './haqi_weekly_progress.mjs';

const STYLE_ID = 'mh-haqi-exploration-archive-style';

function nonNegative(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .haqi-archive{--cyan:#64e6ff;--gold:#ffd56b;height:100%;min-height:0;overflow-y:auto;padding:22px;background:linear-gradient(rgba(0,0,0,.1),rgba(0,0,0,.1)),url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/archive-backgrounds/haqi-exploration-archive.webp') center / cover fixed,#07101b;color:#e8f7ff;font-family:"Microsoft YaHei",sans-serif;overscroll-behavior-y:contain}.haqi-archive::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.3;background-image:linear-gradient(rgba(121,221,255,.09) 1px,transparent 1px),linear-gradient(90deg,rgba(121,221,255,.09) 1px,transparent 1px);background-size:42px 42px}.haqi-archive__top,.haqi-archive__body{position:relative;z-index:1;max-width:980px;margin:0 auto}.haqi-archive__top{display:flex;align-items:center;gap:12px;margin-bottom:16px}.haqi-archive__back{display:grid;place-items:center;width:38px;aspect-ratio:1;padding:0;border:1px solid rgba(157,232,255,.35);border-radius:7px;background:rgba(15,27,43,.62);box-shadow:inset 0 1px rgba(255,255,255,.09),0 0 16px rgba(76,207,255,.13);color:var(--cyan);font-size:26px;line-height:1;cursor:pointer}.haqi-archive__title{color:#f3fbff;font-size:20px;font-weight:900;letter-spacing:1px;text-shadow:0 0 14px rgba(100,230,255,.55)}.haqi-archive__sub{margin-top:3px;color:#91b6c7;font-size:12px;letter-spacing:.5px}
        .haqi-archive__hero,.haqi-archive__section{border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(15,20,30,.7);box-shadow:inset 0 1px rgba(255,255,255,.09),0 16px 36px rgba(0,0,0,.24);backdrop-filter:blur(12px)}.haqi-archive__hero{padding:20px;overflow:hidden}.haqi-archive__hero h1,.haqi-archive__section h2{margin:0;color:#f1fbff;font-size:18px;letter-spacing:1px;text-shadow:0 0 12px rgba(100,230,255,.45)}.haqi-archive__hero p,.haqi-archive__section p{margin:6px 0 0;color:#abc7d5;font-size:12px;line-height:1.65}.haqi-archive__stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:17px}.haqi-archive__stat{display:grid;grid-template-columns:58px minmax(0,1fr);align-items:center;gap:11px;min-height:96px;padding:12px;border:1px solid rgba(117,231,255,.25);border-radius:7px;background:linear-gradient(130deg,rgba(37,97,128,.34),rgba(11,21,38,.55));box-shadow:inset 0 1px rgba(255,255,255,.1),0 0 18px rgba(77,205,255,.08)}.haqi-archive__stat-icon,.haqi-archive__thumb,.haqi-archive__exhibit,.haqi-archive__status-icon{display:grid;place-items:center;aspect-ratio:1;border:1px solid rgba(157,232,255,.35);border-radius:6px;background:linear-gradient(145deg,rgba(100,230,255,.22),rgba(19,48,77,.4));box-shadow:inset 0 0 16px rgba(100,230,255,.13),0 0 13px rgba(100,230,255,.12);color:var(--cyan);font-weight:900}.haqi-archive__stat-icon{width:58px;font-size:22px}.haqi-archive__stat b{display:block;color:var(--cyan);font-size:30px;font-variant-numeric:tabular-nums;line-height:1;text-shadow:0 0 13px rgba(100,230,255,.78)}.haqi-archive__stat span{display:block;margin-top:6px;color:#bad2dd;font-size:11px;font-weight:700}
        .haqi-archive__art{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}.haqi-archive__stat-icon{overflow:hidden}
        .haqi-archive__section{padding:16px}.haqi-archive__guide{margin-top:12px;background:linear-gradient(110deg,rgba(16,75,103,.62),rgba(15,20,30,.74))}.haqi-archive__guide strong{color:var(--gold);text-shadow:0 0 10px rgba(255,213,107,.38)}.haqi-archive__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.haqi-archive__list{display:grid;gap:9px;margin:12px 0 0}.haqi-archive__row{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:rgba(5,14,26,.48);font-size:12px}.haqi-archive__row strong{color:#e6f8ff}.haqi-archive__row span{color:#9dbdcb;text-align:right}.haqi-archive__route{position:relative;overflow:hidden;padding-bottom:18px}.haqi-archive__thumb{width:42px;flex:0 0 42px;font-size:15px}.haqi-archive__route-body{min-width:0;flex:1}.haqi-archive__route-state{color:var(--gold)!important;font-weight:900}.haqi-archive__progress{position:absolute;right:10px;bottom:7px;left:10px;height:4px;overflow:hidden;border-radius:99px;background:rgba(1,8,18,.85)}.haqi-archive__progress i{display:block;width:var(--progress);height:100%;border-radius:inherit;background:linear-gradient(90deg,#36cef7,#76f1df 55%,#ffe27a);box-shadow:0 0 10px rgba(100,230,255,.8)}.haqi-archive__showcase{display:flex;align-items:center;gap:12px;margin-top:12px;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:rgba(4,13,24,.42)}.haqi-archive__exhibit{width:72px;flex:0 0 72px;font-size:26px;color:var(--gold);border-color:rgba(255,213,107,.35);box-shadow:inset 0 0 18px rgba(255,213,107,.13),0 0 14px rgba(255,213,107,.1)}.haqi-archive__showcase-copy{min-width:0;flex:1}.haqi-archive__showcase-copy b,.haqi-archive__showcase-copy span{display:block}.haqi-archive__showcase-copy b{color:#edfbff}.haqi-archive__showcase-copy span{margin-top:5px;color:#a7c3cf;font-size:12px;line-height:1.45}.haqi-archive__history{grid-column:1/-1}.haqi-archive__history-row{background:linear-gradient(105deg,rgba(18,80,66,.44),rgba(7,23,31,.62))}.haqi-archive__history-row.is-failed{background:linear-gradient(105deg,rgba(107,33,48,.46),rgba(31,11,20,.62))}.haqi-archive__status-icon{width:38px;flex:0 0 38px;color:#7ff2bc;border-color:rgba(127,242,188,.38)}.is-failed .haqi-archive__status-icon{color:#ff8e9f;border-color:rgba(255,142,159,.4);background:linear-gradient(145deg,rgba(255,88,109,.2),rgba(81,20,34,.42));box-shadow:inset 0 0 16px rgba(255,88,109,.12),0 0 12px rgba(255,88,109,.1)}.haqi-archive__actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.haqi-archive__action{min-height:44px;border:0;border-radius:6px;background:linear-gradient(120deg,#20bde8,#5877ec 60%,#9b64db);box-shadow:0 8px 18px rgba(43,149,243,.25);color:#fff;font:inherit;font-size:13px;font-weight:900;letter-spacing:.5px;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}.haqi-archive__action:hover{box-shadow:0 10px 26px rgba(77,205,255,.43);transform:translateY(-2px)}.haqi-archive__empty{padding:12px;border:1px dashed rgba(157,232,255,.3);border-radius:6px;background:rgba(4,13,24,.32);color:#9dbdcb;font-size:12px;line-height:1.55}
        @media(max-width:640px){.haqi-archive{padding:14px}.haqi-archive__stats,.haqi-archive__grid,.haqi-archive__actions{grid-template-columns:1fr}.haqi-archive__stat{min-height:82px}.haqi-archive__hero,.haqi-archive__section{padding:14px}}
    `;
    document.head.appendChild(style);
}

function formatHistory(entry) {
    const completed = entry?.completed === true;
    const contribution = entry?.mineralContribution || {};
    const materialText = completed
        ? `材料 ${nonNegative(entry?.lootCount)}${nonNegative(contribution.bonusLootCount) ? `，博物馆额外 ${nonNegative(contribution.bonusLootCount)}` : ''}`
        : '未带回战利品';
    return {
        completed,
        title: `${completed ? '完成' : '失败'} · ${entry?.expeditionName || entry?.expeditionId || '未知星图'}`,
        detail: `${entry?.petName || '出战伙伴'} · ${materialText}`,
    };
}

export function renderHaqiExplorationArchive(panel, data = {}, { onBack, onOpenExpedition, onOpenMineral } = {}) {
    ensureStyles();
    const bridge = data.bridge || {};
    const bonuses = bridge.bonuses || {};
    const history = Array.isArray(data.history) ? data.history.slice(0, 5) : [];
    const weeklyProgress = getHaqiWeeklyProgress({ history: data.history, bridge });
    const weekStart = new Date(weeklyProgress.weekStart).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    const treasures = Array.isArray(data.treasures) ? data.treasures.filter(item => item?.count > 0) : [];
    const completedCount = history.filter(item => item?.completed === true).length;
    const museumBonus = `攻击 +${nonNegative(bonuses.attackPercent)}% · 掉落 +${nonNegative(bonuses.expeditionLootPercent)}%`;
    const hasExpeditionRecord = completedCount > 0;
    const hasMuseumProgress = nonNegative(data.activeSeriesCount) > 0 || nonNegative(bridge.research) > 0;
    const hasMuseumBuff = nonNegative(bonuses.attackPercent) > 0 || nonNegative(bonuses.expeditionLootPercent) > 0;
    const guide = hasMuseumBuff
        ? { title: '第三步：带着博物馆 Buff 回到星图', detail: `当前 ${museumBonus}，下一次发射前会显示实际攻击。`, action: '前往星球探险', target: 'expedition' }
        : hasMuseumProgress
            ? { title: '第三步：完成博物馆系列', detail: '继续收集缺失矿石，激活系列后将获得远征 Buff。', action: '前往星际矿区', target: 'mineral' }
            : hasExpeditionRecord
                ? { title: '第二步：把远征材料带入矿区', detail: '通过勘探、鉴定和奇遇积累研究线索，再完成博物馆系列。', action: '前往星际矿区', target: 'mineral' }
                : { title: '第一步：完成首次星球探险', detail: '成功结算后，远征记录和材料会成为矿区探索的起点。', action: '前往星球探险', target: 'expedition' };

    panel.innerHTML = `
        <main class="haqi-archive">
            <header class="haqi-archive__top">
                <button class="haqi-archive__back" id="mhHaqiArchiveBack" type="button" aria-label="返回">‹</button>
                <div><div class="haqi-archive__title">哈奇探索档案</div><div class="haqi-archive__sub">远征、矿区与家园珍宝的只读汇总</div></div>
            </header>
            <div class="haqi-archive__body">
                <section class="haqi-archive__hero">
                    <h1>探索进度总览</h1>
                    <p>远征资产与矿区进度仍由各自系统保存；此处只提供回顾与跳转，不修改奖励、概率或结算。</p>
                    <div class="haqi-archive__stats">
                        <div class="haqi-archive__stat"><div class="haqi-archive__stat-icon"><img class="haqi-archive__art" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/archive-icons/expedition.webp" alt=""></div><div><b>${completedCount}</b><span>已完成远征</span></div></div>
                        <div class="haqi-archive__stat"><div class="haqi-archive__stat-icon"><img class="haqi-archive__art" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/archive-icons/research.webp" alt=""></div><div><b>${nonNegative(bridge.research)}</b><span>矿区研究线索</span></div></div>
                        <div class="haqi-archive__stat"><div class="haqi-archive__stat-icon"><img class="haqi-archive__art" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/archive-icons/route-chip.webp" alt=""></div><div><b>${nonNegative(bridge.preparationCharges)}/3</b><span>路线侦测芯片</span></div></div>
                    </div>
                </section>
                <section class="haqi-archive__section haqi-archive__guide">
                    <h2>探索引导</h2>
                    <p><strong>${escapeHtml(guide.title)}</strong><br>${escapeHtml(guide.detail)}</p>
                    <div class="haqi-archive__actions"><button class="haqi-archive__action" id="mhHaqiArchiveGuide" type="button">${escapeHtml(guide.action)}</button></div>
                </section>
                <section class="haqi-archive__section" style="margin-top:12px">
                    <h2>本周航线</h2>
                    <p>${escapeHtml(`${weekStart} 起 · 已完成 ${weeklyProgress.completed}/${weeklyProgress.total} 项。`)} 此处只汇总既有进度，不额外发放或扣除资产。</p>
                    <div class="haqi-archive__list">${weeklyProgress.goals.map((goal, index) => `<div class="haqi-archive__row haqi-archive__route"><div class="haqi-archive__thumb" aria-hidden="true">0${index + 1}</div><div class="haqi-archive__route-body"><strong>${escapeHtml(goal.label)}${goal.hint ? `<small style="display:block;margin-top:3px;color:#9dbdcb;font-weight:700">${escapeHtml(goal.hint)}</small>` : ''}</strong></div><span class="haqi-archive__route-state">${goal.complete ? '已完成' : `${goal.current}/${goal.target}`}</span><div class="haqi-archive__progress" style="--progress:${Math.min(100, (nonNegative(goal.current) / Math.max(1, nonNegative(goal.target))) * 100)}%"><i></i></div></div>`).join('')}</div>
                </section>
                <div class="haqi-archive__grid">
                    <section class="haqi-archive__section">
                        <h2>星际博物馆</h2>
                        <p>${escapeHtml(museumBonus)} · 已激活系列 ${nonNegative(data.activeSeriesCount)} 项。</p>
                        <div class="haqi-archive__showcase"><div class="haqi-archive__exhibit"><img class="haqi-archive__art" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/archive-icons/museum.webp" alt=""></div><div class="haqi-archive__showcase-copy"><b>系列展品陈列位</b><span>远征收益 ${escapeHtml(museumBonus)}<br>研究进度 ${nonNegative(bridge.research)} 条线索</span></div></div>
                    </section>
                    <section class="haqi-archive__section">
                        <h2>家园珍宝</h2>
                        ${treasures.length ? `<div class="haqi-archive__list">${treasures.map(item => `<div class="haqi-archive__showcase"><div class="haqi-archive__exhibit"><img class="haqi-archive__art" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/archive-icons/treasure.webp" alt=""></div><div class="haqi-archive__showcase-copy"><b>${escapeHtml(item.name)}</b><span>持有 ${nonNegative(item.count)} · ${escapeHtml(item.rewardText)}</span></div></div>`).join('')}</div>` : '<div class="haqi-archive__empty">尚未带回家园珍宝。首领远征成功后才可能写入正式结算。</div>'}
                    </section>
                    <section class="haqi-archive__section haqi-archive__history">
                        <h2>最近远征</h2>
                        ${history.length ? `<div class="haqi-archive__list">${history.map(entry => { const item = formatHistory(entry); return `<div class="haqi-archive__row haqi-archive__history-row${item.completed ? '' : ' is-failed'}"><div class="haqi-archive__status-icon" aria-hidden="true">${item.completed ? 'OK' : '!!'}</div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>`; }).join('')}</div>` : '<div class="haqi-archive__empty">尚无远征记录。完成一次星球探险后，最终宿主结算会在这里留下摘要。</div>'}
                    </section>
                </div>
                <div class="haqi-archive__actions"><button class="haqi-archive__action" id="mhHaqiArchiveExpedition" type="button">前往星球探险</button><button class="haqi-archive__action" id="mhHaqiArchiveMineral" type="button">前往星际矿区</button></div>
            </div>
        </main>`;
    panel.querySelector('#mhHaqiArchiveBack').onclick = () => onBack?.();
    panel.querySelector('#mhHaqiArchiveGuide').onclick = () => {
        if (guide.target === 'mineral') onOpenMineral?.();
        else onOpenExpedition?.();
    };
    panel.querySelector('#mhHaqiArchiveExpedition').onclick = () => onOpenExpedition?.();
    panel.querySelector('#mhHaqiArchiveMineral').onclick = () => onOpenMineral?.();
}
