import { escapeHtml } from './utils.js';
import { t } from './i18n.js';
import { displayPetName } from './dna.js';
import { petArtHtml, playPetHappy, preloadPetAssets, scanAndMount, mountPetArt } from './pet.js';

let stylesInjected = false;

// Persistent full-screen black cover used to bridge the gap between the departure
// animation (which removes its own mask when done) and the arrival animation (which
// only appears a frame later). Without it the planet/home background flashes through
// for one frame between the two animation masks. The cover matches the iris fill color
// so the hand-off reads as a continuous zoom from take-off straight into landing.
let _visitBlackout = null;
let _visitBlackoutTimer = 0;
let _visitSkipArrivalAfterDeparture = false;

function showVisitBlackout() {
    if (!_visitBlackout) {
        _visitBlackout = document.createElement('div');
        _visitBlackout.className = 'visit-animation-blackout';
        _visitBlackout.setAttribute('aria-hidden', 'true');
    }
    if (!_visitBlackout.isConnected) document.body.appendChild(_visitBlackout);
    // Safety: never let the blackout linger if no arrival animation follows.
    clearTimeout(_visitBlackoutTimer);
    _visitBlackoutTimer = setTimeout(hideVisitBlackout, 2000);
}

function hideVisitBlackout() {
    clearTimeout(_visitBlackoutTimer);
    _visitBlackoutTimer = 0;
    _visitBlackout?.remove();
}

export function injectVisitAnimationStyles() {
    if (stylesInjected || document.getElementById('mhVisitAnimationStyles')) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'mhVisitAnimationStyles';
    style.textContent = `
        @property --iris-r {
            syntax: '<percentage>';
            inherits: false;
            initial-value: 150%;
        }
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
        .visit-animation-blackout {
            position: fixed;
            inset: 0;
            z-index: 1150;
            background: #050817;
            pointer-events: none;
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
        .visit-arrival .visit-pet-lineup { display: none; }
        /* While measuring layout positions, suppress transforms so getBoundingClientRect
           returns true (untransformed) layout boxes. Removed in the same frame to start. */
        .visit-measuring .visit-pet,
        .visit-measuring .visit-ship { animation: none !important; transform: translateX(-50%) !important; }
        .visit-measuring .visit-pet { transform: none !important; }
        .visit-departure .visit-ship { animation: visitShipTakeoff 3.05s 5.6s cubic-bezier(.32,.5,.2,1) forwards; }
        .visit-pet-name {
            margin-top: 3px;
            padding: 1px 9px;
            border-radius: 999px;
            background: rgba(8, 19, 48, 0.82);
            border: 1px solid rgba(165, 243, 252, 0.5);
            color: #fff7cc;
            font-weight: 900;
            font-size: clamp(10px, 2vw, 13px);
            white-space: nowrap;
            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
        }
        /* fill 'both' (not 'forwards') so the ship holds the START keyframe (far/tiny/high)
           during the 0.9s delay instead of flashing at its default resting spot near
           the planet for a moment before flying in from far. */
        .visit-arrival .visit-ship { animation: visitShipLand 3.4s 0.9s cubic-bezier(.16,.8,.2,1) both; }
        .visit-return .visit-ship { animation: visitShipReturn 5.1s cubic-bezier(.16,.8,.2,1) both; }
        /* Circular zoom (iris) transition between departure and arrival */
        .visit-iris {
            position: absolute;
            inset: 0;
            z-index: 7;
            pointer-events: none;
            background: radial-gradient(circle at 83% 30%, transparent 0, transparent var(--iris-r, 150%), #050817 calc(var(--iris-r, 150%) + 0.5%), #050817 100%);
        }
        .visit-departure .visit-iris {
            --iris-r: 150%;
            animation: visitIrisClose 1.25s 7.9s cubic-bezier(.6,0,.4,1) forwards;
        }
        .visit-arrival .visit-iris {
            --iris-r: 0%;
            animation: visitIrisOpen 1.15s 0.05s cubic-bezier(.5,0,.3,1) forwards;
        }
        .visit-iris::after {
            content: '';
            position: absolute;
            left: 83%;
            top: 30%;
            width: 0;
            height: 0;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            box-shadow: 0 0 0 2px rgba(165,243,252,0.0);
            opacity: 0;
        }
        .visit-departure .visit-iris::after { animation: visitIrisRing 1.25s 7.9s ease-out forwards; }
        .visit-arrival .visit-iris::after { animation: visitIrisRingOpen 1.15s 0.05s ease-out forwards; }
        /* Departure intro iris: zoom into the launch pad (centered on the ship) */
        .visit-iris-intro {
            position: absolute;
            inset: 0;
            z-index: 8;
            pointer-events: none;
            background: radial-gradient(circle at 50% 72%, transparent 0, transparent var(--iris-r, 0%), #050817 calc(var(--iris-r, 0%) + 0.5%), #050817 100%);
        }
        .visit-departure .visit-iris-intro {
            --iris-r: 0%;
            animation: visitIrisOpen 1.05s 0.05s cubic-bezier(.5,0,.3,1) forwards;
        }
        .visit-iris-intro::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 72%;
            width: 0;
            height: 0;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            opacity: 0;
        }
        .visit-departure .visit-iris-intro::after { animation: visitIrisRingOpen 1.05s 0.05s ease-out forwards; }
        /* Welcome lineup (arrival): our crew + friend's pet, each with a name label */
        .visit-welcome-lineup {
            position: absolute;
            left: 7%;
            right: 7%;
            bottom: 21%;
            z-index: 5;
            display: flex;
            justify-content: center;
            align-items: flex-end;
            gap: clamp(8px, 2.4vw, 22px);
            pointer-events: none;
        }
        .visit-welcome-member {
            display: flex;
            flex-direction: column;
            align-items: center;
            opacity: 0;
            transform: translateY(20px) scale(0.5);
            animation: visitWelcomePop 0.7s var(--visit-delay, 0s) cubic-bezier(.2,1.5,.4,1) forwards;
        }
        .visit-welcome-member.is-friend { position: relative; }
        .visit-welcome-member.is-friend .visit-welcome-wave {
            position: absolute;
            top: -14px;
            font-size: 20px;
            opacity: 0;
            animation: visitWelcomeWave 1.4s calc(var(--visit-delay, 0s) + 0.6s) ease-in-out infinite;
        }
        .visit-welcome-member .visit-welcome-art {
            width: clamp(58px, 11vw, 92px);
            height: clamp(58px, 11vw, 92px);
        }
        .visit-welcome-member.is-friend .visit-welcome-art {
            width: clamp(66px, 13vw, 104px);
            height: clamp(66px, 13vw, 104px);
        }
        .visit-welcome-member .visit-welcome-art > div { width: 100%; height: 100%; }
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
            /* Two distinct phases so it reads clearly:
               1) the pet walks in from the left and then walks all the way to the ship
                  AT FULL SIZE (no shrinking yet) — a proper stroll over to the hatch.
               2) only after arriving does it board: shrink + fade into the ship body.
               --visit-board-x / --visit-board-y are measured in px so the pet converges
               exactly on the ship's center regardless of viewport width. */
            0% { opacity: 0; transform: translate(-80px, 8px) scale(0.96); }
            10% { opacity: 1; transform: translate(0, 0) scale(1); }
            /* --- walk over to the ship, staying full-size --- */
            32% { opacity: 1; transform: translate(calc(var(--visit-board-x, 120px) * 0.34), calc(var(--visit-board-y, 0px) * 0.34 - 3px)) scale(1); }
            54% { opacity: 1; transform: translate(calc(var(--visit-board-x, 120px) * 0.68), calc(var(--visit-board-y, 0px) * 0.68 - 4px)) scale(1); }
            72% { opacity: 1; transform: translate(var(--visit-board-x, 120px), var(--visit-board-y, 0px)) scale(0.96); }
            /* --- arrived at the hatch: now board (shrink + fade into the body) --- */
            88% { opacity: 1; transform: translate(var(--visit-board-x, 120px), var(--visit-board-y, 0px)) scale(0.4); }
            100% { opacity: 0; transform: translate(var(--visit-board-x, 120px), var(--visit-board-y, 0px)) scale(0.1); }
        }
        @keyframes visitPetExit {
            0% { opacity: 0; transform: translate(265%, -24%) scale(0.22); }
            34% { opacity: 1; transform: translate(240%, -14%) scale(0.58); }
            68% { opacity: 1; transform: translate(96%, -4%) scale(0.88); }
            100% { opacity: 1; transform: translate(20%, 4%) scale(1); }
        }
        @keyframes visitShipTakeoff {
            /* arc up and toward the distant destination (the iris vanishing point, measured in px) */
            0% { transform: translate(-50%, 0) scale(1); opacity: 1; }
            16% { transform: translate(-50%, -22px) scale(1.04); opacity: 1; }
            70% { transform: translate(calc(-50% + var(--visit-takeoff-x, 150px) * 0.62), calc(var(--visit-takeoff-y, -200px) * 0.7)) scale(0.34) rotate(11deg); opacity: 1; }
            100% { transform: translate(calc(-50% + var(--visit-takeoff-x, 150px)), var(--visit-takeoff-y, -200px)) scale(0.1) rotate(14deg); opacity: 0.85; }
        }
        @keyframes visitShipLand {
            /* descend from upper area down to the friend planet ground */
            0% { transform: translateX(40%) translateY(-300px) scale(0.16) rotate(-12deg); opacity: 0.85; }
            14% { transform: translateX(36%) translateY(-260px) scale(0.2) rotate(-11deg); opacity: 1; }
            66% { transform: translateX(-50%) translateY(-26px) scale(1.04) rotate(0deg); opacity: 1; }
            100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; }
        }
        @keyframes visitIrisClose {
            0% { --iris-r: 150%; }
            100% { --iris-r: 0%; }
        }
        @keyframes visitIrisOpen {
            0% { --iris-r: 0%; }
            100% { --iris-r: 150%; }
        }
        @keyframes visitIrisRing {
            0% { width: 0; height: 0; opacity: 0; box-shadow: 0 0 0 0 rgba(165,243,252,0); }
            30% { opacity: 0.9; box-shadow: 0 0 24px 4px rgba(165,243,252,0.55); }
            100% { width: 0; height: 0; opacity: 0; box-shadow: 0 0 0 0 rgba(165,243,252,0); }
        }
        @keyframes visitIrisRingOpen {
            0% { width: 60vw; height: 60vw; opacity: 0.7; box-shadow: 0 0 24px 4px rgba(165,243,252,0.5); }
            100% { width: 160vw; height: 160vw; opacity: 0; box-shadow: 0 0 0 0 rgba(165,243,252,0); }
        }
        @keyframes visitWelcomePop {
            0% { opacity: 0; transform: translateY(22px) scale(0.4); }
            60% { opacity: 1; transform: translateY(-6px) scale(1.08); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes visitWelcomeWave {
            0%, 100% { opacity: 0.9; transform: translateY(0) rotate(-8deg); }
            50% { opacity: 1; transform: translateY(-6px) rotate(10deg); }
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
        /* ===== In-field social interactions (greet / photo) ===== */
        .visit-teleport-fx {
            position: absolute;
            left: 0; top: 0;
            width: 96px; height: 96px;
            margin-left: -48px; margin-top: -48px;
            z-index: 60;
            pointer-events: none;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(165,243,252,0.9) 0%, rgba(125,211,252,0.5) 40%, transparent 70%);
            transform: scale(0.2);
            opacity: 0;
            animation: visitTeleportPop 0.6s ease-out forwards;
        }
        @keyframes visitTeleportPop {
            0% { opacity: 0; transform: scale(0.2); }
            35% { opacity: 1; transform: scale(1.1); }
            100% { opacity: 0; transform: scale(1.5); }
        }
        .field-pet.mh-visit-jump > .field-pet-wander {
            animation: visitPetJump 0.62s cubic-bezier(.3,1.6,.5,1) 1;
        }
        @keyframes visitPetJump {
            0% { transform: translateY(0) scale(1); }
            30% { transform: translateY(-26px) scale(1.06, 0.94); }
            55% { transform: translateY(-6px) scale(0.96, 1.05); }
            100% { transform: translateY(0) scale(1); }
        }
        .mh-visit-greet-bubble {
            position: absolute;
            left: 50%;
            bottom: 100%;
            transform: translate(-50%, -6px);
            z-index: 70;
            padding: 5px 12px;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.96);
            color: #0f2d4d;
            font-weight: 800;
            font-size: 14px;
            white-space: nowrap;
            box-shadow: 0 6px 18px rgba(0,0,0,0.28);
            border: 1.5px solid rgba(125, 211, 252, 0.6);
            opacity: 0;
            pointer-events: none;
            animation: visitGreetBubblePop 0.4s cubic-bezier(.2,1.5,.4,1) forwards;
        }
        .mh-visit-greet-bubble::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 100%;
            transform: translateX(-50%);
            border: 7px solid transparent;
            border-top-color: rgba(255, 255, 255, 0.96);
        }
        .mh-visit-greet-bubble.is-hide { animation: visitGreetBubbleHide 0.32s ease forwards; }
        @keyframes visitGreetBubblePop {
            0% { opacity: 0; transform: translate(-50%, 6px) scale(0.6); }
            100% { opacity: 1; transform: translate(-50%, -6px) scale(1); }
        }
        @keyframes visitGreetBubbleHide {
            0% { opacity: 1; transform: translate(-50%, -6px) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -18px) scale(0.85); }
        }
        .mh-visit-heart {
            position: absolute;
            z-index: 65;
            font-size: 22px;
            pointer-events: none;
            opacity: 0;
            transform: translate(-50%, -50%);
            animation: visitHeartFloat var(--mh-heart-dur, 1.4s) ease-out forwards;
            animation-delay: var(--mh-heart-delay, 0s);
            filter: drop-shadow(0 2px 6px rgba(244, 114, 182, 0.5));
        }
        @keyframes visitHeartFloat {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3) rotate(var(--mh-heart-rot, 0deg)); }
            20% { opacity: 1; transform: translate(-50%, -90%) scale(1.05) rotate(var(--mh-heart-rot, 0deg)); }
            100% { opacity: 0; transform: translate(calc(-50% + var(--mh-heart-dx, 0px)), -240%) scale(0.8) rotate(var(--mh-heart-rot, 0deg)); }
        }
        .mh-photo-flash {
            position: fixed;
            inset: 0;
            z-index: 2400;
            background: #ffffff;
            opacity: 0;
            pointer-events: none;
            animation: visitPhotoFlash 0.5s ease-out forwards;
        }
        @keyframes visitPhotoFlash {
            0% { opacity: 0; }
            12% { opacity: 0.92; }
            100% { opacity: 0; }
        }
        .mh-photo-frame {
            position: fixed;
            z-index: 2350;
            border: 4px solid rgba(255,255,255,0.95);
            border-radius: 10px;
            box-shadow: 0 0 0 2px rgba(15,23,42,0.5), 0 0 26px rgba(255,255,255,0.6);
            pointer-events: none;
            opacity: 0;
            animation: visitPhotoFrame 0.9s ease-out forwards;
        }
        .mh-photo-frame::before, .mh-photo-frame::after {
            content: '';
            position: absolute;
            width: 22px; height: 22px;
            border: 3px solid #fff;
        }
        .mh-photo-frame::before { left: -3px; top: -3px; border-right: none; border-bottom: none; }
        .mh-photo-frame::after { right: -3px; bottom: -3px; border-left: none; border-top: none; }
        @keyframes visitPhotoFrame {
            0% { opacity: 0; transform: scale(1.25); }
            40% { opacity: 1; transform: scale(1); }
            80% { opacity: 1; transform: scale(1); }
            100% { opacity: 0; transform: scale(0.98); }
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
    const list = pets.slice(0, 3);
    // Each pet marches toward the ship and boards. The per-pet --visit-board-x / -y are
    // measured in px at mount time (see playVisitAnimation) so they converge exactly on the
    // ship's center on any viewport width; stagger so they file in one after another.
    return list.map((pet, index) => `
        <div class="visit-pet" style="--visit-delay:${(index * 0.5).toFixed(2)}s" title="${escapeHtml(displayPetName(pet))}">
            <div>${petArtHtml(pet, { alt: displayPetName(pet), motion: 'walk' })}</div>
        </div>
    `).join('');
}

function welcomeLineupHtml(members = []) {
    return members
        .filter((m) => m && m.pet)
        .slice(0, 5)
        .map((m, index) => {
            const name = displayPetName(m.pet);
            const cls = m.isFriend ? ' is-friend' : '';
            const wave = m.isFriend ? '<span class="visit-welcome-wave">👋</span>' : '';
            const delay = (3.35 + index * 0.16).toFixed(2);
            return `
        <div class="visit-welcome-member${cls}" style="--visit-delay:${delay}s" title="${escapeHtml(name)}">
            ${wave}
            <div class="visit-welcome-art"><div>${petArtHtml(m.pet, { alt: name, motion: m.isFriend ? 'idle' : 'walk' })}</div></div>
            <div class="visit-pet-name">${escapeHtml(name)}</div>
        </div>`;
        })
        .join('');
}

function playVisitAnimation({ kind, title, subtitle, caption, pets = [], gift = '', welcomePet = null } = {}) {
    injectVisitAnimationStyles();
    if (kind === 'arrival' && _visitSkipArrivalAfterDeparture) {
        _visitSkipArrivalAfterDeparture = false;
        hideVisitBlackout();
        return Promise.resolve();
    }
    // Arrival shows everyone: our crew (welcoming guests) + the friend's pet (host).
    const welcomeMembers = kind === 'arrival'
        ? [
            ...pets.map((pet) => ({ pet, isFriend: false })),
            ...(welcomePet ? [{ pet: welcomePet, isFriend: true }] : []),
        ]
        : [];
    return (async () => {
        await preloadPetAssets([...pets, welcomePet].filter(Boolean), { includeAll: true });
        return new Promise((resolve) => {
            const mask = document.createElement('div');
            mask.className = 'visit-animation-mask';
            mask.innerHTML = `
            <div class="visit-animation-card visit-${escapeHtml(kind || 'departure')}">
                <div class="visit-animation-title">
                    <span><b>${escapeHtml(title || '星际拜访')}</b><i>${escapeHtml(subtitle || '')}</i></span>
                    <button class="visit-skip-btn" type="button" data-skip-visit-animation>${escapeHtml(t('skip'))}</button>
                </div>
                <div class="visit-planet" aria-hidden="true"></div>
                <div class="visit-ground" aria-hidden="true"></div>
                <div class="visit-orbit-path" aria-hidden="true"></div>
                <div class="visit-ship" aria-hidden="true">${spacecraftSvg()}</div>
                <div class="visit-pet-lineup">${petLineupHtml(pets)}</div>
                ${kind === 'arrival' ? `<div class="visit-welcome-lineup">${welcomeLineupHtml(welcomeMembers)}</div>` : ''}
                ${kind === 'return' ? `<div class="visit-gift" aria-hidden="true">${escapeHtml(gift || '🎁')}</div>` : ''}
                <div class="visit-progress-steps" aria-hidden="true"><i style="--visit-step-delay:0.25s"></i><i style="--visit-step-delay:1.9s"></i><i style="--visit-step-delay:3.55s"></i></div>
                <div class="visit-caption">${escapeHtml(caption || '')}</div>
                ${kind === 'departure' ? '<div class="visit-iris-intro" aria-hidden="true"></div>' : ''}
                ${kind === 'departure' || kind === 'arrival' ? '<div class="visit-iris" aria-hidden="true"></div>' : ''}
            </div>`;
            let done = false;
            let skipButtonClicked = false;
            const finish = () => {
                if (done) return;
                done = true;
                if (kind === 'departure' && skipButtonClicked) {
                    _visitSkipArrivalAfterDeparture = true;
                }
                // Departure is always followed by arrival. Drop a full-screen black cover
                // BEFORE removing this mask so the planet/home background never flashes
                // through during the hand-off; arrival removes it once its zoom reveal runs.
                if (kind === 'departure') showVisitBlackout();
                mask.remove();
                resolve();
            };
            mask.querySelector('[data-skip-visit-animation]')?.addEventListener('click', () => {
                skipButtonClicked = true;
                finish();
            });
            const card = mask.querySelector('.visit-animation-card');
            // Suppress transforms while we measure true layout positions.
            if (kind === 'departure') card?.classList.add('visit-measuring');
            document.body.appendChild(mask);
            // Arrival appears one frame after departure removed its mask. The persistent
            // blackout sits behind it (z below the mask) and is cleared only after the
            // iris zoom-in reveal has taken over, so the take-off zooms straight into landing.
            if (kind === 'arrival') {
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    setTimeout(hideVisitBlackout, 1250);
                }));
            }
            scanAndMount(mask);
            // On departure, anchor each pet's boarding target and the ship's takeoff vector to
            // the actual measured pixel positions so they line up on every viewport width.
            if (kind === 'departure' && card) {
                const ship = card.querySelector('.visit-ship');
                const petEls = card.querySelectorAll('.visit-pet');
                const cardRect = card.getBoundingClientRect();
                const shipRect = ship?.getBoundingClientRect();
                if (shipRect) {
                    const shipCx = shipRect.left + shipRect.width / 2;
                    const shipCy = shipRect.top + shipRect.height * 0.42; // hatch sits a bit above center
                    petEls.forEach((petEl) => {
                        const r = petEl.getBoundingClientRect();
                        const petCx = r.left + r.width / 2;
                        const petCy = r.top + r.height / 2;
                        petEl.style.setProperty('--visit-board-x', `${(shipCx - petCx).toFixed(1)}px`);
                        petEl.style.setProperty('--visit-board-y', `${(shipCy - petCy).toFixed(1)}px`);
                    });
                    // Ship flies toward the iris vanishing point (83% / 30% of the card).
                    const destX = cardRect.left + cardRect.width * 0.83;
                    const destY = cardRect.top + cardRect.height * 0.30;
                    ship.style.setProperty('--visit-takeoff-x', `${(destX - shipCx).toFixed(1)}px`);
                    ship.style.setProperty('--visit-takeoff-y', `${(destY - shipRect.top - shipRect.height * 0.5).toFixed(1)}px`);
                }
                // Start the animations now that variables are set.
                // Force a reflow so the removed class takes effect cleanly, then unpause.
                void card.offsetWidth;
                card.classList.remove('visit-measuring');
            }
            // The friend pet is not in global state during the animation, so scanAndMount
            // can't resolve it (it would stay an egg). Mount every welcome member directly
            // from the actual pet objects we already hold.
            if (welcomeMembers.length) {
                const memberEls = mask.querySelectorAll('.visit-welcome-member');
                welcomeMembers.forEach((member, index) => {
                    const host = memberEls[index]?.querySelector('[data-mh-pet]');
                    if (host && member.pet) mountPetArt(host, member.pet);
                });
            }
            const duration = kind === 'departure' ? 9400 : (kind === 'arrival' ? 6400 : 6800);
            setTimeout(finish, duration);
        });
    })();
}

export function playVisitDeparture({ crew = [], destinationName = '好友星球' } = {}) {
    return playVisitAnimation({
        kind: 'departure',
        title: '飞船出发',
        subtitle: `目的地：${destinationName}`,
        caption: '宠物们陆续登船，飞船随即从星球表面升空。',
        pets: crew,
    });
}

export function playVisitArrival({ crew = [], destinationName = '好友星球', welcomePet = null } = {}) {
    const welcomeName = welcomePet ? displayPetName(welcomePet) : '';
    return playVisitAnimation({
        kind: 'arrival',
        title: '抵达好友星球',
        subtitle: destinationName,
        caption: welcomeName ? `飞船降落，${welcomeName} 出来迎接大家！` : '飞船降落，好友的宠物出来迎接。',
        pets: crew,
        welcomePet,
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

/* ===== In-field social interactions: greeting & group photo ===== */

const GREET_HELLO_LINES = [
    '你好呀！👋',
    '嗨~ 很高兴见到你！',
    '哇，是新朋友！',
    '一起玩吧！',
    '欢迎来我的星球串门~',
    '你好你好！',
    '终于见到你啦！',
];

const GREET_REPLY_LINES = [
    '你也好呀！😊',
    '嗨嗨，欢迎！',
    '我们做朋友吧！',
    '好开心见到你！',
    '一起去探险呀！',
    '你来啦，太棒了！',
    '抱抱~ 💞',
];

function pickLine(list) {
    return list[Math.floor(Math.random() * list.length)] || '';
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function findCurrentFieldPetEl() {
    return document.querySelector('#mhFieldScene .field-pet-current')
        || document.querySelector('.field-pet-current');
}

function findHostFieldPetEl() {
    return document.querySelector('#mhFieldScene [data-visit-host-pet="1"]')
        || document.querySelector('[data-visit-host-pet="1"]');
}

function showGreetBubble(petEl, text, duration = 2200) {
    if (!petEl || !text) return;
    const anchor = petEl.querySelector(':scope > .field-pet-wander') || petEl;
    const old = anchor.querySelector(':scope > .mh-visit-greet-bubble');
    if (old) old.remove();
    const bubble = document.createElement('div');
    bubble.className = 'mh-visit-greet-bubble';
    bubble.textContent = text;
    anchor.appendChild(bubble);
    setTimeout(() => {
        bubble.classList.add('is-hide');
        bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
    }, Math.max(800, duration));
}

function bounceFieldPet(petEl, pet) {
    if (!petEl) return;
    petEl.classList.remove('mh-visit-jump');
    void petEl.offsetWidth;
    petEl.classList.add('mh-visit-jump');
    setTimeout(() => petEl.classList.remove('mh-visit-jump'), 700);
    try { playPetHappy(petEl, pet, { holdAnimMs: 900 }); } catch (_) {}
}

function spawnTeleportSparkle(petEl) {
    if (!petEl) return;
    const anchor = petEl.querySelector(':scope > .field-pet-wander') || petEl;
    const fx = document.createElement('div');
    fx.className = 'visit-teleport-fx';
    fx.style.left = '50%';
    fx.style.top = '50%';
    anchor.appendChild(fx);
    fx.addEventListener('animationend', () => fx.remove(), { once: true });
}

function spawnHeartsBetween(scene, elA, elB) {
    if (!scene || !elA || !elB) return;
    const sceneRect = scene.getBoundingClientRect();
    const a = elA.getBoundingClientRect();
    const b = elB.getBoundingClientRect();
    const midX = (a.left + a.width / 2 + b.left + b.width / 2) / 2 - sceneRect.left;
    const topY = Math.min(a.top, b.top) - sceneRect.top;
    const spread = Math.max(40, Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) * 0.6);
    const emojis = ['💖', '💕', '💗', '❤️', '💞', '✨'];
    const count = 9;
    for (let i = 0; i < count; i++) {
        const heart = document.createElement('div');
        heart.className = 'mh-visit-heart';
        heart.textContent = emojis[i % emojis.length];
        const offset = (Math.random() - 0.5) * spread;
        heart.style.left = `${midX + offset}px`;
        heart.style.top = `${topY + (Math.random() * 30)}px`;
        heart.style.fontSize = `${16 + Math.random() * 14}px`;
        heart.style.setProperty('--mh-heart-dx', `${(Math.random() - 0.5) * 60}px`);
        heart.style.setProperty('--mh-heart-rot', `${(Math.random() - 0.5) * 40}deg`);
        heart.style.setProperty('--mh-heart-delay', `${(i * 0.08).toFixed(2)}s`);
        heart.style.setProperty('--mh-heart-dur', `${(1.3 + Math.random() * 0.6).toFixed(2)}s`);
        scene.appendChild(heart);
        heart.addEventListener('animationend', () => heart.remove(), { once: true });
    }
}

/**
 * 打招呼动画：我的宠物跳一下 + 随机问候，对方宠物跳一下 + 随机回复，然后两者之间产生爱心特效。
 * 调用前应已把当前宠物瞬移到对方宠物身边（设置 activePetFieldPose 并重渲染）。
 */
export async function playFieldGreeting({ currentPet = null, friendPet = null } = {}) {
    injectVisitAnimationStyles();
    const scene = document.querySelector('#mhFieldScene');
    const myEl = findCurrentFieldPetEl();
    const hostEl = findHostFieldPetEl();
    if (myEl) spawnTeleportSparkle(myEl);
    await delay(180);
    bounceFieldPet(myEl, currentPet);
    showGreetBubble(myEl, pickLine(GREET_HELLO_LINES), 2400);
    await delay(820);
    bounceFieldPet(hostEl, friendPet);
    showGreetBubble(hostEl, pickLine(GREET_REPLY_LINES), 2400);
    await delay(560);
    spawnHeartsBetween(scene, myEl, hostEl);
    await delay(900);
}

/**
 * 合影快门特效：屏幕闪光 + 在两个宠物外围出现一个相框，然后镜头"咔嚓"。
 * 返回两个宠物在屏幕上的合并区域（用于截图取景，可选）。
 */
export async function playPhotoShutter() {
    injectVisitAnimationStyles();
    const myEl = findCurrentFieldPetEl();
    const hostEl = findHostFieldPetEl();
    let frameRect = null;
    if (myEl && hostEl) {
        const a = myEl.getBoundingClientRect();
        const b = hostEl.getBoundingClientRect();
        const padX = 36;
        const padY = 56;
        const left = Math.min(a.left, b.left) - padX;
        const top = Math.min(a.top, b.top) - padY;
        const right = Math.max(a.right, b.right) + padX;
        const bottom = Math.max(a.bottom, b.bottom) + padY * 0.4;
        frameRect = { left, top, width: right - left, height: bottom - top };
        const frame = document.createElement('div');
        frame.className = 'mh-photo-frame';
        frame.style.left = `${left}px`;
        frame.style.top = `${top}px`;
        frame.style.width = `${right - left}px`;
        frame.style.height = `${bottom - top}px`;
        document.body.appendChild(frame);
        frame.addEventListener('animationend', () => frame.remove(), { once: true });
    }
    await delay(520);
    const flash = document.createElement('div');
    flash.className = 'mh-photo-flash';
    document.body.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
    await delay(360);
    return frameRect;
}
