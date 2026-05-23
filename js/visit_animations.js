import { escapeHtml } from './utils.js';
import { displayPetName } from './dna.js';
import { petArtHtml, preloadPetAssets, scanAndMount } from './pet.js';

let stylesInjected = false;

function injectVisitAnimationStyles() {
    if (stylesInjected || document.getElementById('mhVisitAnimationStyles')) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'mhVisitAnimationStyles';
    style.textContent = `
        .visit-animation-mask {
            position: fixed;
            inset: 0;
            z-index: 1200;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 18px;
            background: rgba(3, 7, 28, 0.72);
            backdrop-filter: blur(8px);
        }
        .visit-animation-card {
            position: relative;
            width: min(760px, 96vw);
            height: min(520px, 74vh);
            min-height: 360px;
            overflow: hidden;
            border: 2px solid rgba(125, 231, 255, 0.58);
            border-radius: 22px;
            background:
                radial-gradient(circle at 18% 22%, rgba(103, 232, 249, 0.3), transparent 26%),
                radial-gradient(circle at 82% 16%, rgba(250, 204, 21, 0.2), transparent 22%),
                radial-gradient(circle at 54% 72%, rgba(139, 92, 246, 0.24), transparent 32%),
                linear-gradient(180deg, #07163d 0%, #11195a 52%, #050817 100%);
            box-shadow: 0 26px 60px rgba(0, 0, 0, 0.42), inset 0 0 0 1px rgba(255,255,255,0.1);
            color: #e0fbff;
            isolation: isolate;
        }
        .visit-animation-card::before {
            content: '';
            position: absolute;
            inset: 0;
            background-image:
                radial-gradient(circle, rgba(255,255,255,0.88) 0 1px, transparent 1.4px),
                linear-gradient(rgba(255,255,255,0.045) 50%, rgba(6,18,44,0.05) 50%);
            background-size: 48px 48px, 100% 4px;
            opacity: 0.5;
            pointer-events: none;
        }
        .visit-animation-card::after {
            content: '';
            position: absolute;
            inset: -18%;
            background:
                radial-gradient(circle, rgba(255,255,255,0.9) 0 1px, transparent 1.6px),
                radial-gradient(circle, rgba(125,211,252,0.9) 0 1px, transparent 1.5px);
            background-size: 78px 78px, 112px 112px;
            opacity: 0.28;
            transform: rotate(-8deg);
            animation: visitStarDrift 8.6s linear infinite;
            pointer-events: none;
        }
        .visit-animation-title {
            position: absolute;
            left: 20px;
            right: 20px;
            top: 18px;
            z-index: 4;
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: flex-start;
            font-weight: 900;
            text-shadow: 0 2px 10px rgba(0,0,0,0.34);
        }
        .visit-animation-title b { display: block; font-size: clamp(18px, 3vw, 26px); color: #fff7cc; }
        .visit-animation-title i { display: block; margin-top: 4px; font-style: normal; font-size: 13px; color: #a5f3fc; }
        .visit-skip-btn {
            flex: 0 0 auto;
            border: 1px solid rgba(255,255,255,0.38);
            border-radius: 999px;
            padding: 6px 12px;
            background: rgba(15, 23, 42, 0.52);
            color: #e0fbff;
            font-weight: 800;
            cursor: pointer;
        }
        .visit-ground {
            position: absolute;
            left: 7%;
            right: 7%;
            bottom: 16%;
            height: 19%;
            border-radius: 50% 50% 0 0;
            background: linear-gradient(180deg, rgba(132, 204, 22, 0.78), rgba(21, 128, 61, 0.72));
            box-shadow: inset 0 18px 24px rgba(255,255,255,0.18), 0 -8px 18px rgba(103,232,249,0.14);
        }
        .visit-planet {
            position: absolute;
            right: 9%;
            top: 24%;
            width: 112px;
            height: 112px;
            border-radius: 50%;
            background: radial-gradient(circle at 32% 26%, #ffffff, #7dd3fc 24%, #2563eb 58%, #111827 100%);
            box-shadow: inset -16px -20px 30px rgba(0,0,0,0.35), 0 0 28px rgba(125,211,252,0.52);
        }
        .visit-planet::before {
            content: '';
            position: absolute;
            left: 16%;
            top: 36%;
            width: 58%;
            height: 24%;
            border-radius: 50%;
            background: rgba(132, 204, 22, 0.72);
            transform: rotate(-18deg);
        }
        .visit-planet::after {
            content: '';
            position: absolute;
            inset: -18%;
            border: 8px solid rgba(224, 247, 255, 0.32);
            border-left-color: transparent;
            border-right-color: transparent;
            border-radius: 50%;
            transform: rotate(-18deg) scaleY(0.34);
        }
        .visit-orbit-path {
            position: absolute;
            left: 9%;
            right: 9%;
            bottom: 27%;
            z-index: 2;
            height: 32%;
            border-top: 2px dashed rgba(165, 243, 252, 0.3);
            border-radius: 50%;
            transform: rotate(-7deg);
            opacity: 0.84;
        }
        .visit-ship {
            position: absolute;
            left: 50%;
            bottom: 24%;
            z-index: 3;
            width: clamp(116px, 20vw, 176px);
            aspect-ratio: 1.8;
            transform: translateX(-50%);
            filter: drop-shadow(0 12px 18px rgba(0,0,0,0.35));
        }
        .visit-ship::before {
            content: '';
            position: absolute;
            left: -38%;
            top: 54%;
            width: 58%;
            height: 10px;
            border-radius: 999px;
            background: linear-gradient(90deg, transparent, rgba(165,243,252,0.78));
            opacity: 0;
            filter: blur(1px);
            animation: visitShipTrail 0.72s ease-in-out infinite alternate;
        }
        .visit-ship svg { width: 100%; height: 100%; overflow: visible; }
        .visit-ship-flame { opacity: 0; transform-origin: 50% 100%; animation: visitFlame 0.22s ease-in-out infinite alternate; }
        .visit-pet-lineup {
            position: absolute;
            left: 7%;
            right: 7%;
            bottom: 23%;
            z-index: 4;
            display: flex;
            justify-content: flex-start;
            gap: clamp(8px, 2vw, 18px);
            pointer-events: none;
        }
        .visit-pet {
            width: clamp(58px, 11vw, 92px);
            height: clamp(58px, 11vw, 92px);
            animation: visitPetBoard 4.4s ease-in-out forwards;
            animation-delay: var(--visit-delay, 0s);
        }
        .visit-pet > div { width: 100%; height: 100%; }
        .visit-arrival .visit-pet { animation-name: visitPetExit; opacity: 0; transform: translate(265%, -24%) scale(0.22); }
        .visit-departure .visit-ship { animation: visitShipTakeoff 5.2s 3.35s cubic-bezier(.16,.8,.2,1) forwards; }
        .visit-arrival .visit-ship { animation: visitShipLand 4.7s cubic-bezier(.16,.8,.2,1) forwards; }
        .visit-return .visit-ship { animation: visitShipReturn 5.1s cubic-bezier(.16,.8,.2,1) forwards; }
        .visit-return .visit-gift {
            position: absolute;
            left: 50%;
            top: 43%;
            z-index: 5;
            width: 82px;
            height: 82px;
            display: grid;
            place-items: center;
            border-radius: 18px;
            background: linear-gradient(135deg, #fef3c7, #f9a8d4 48%, #93c5fd);
            box-shadow: 0 0 24px rgba(250, 204, 21, 0.66), inset 0 0 0 4px rgba(255,255,255,0.42);
            font-size: 40px;
            transform: translate(-50%, -50%) scale(0.2);
            opacity: 0;
            animation: visitGiftPop 1.45s 1.95s cubic-bezier(.2,1.4,.4,1) forwards;
        }
        .visit-progress-steps {
            position: absolute;
            left: 22px;
            bottom: 48px;
            z-index: 4;
            display: flex;
            gap: 8px;
        }
        .visit-progress-steps i {
            width: 26px;
            height: 6px;
            border-radius: 999px;
            background: rgba(165, 243, 252, 0.24);
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16);
            overflow: hidden;
        }
        .visit-progress-steps i::before {
            content: '';
            display: block;
            width: 100%;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #facc15, #67e8f9);
            transform: translateX(-105%);
            animation: visitStepFill 1.35s ease-out forwards;
            animation-delay: var(--visit-step-delay, 0s);
        }
        .visit-caption {
            position: absolute;
            left: 20px;
            right: 20px;
            bottom: 18px;
            z-index: 4;
            text-align: center;
            font-weight: 900;
            color: #fff7cc;
            text-shadow: 0 2px 10px rgba(0,0,0,0.4);
        }
        @keyframes visitPetBoard {
            0% { opacity: 0; transform: translateX(-80px) translateY(8px) scale(0.92); }
            16% { opacity: 1; transform: translateX(0) translateY(0) scale(1); }
            38% { opacity: 1; transform: translateX(64%) translateY(-4%) scale(1.02); }
            78% { opacity: 1; transform: translateX(265%) translateY(-18%) scale(0.72); }
            100% { opacity: 0; transform: translateX(335%) translateY(-26%) scale(0.25); }
        }
        @keyframes visitPetExit {
            0% { opacity: 0; transform: translate(265%, -24%) scale(0.22); }
            34% { opacity: 1; transform: translate(240%, -14%) scale(0.58); }
            68% { opacity: 1; transform: translate(96%, -4%) scale(0.88); }
            100% { opacity: 1; transform: translate(20%, 4%) scale(1); }
        }
        @keyframes visitShipTakeoff {
            0% { transform: translateX(-50%) translateY(0) scale(1); }
            18% { transform: translateX(-50%) translateY(-20px) scale(1.04); }
            100% { transform: translateX(-22%) translateY(-125vh) scale(0.46) rotate(9deg); }
        }
        @keyframes visitShipLand {
            0% { transform: translateX(44%) translateY(-105vh) scale(0.42) rotate(-10deg); }
            66% { transform: translateX(-50%) translateY(-22px) scale(1.04) rotate(0deg); }
            100% { transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes visitShipReturn {
            0% { transform: translateX(-36%) translateY(-96vh) scale(0.48) rotate(8deg); }
            62% { transform: translateX(-50%) translateY(-18px) scale(1.04) rotate(0deg); }
            100% { transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes visitFlame { to { opacity: 1; transform: scaleY(1.22); } }
        @keyframes visitShipTrail { to { opacity: 0.78; transform: translateX(-8px) scaleX(1.18); } }
        @keyframes visitStarDrift { to { transform: rotate(-8deg) translate3d(-78px, 58px, 0); } }
        @keyframes visitStepFill { to { transform: translateX(0); } }
        @keyframes visitGiftPop {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.2) rotate(-12deg); }
            58% { opacity: 1; transform: translate(-50%, -50%) scale(1.16) rotate(7deg); }
            100% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
        }
    `;
    document.head.appendChild(style);
}

function spacecraftSvg() {
    return `
        <svg viewBox="0 0 180 96" aria-hidden="true" focusable="false">
            <path class="visit-ship-flame" d="M82 78c4 21 13 21 17 0" fill="#facc15" stroke="#f97316" stroke-width="4"/>
            <path d="M26 66c31-29 77-42 132-40-10 24-36 44-81 58-18-3-35-8-51-18z" fill="#e0f7ff" stroke="#38bdf8" stroke-width="5" stroke-linejoin="round"/>
            <path d="M44 63 14 81l50 1zM108 49l35 31-56 3z" fill="#fb923c" stroke="#9a3412" stroke-width="5" stroke-linejoin="round"/>
            <circle cx="95" cy="43" r="15" fill="#1d4ed8" stroke="#93c5fd" stroke-width="5"/>
            <path d="M121 32c13 2 24 4 37 8" stroke="#fff7ad" stroke-width="5" stroke-linecap="round"/>
        </svg>`;
}

function petLineupHtml(pets = []) {
    return pets.slice(0, 3).map((pet, index) => `
        <div class="visit-pet" style="--visit-delay:${(index * 0.28).toFixed(2)}s" title="${escapeHtml(displayPetName(pet))}">
            <div>${petArtHtml(pet, { alt: displayPetName(pet), motion: 'walk' })}</div>
        </div>
    `).join('');
}

function playVisitAnimation({ kind, title, subtitle, caption, pets = [], gift = '' } = {}) {
    injectVisitAnimationStyles();
    return (async () => {
        await preloadPetAssets(pets, { includeAll: true });
        return new Promise((resolve) => {
            const mask = document.createElement('div');
            mask.className = 'visit-animation-mask';
            mask.innerHTML = `
            <div class="visit-animation-card visit-${escapeHtml(kind || 'departure')}">
                <div class="visit-animation-title">
                    <span><b>${escapeHtml(title || '星际拜访')}</b><i>${escapeHtml(subtitle || '')}</i></span>
                    <button class="visit-skip-btn" type="button" data-skip-visit-animation>跳过</button>
                </div>
                <div class="visit-planet" aria-hidden="true"></div>
                <div class="visit-ground" aria-hidden="true"></div>
                <div class="visit-orbit-path" aria-hidden="true"></div>
                <div class="visit-ship" aria-hidden="true">${spacecraftSvg()}</div>
                <div class="visit-pet-lineup">${petLineupHtml(pets)}</div>
                ${kind === 'return' ? `<div class="visit-gift" aria-hidden="true">${escapeHtml(gift || '🎁')}</div>` : ''}
                <div class="visit-progress-steps" aria-hidden="true"><i style="--visit-step-delay:0.25s"></i><i style="--visit-step-delay:1.9s"></i><i style="--visit-step-delay:3.55s"></i></div>
                <div class="visit-caption">${escapeHtml(caption || '')}</div>
            </div>`;
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                mask.remove();
                resolve();
            };
            mask.querySelector('[data-skip-visit-animation]')?.addEventListener('click', finish);
            document.body.appendChild(mask);
            scanAndMount(mask);
            setTimeout(finish, kind === 'departure' ? 9000 : 6800);
        });
    })();
}

export function playVisitDeparture({ crew = [], destinationName = '好友星球' } = {}) {
    return playVisitAnimation({
        kind: 'departure',
        title: '飞船出发',
        subtitle: `目的地：${destinationName}`,
        caption: '宠物们登船，飞船正在从星球表面升空。',
        pets: crew,
    });
}

export function playVisitArrival({ crew = [], destinationName = '好友星球' } = {}) {
    return playVisitAnimation({
        kind: 'arrival',
        title: '抵达好友星球',
        subtitle: destinationName,
        caption: '飞船降落，宠物进入好友的星球表面。',
        pets: crew,
    });
}

export function playVisitReturn({ crew = [], destinationName = '自己的星球', giftIcon = '🎁' } = {}) {
    return playVisitAnimation({
        kind: 'return',
        title: '礼盒与返航',
        subtitle: `返回：${destinationName}`,
        caption: '好友的宠物送出随机礼盒，大家登船返航。',
        pets: crew,
        gift: giftIcon,
    });
}
