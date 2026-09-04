import { escapeHtml } from './utils.js';
import { rewardArtHtml } from './reward_art.js';

const STYLE_ID = 'mh-reward-outcome-style';

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .mh-reward-outcome-card{max-width:460px;padding:0;overflow:hidden;background:#f7fbff;border-color:#b9e9f7}
        .mh-reward-outcome-head{padding:20px 20px 15px;background:linear-gradient(135deg,#083344,#155e75);color:#fff}
        .mh-reward-outcome-head small{display:block;margin-top:5px;color:#cffafe;line-height:1.45}
        .mh-reward-outcome-list{display:grid;gap:10px;padding:14px;max-height:min(56dvh,480px);overflow-y:auto}
        .mh-reward-outcome-item{display:grid;grid-template-columns:64px minmax(0,1fr);gap:12px;align-items:center;padding:12px;border:1px solid #bae6fd;border-radius:8px;background:#fff;color:#164e63}
        .mh-reward-outcome-art{width:64px;height:64px;display:grid;place-items:center;border-radius:8px;background:#ecfeff;font-size:34px;overflow:hidden}
        .mh-reward-outcome-art>img{width:100%;height:100%;object-fit:contain}
        .mh-reward-outcome-pet{width:100%;height:100%;background-size:400% 400%;background-position:0 0;background-repeat:no-repeat}
        .mh-reward-outcome-copy{min-width:0}.mh-reward-outcome-copy b{display:block;color:#0f172a;font-size:15px}.mh-reward-outcome-copy span{display:block;margin-top:4px;color:#475569;font-size:12px;line-height:1.45}
        .mh-reward-outcome-badge{display:inline-block!important;width:max-content;margin:0 0 5px!important;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#92400e!important;font-weight:800;font-size:10px!important}
        .mh-reward-outcome-progress{height:7px;margin-top:8px;border-radius:4px;background:#e2e8f0;overflow:hidden}.mh-reward-outcome-progress i{display:block;height:100%;background:#0891b2}
        .mh-reward-outcome-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;padding:0 14px 14px}.mh-reward-outcome-actions button{min-height:40px}
        @media(max-width:420px){.mh-reward-outcome-card{width:calc(100% - 20px)}.mh-reward-outcome-item{grid-template-columns:54px minmax(0,1fr);padding:10px}.mh-reward-outcome-art{width:54px;height:54px}.mh-reward-outcome-actions{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
}

function treasureHtml(treasure) {
    if (!treasure) return '';
    return `<article class="mh-reward-outcome-item" data-reward-kind="home_treasure">
        <div class="mh-reward-outcome-art" aria-hidden="true">${rewardArtHtml(treasure.image, escapeHtml(treasure.icon || '🏡'))}</div>
        <div class="mh-reward-outcome-copy"><span class="mh-reward-outcome-badge">${treasure.firstOwned ? '首件家园珍宝' : '家园珍宝已融合'}</span><b>${escapeHtml(treasure.name)}</b><span>${escapeHtml(treasure.firstOwned ? `摆放后每天产出 ${treasure.rewardText}` : '重复珍宝已自动提升设施产出')}</span></div>
    </article>`;
}

function petHtml(pet) {
    const image = pet.imageSheetUrl
        ? `<div class="mh-reward-outcome-pet" style="background-image:url('${escapeHtml(pet.imageSheetUrl)}')"></div>`
        : pet.imageUrl
            ? `<img src="${escapeHtml(pet.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:contain">`
            : '⭐';
    return `<article class="mh-reward-outcome-item" data-reward-kind="rare_pet">
        <div class="mh-reward-outcome-art" aria-hidden="true">${image}</div>
        <div class="mh-reward-outcome-copy"><span class="mh-reward-outcome-badge">稀有伙伴 · ${escapeHtml(pet.qualityId)}</span><b>${escapeHtml(pet.name)}</b><span>已加入伙伴列表，可立即查看能力、装备与培养方向。</span></div>
    </article>`;
}

function seriesHtml(series) {
    const percent = series.totalCount ? Math.round(series.currentCount / series.totalCount * 100) : 0;
    const names = series.newItems.map(item => `${item.icon} ${item.name}`).join('、');
    return `<article class="mh-reward-outcome-item" data-reward-kind="collectible_series">
        <div class="mh-reward-outcome-art" aria-hidden="true">${escapeHtml(series.icon)}</div>
        <div class="mh-reward-outcome-copy">${series.newlyCompleted ? '<span class="mh-reward-outcome-badge">系列首次完成</span>' : ''}<b>${escapeHtml(series.name)}系列 ${series.currentCount} / ${series.totalCount}</b><span>${escapeHtml(names ? `新发现：${names}` : '发现了已有藏品，收藏数量增加')}</span><div class="mh-reward-outcome-progress" aria-label="系列进度"><i style="width:${percent}%"></i></div></div>
    </article>`;
}

export function showRewardOutcomeModal({ treasure = null, rarePets = [], series = [] } = {}, actions = {}) {
    const visibleSeries = series.filter(item => item.newItems.length || item.newlyCompleted);
    if (!treasure && !rarePets.length && !visibleSeries.length) return null;
    ensureStyles();
    document.querySelector('.mh-reward-outcome-mask')?.remove();
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-reward-outcome-mask';
    mask.innerHTML = `<div class="modal-card mh-reward-outcome-card" role="dialog" aria-modal="true" aria-labelledby="mhRewardOutcomeTitle">
        <header class="mh-reward-outcome-head"><strong id="mhRewardOutcomeTitle">远征成果已归档</strong><small>这些成果会继续影响伙伴培养、家园经营与收藏进度。</small></header>
        <div class="mh-reward-outcome-list">${treasureHtml(treasure)}${rarePets.map(petHtml).join('')}${visibleSeries.map(seriesHtml).join('')}</div>
        <div class="mh-reward-outcome-actions">${treasure ? '<button class="btn-primary" type="button" data-reward-action="treasure">查看并摆放</button>' : ''}${rarePets.length ? '<button class="btn-primary" type="button" data-reward-action="pets">查看伙伴</button>' : ''}${visibleSeries.length ? '<button class="btn-primary" type="button" data-reward-action="collection">查看收藏</button>' : ''}<button class="btn-secondary" type="button" data-reward-action="share">生成分享卡</button><button class="btn-secondary" type="button" data-reward-action="close">稍后处理</button></div>
    </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (event) => {
        const action = event.target.closest?.('[data-reward-action]')?.dataset.rewardAction;
        if (!action && event.target !== mask) return;
        close();
        if (action && action !== 'close') actions[action]?.();
    });
    document.body.appendChild(mask);
    mask.querySelector('[data-reward-action]')?.focus();
    return mask;
}