import { escapeHtml } from './utils.js';
import { createSupportRoutePlan } from './expedition_tactical_core.js';
import { formatExpeditionHistoryProgress } from './expedition_history.js';

const STYLE_ID = 'mh-expedition-map-style';

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .expedition-map{height:100%;min-height:0;padding:16px;background:var(--bg-page,#eef5ff);color:var(--text-primary,#17324d);font-family:"Microsoft YaHei",sans-serif;overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch}
        .expedition-map__history-row{width:100%;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left}.expedition-map__history-detail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 9px 8px 51px;padding:10px 12px;border-left:3px solid #67d4f5;background:rgba(20,66,88,.52);color:#c9e7f2;font-size:12px}.expedition-map__history-detail[hidden]{display:none}.expedition-map__history-detail span{display:grid;gap:2px}.expedition-map__history-detail small{color:#83b4c8}.expedition-map__history-row[aria-expanded="true"]{background:rgba(77,198,244,.22)}
        .expedition-map__top{display:flex;align-items:center;gap:10px;max-width:960px;margin:0 auto 12px}.expedition-map__title{font-size:18px;font-weight:900}.expedition-map__sub{margin-top:2px;color:var(--text-muted,#64748b);font-size:12px}.expedition-map__back{display:grid;place-items:center;width:34px;height:34px;padding:0;border:1px solid #b8cce4;border-radius:7px;background:var(--bg-card,#fff);color:#2865a0;font-size:24px;line-height:1;cursor:pointer}.expedition-map__back:hover{background:#e9f3ff}.expedition-map__reset{margin-left:auto;border:1px solid rgba(255,196,102,.62);border-radius:6px;background:rgba(64,38,15,.72);color:#ffe1a5;font-size:12px;font-weight:800;line-height:1;padding:9px 10px;cursor:pointer}.expedition-map__reset:hover{background:rgba(112,67,19,.88)}
        .expedition-map__scene,.expedition-map__prep{max-width:960px;margin:0 auto}.expedition-map__scene{padding:16px;border:1px solid #c7d9ed;border-radius:8px;background:var(--bg-card,#fff)}
        .expedition-map__intro{margin:0 0 13px}.expedition-map__intro h1{margin:0;font-size:18px}.expedition-map__intro p{margin:4px 0 0;color:var(--text-muted,#64748b);font-size:13px;line-height:1.5}.expedition-map__weekly-route{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 13px;padding:9px 10px;border:1px solid #b6d8c3;border-radius:7px;background:#f0faf3;color:#235d3d;font-size:12px;line-height:1.5}.expedition-map__weekly-route strong{font-size:13px}.expedition-map__weekly-route span{text-align:right;color:#46735a;font-weight:800}.expedition-map__planet.is-weekly-target{border-top-color:#76b98c;border-right-color:#76b98c;border-bottom-color:#76b98c;background:#f4fcf6}.expedition-map__planet.is-weekly-target.is-selected{border-color:#3d9b60;background:#e7f7eb;box-shadow:inset 0 0 0 1px #9ed6ae}.expedition-map__weekly-tag{color:#247447!important}
        .expedition-map__investigation{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;margin:0 0 13px;padding:11px;border:1px solid #9bc6d5;border-radius:7px;background:#eef9fc;color:#194f63;font-size:12px;line-height:1.5}.expedition-map__investigation strong,.expedition-map__investigation small{display:block}.expedition-map__investigation strong{font-size:13px}.expedition-map__investigation small{margin-top:2px;color:#477586}.expedition-map__investigation-progress{font-weight:900;white-space:nowrap}.expedition-map__investigation-branches{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.expedition-map__investigation-branch{padding:8px;border:1px solid #72aabd;border-radius:6px;background:#fff;color:#194f63;font:inherit;font-weight:900;cursor:pointer;text-align:left}.expedition-map__investigation-branch small{font-weight:500}.expedition-map__investigation-branch:hover{background:#e4f5fa}
        .expedition-map__planets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.expedition-map__planet{display:grid;grid-template-columns:46px minmax(0,1fr);column-gap:10px;align-items:center;min-height:82px;padding:10px;border:1px solid #c7d9ed;border-left:4px solid var(--planet-color);border-radius:7px;background:#fff;color:inherit;cursor:pointer;text-align:left}.expedition-map__planet:hover,.expedition-map__planet:focus-visible{border-color:#76a9d9;background:#f4f9ff}.expedition-map__planet.is-selected{border-color:#2879be;background:#eaf4ff;box-shadow:inset 0 0 0 1px #8dbce8}.expedition-map__planet.is-explored{border-color:#9badb9;border-left-color:#9badb9;background:#f3f6f8;color:#657784;cursor:not-allowed}.expedition-map__planet.is-explored .expedition-map__planet-icon{filter:grayscale(1);opacity:.72}
        .expedition-map__planet-icon{display:grid;place-items:center;grid-row:span 3;width:46px;height:46px;border-radius:50%;background:color-mix(in srgb,var(--planet-color) 18%,white);font-size:26px;line-height:1}.expedition-map__planet strong{overflow:hidden;font-size:14px;font-weight:900;text-overflow:ellipsis;white-space:nowrap}.expedition-map__planet span{margin-top:2px;color:var(--text-secondary,#516677);font-size:12px}.expedition-map__planet small{margin-top:4px;color:#2865a0;font-size:11px;font-weight:800}
        .expedition-map__prep{display:grid;grid-template-columns:minmax(0,1fr) 248px;gap:12px;padding-top:12px}.expedition-map__section,.expedition-map__launch{padding:14px;border:1px solid #c7d9ed;border-radius:8px;background:var(--bg-card,#fff)}.expedition-map__section h2,.expedition-map__launch h2{margin:0 0 10px;font-size:15px}.expedition-map__pet-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px}.expedition-map__pet{display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:8px;align-items:center;min-height:62px;padding:8px;border:1px solid #d5e0ed;border-radius:7px;background:#fff;color:inherit;text-align:left;cursor:pointer}.expedition-map__pet.is-selected{border-color:#2879be;background:#eaf4ff;box-shadow:inset 0 0 0 1px #8dbce8}.expedition-map__pet-art{display:grid;place-items:center;grid-row:span 2;width:44px;height:44px;border-radius:6px;background:#e2f0ff;overflow:hidden;font-size:24px;background-repeat:no-repeat}.expedition-map__pet-art img{width:100%;height:100%;object-fit:cover}.expedition-map__pet strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.expedition-map__pet small{margin-top:2px;color:var(--text-muted,#64748b);font-size:11px}.expedition-map__rename-note{margin:8px 0 0;color:var(--text-muted,#64748b);font-size:11px;line-height:1.45}.expedition-map__launch{align-self:stretch}.expedition-map__launch p{min-height:56px;margin:0 0 12px;color:var(--text-secondary,#516677);font-size:13px;line-height:1.5}.expedition-map__start{width:100%;min-height:40px;border:0;border-radius:6px;background:#2879be;color:#fff;font-size:14px;font-weight:900;cursor:pointer}.expedition-map__start:hover{background:#1f619d}.expedition-map__start:disabled{opacity:.45;cursor:not-allowed}.expedition-map__empty{padding:14px;border:1px dashed #9bb8d5;border-radius:7px;background:#f7fbff;color:var(--text-secondary,#516677);font-size:13px;line-height:1.55}.expedition-map__history{max-width:960px;margin:12px auto 0;padding:14px;border-top:1px solid #c7d9ed;background:var(--bg-card,#fff)}.expedition-map__history h2{margin:0 0 8px;font-size:15px}.expedition-map__history-list{display:grid;gap:6px}.expedition-map__history-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #e2edf7;font-size:12px}.expedition-map__history-row:first-child{border-top:0}.expedition-map__history-state{font-weight:900}.expedition-map__history-state.is-complete{color:#168352}.expedition-map__history-state.is-failed{color:#bf4b4b}.expedition-map__history-copy{min-width:0;color:var(--text-secondary,#516677);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.expedition-map__history-time{color:var(--text-muted,#64748b);font-size:11px;white-space:nowrap}
        @media(max-width:680px){.expedition-map{padding:12px}.expedition-map__planets,.expedition-map__prep{grid-template-columns:1fr}.expedition-map__scene{padding:13px}.expedition-map__prep{padding-top:10px}.expedition-map__launch p{min-height:0}.expedition-map__pet-list{grid-template-columns:1fr 1fr;max-height:218px;overflow-y:auto;padding-right:5px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#76a9d9 #edf5fd}.expedition-map__pet-list::-webkit-scrollbar{width:6px}.expedition-map__pet-list::-webkit-scrollbar-track{background:#edf5fd;border-radius:999px}.expedition-map__pet-list::-webkit-scrollbar-thumb{background:#76a9d9;border-radius:999px}.expedition-map__history-detail{grid-template-columns:repeat(2,minmax(0,1fr));margin-left:41px}}
        @media(max-width:390px){.expedition-map__pet-list{grid-template-columns:1fr}}
        .expedition-map__pet.is-dispatching{background:#f1f5f9;border-color:#cbd5e1;color:#64748b;cursor:not-allowed;filter:grayscale(.65)}.expedition-map__pet.is-dispatching .expedition-map__pet-art{opacity:.7}
        #app:has(.expedition-map){background:linear-gradient(rgba(0,0,0,.1),rgba(0,0,0,.1)),url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/expedition-scenes/q4.webp') center / cover no-repeat!important}#app:has(.expedition-map)::before{box-shadow:inset 0 0 0 1px rgba(255,255,255,.5)!important}.expedition-map{position:relative;isolation:isolate;padding:20px;background:transparent;color:#e8f8ff}
        .expedition-map__top,.expedition-map__scene,.expedition-map__prep,.expedition-map__history{max-width:1040px}.expedition-map__top{gap:11px;margin-bottom:15px}.expedition-map__title{color:#f5fcff;font-size:20px;text-shadow:0 0 16px rgba(82,222,255,.72)}.expedition-map__sub{color:#a7c8dc}.expedition-map__back{width:36px;height:36px;border-color:rgba(108,220,255,.58);border-radius:6px;background:rgba(7,25,42,.72);color:#c8f6ff;box-shadow:0 0 14px rgba(43,194,255,.2)}.expedition-map__back:hover{background:rgba(28,77,105,.88)}
        .expedition-map__scene{padding:18px;border-color:rgba(104,213,255,.3);background:rgba(8,22,39,.38);box-shadow:inset 0 1px rgba(206,250,255,.1),0 20px 45px rgba(0,0,0,.22);backdrop-filter:blur(6px)}.expedition-map__intro h1{color:#f3fcff;font-size:20px}.expedition-map__intro p{color:#b5d4e6}.expedition-map__weekly-route{border-color:rgba(105,244,181,.38);background:rgba(26,107,88,.22);color:#d0ffe6}.expedition-map__weekly-route span{color:#a7f4c7}.expedition-map__weekly-tag{color:#8ff8bc!important}
        .expedition-map__planets{gap:14px}.expedition-map__planet{grid-template-columns:1fr;gap:0;min-width:0;padding:0;overflow:hidden;border:1px solid rgba(118,199,232,.32);border-left-color:var(--planet-color);border-radius:7px;background:rgba(8,23,42,.88);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}.expedition-map__planet:hover,.expedition-map__planet:focus-visible{border-color:var(--planet-color);background:rgba(8,23,42,.88);box-shadow:0 11px 26px rgba(0,0,0,.28);transform:translateY(-3px);outline:none}.expedition-map__planet.is-selected{border:2px solid var(--planet-color);background:rgba(8,23,42,.95);box-shadow:0 0 0 2px color-mix(in srgb,var(--planet-color) 30%,transparent),0 0 24px color-mix(in srgb,var(--planet-color) 62%,transparent),0 16px 28px rgba(0,0,0,.38);transform:translateY(-5px)}.expedition-map__planet.is-explored{border-color:rgba(118,199,232,.32);background:rgba(8,23,42,.88);color:#e8f8ff;filter:saturate(.35);opacity:.64}.expedition-map__planet-visual{position:relative;display:grid;place-items:center;aspect-ratio:16/9;overflow:hidden;background:#07131f;box-shadow:inset 0 -28px 28px rgba(1,9,21,.5),inset 0 0 0 1px rgba(207,250,255,.14)}.expedition-map__planet-visual::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(1,9,21,.04),rgba(1,9,21,.5));pointer-events:none}.expedition-map__planet-visual img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(1.08) contrast(1.04)}.expedition-map__planet-icon{position:relative;z-index:1;display:grid;place-items:center;width:68px;height:68px;border:1px solid rgba(235,253,255,.66);border-radius:50%;background:color-mix(in srgb,var(--planet-color) 38%,rgba(4,17,33,.68));box-shadow:0 0 30px color-mix(in srgb,var(--planet-color) 65%,transparent);font-size:36px;line-height:1}.expedition-map__planet-copy{display:grid;gap:4px;padding:12px}.expedition-map__planet strong,.expedition-map__planet span,.expedition-map__planet small{margin:0}.expedition-map__planet strong{color:#f4fcff;font-size:15px}.expedition-map__planet span{color:#b7d5e6}.expedition-map__planet small{color:#93dffc}.expedition-map__planet.is-weekly-target,.expedition-map__planet.is-weekly-target.is-selected{background-color:#08172a!important;color:#e8f8ff!important}.expedition-map__planet.is-weekly-target{border-color:#6ee9a2}.expedition-map__planet.is-weekly-target.is-selected{background:rgba(8,23,42,.98)!important;box-shadow:0 0 0 2px rgba(110,233,162,.35),0 0 25px rgba(110,233,162,.38),0 16px 28px rgba(0,0,0,.38)}.expedition-map__planet.is-weekly-target .expedition-map__planet-copy{background:#08172a!important}.expedition-map__planet.is-weekly-target strong{color:#f4fcff!important}.expedition-map__planet.is-weekly-target span{color:#b7d5e6!important}.expedition-map__planet.is-weekly-target small{color:#8ff8bc!important}
        .expedition-map__prep{grid-template-columns:minmax(0,1fr) 300px;gap:14px;padding-top:14px}.expedition-map__section,.expedition-map__launch{padding:16px;border-color:rgba(104,213,255,.28);background:rgba(9,20,34,.48);box-shadow:inset 0 1px rgba(220,250,255,.08),0 18px 36px rgba(0,0,0,.2);backdrop-filter:blur(6px)}.expedition-map__section h2,.expedition-map__launch h2,.expedition-map__history h2{margin-bottom:12px;color:#effbff}.expedition-map__pet-list{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}.expedition-map__pet{position:relative;grid-template-columns:1fr;grid-template-rows:1fr auto auto;gap:6px;min-width:0;min-height:0;overflow:hidden;border-color:rgba(113,193,226,.24);border-radius:6px;background:rgba(12,37,57,.78);transition:transform .18s ease,box-shadow .18s ease}.expedition-map__pet:hover{border-color:rgba(144,235,255,.7);transform:translateY(-2px)}.expedition-map__pet.is-selected{border-color:#7de9ff;background:rgba(12,37,57,.9);box-shadow:0 0 0 2px rgba(76,211,255,.25),0 0 22px rgba(45,198,255,.54),inset 0 0 18px rgba(62,190,255,.12)}.expedition-map__pet-art{grid-row:auto;width:100%;height:auto;aspect-ratio:1;border-radius:4px;background:radial-gradient(circle,#1e7199,#071525);font-size:36px}.expedition-map__pet strong{color:#f4fcff}.expedition-map__pet small,.expedition-map__rename-note{color:#a6cadc}.expedition-map__pet-readiness{color:#8cf0bd}.expedition-map__pet-readiness.is-low{color:#ffd27d}.expedition-map__pet.is-dispatching{background:rgba(12,37,57,.78);border-color:rgba(113,193,226,.24);color:#a6cadc;filter:grayscale(.35)}.expedition-map__pet.is-dispatching::after{content:"勘探中";position:absolute;inset:0;z-index:2;display:grid;place-items:center;background:rgba(2,8,17,.72);color:#ecfbff;font-size:15px;font-weight:900;letter-spacing:2px;text-shadow:0 0 12px #69daff}.expedition-map__pet.is-dispatching .expedition-map__pet-art{opacity:.7}
        .expedition-map__launch{display:flex;flex-direction:column;background:rgba(26,29,36,.76)}.expedition-map__launch p{min-height:0;margin:4px 0 24px;color:#c3dce9;font-size:14px;line-height:1.85}.expedition-map__launch p br{line-height:2.05}.expedition-map__dojo-floors{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin:-8px 0 16px}.expedition-map__dojo-floor{min-height:34px;border:1px solid rgba(126,204,239,.34);border-radius:5px;background:rgba(5,17,30,.6);color:#93b7c8;font:inherit;font-size:12px;font-weight:900;cursor:not-allowed}.expedition-map__dojo-floor.is-available{border-color:rgba(255,219,116,.8);background:rgba(142,89,26,.68);color:#fff0b7;cursor:pointer}.expedition-map__dojo-floor.is-selected{box-shadow:0 0 0 2px rgba(91,224,255,.46);color:#fff}.expedition-map__dojo-order{position:absolute;top:7px;left:7px;z-index:1;padding:3px 6px;border:1px solid rgba(222,249,255,.7);border-radius:4px;background:rgba(5,22,36,.86);color:#fff4bd;font-size:11px;font-weight:900;line-height:1}.expedition-map__dojo-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;width:100%;color:#a9d7e7;font-size:10px;font-weight:800}.expedition-map__dojo-stats span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.expedition-map__buff-preview{border-color:rgba(113,203,239,.35)!important;background:rgba(5,17,30,.58)!important;color:#bed9e7!important;box-shadow:inset 0 1px rgba(220,250,255,.06)}.expedition-map__buff-preview strong{color:#f1fbff!important}.expedition-map__start{display:block;width:min(100%,250px);min-height:48px;margin:auto auto 18px;border:1px solid rgba(255,242,158,.7);border-radius:7px;background:linear-gradient(135deg,#f5c84c,#ef8e37 52%,#ce4a7d);box-shadow:0 0 15px rgba(246,177,59,.56),0 0 28px rgba(212,76,124,.28);font-size:15px;letter-spacing:1px;animation:expedition-launch-pulse 1.8s ease-in-out infinite}.expedition-map__start:hover{background:linear-gradient(135deg,#f5c84c,#ef8e37 52%,#ce4a7d);filter:brightness(1.12);transform:translateY(-1px)}.expedition-map__start:disabled{box-shadow:none;animation:none}.expedition-map__empty{border-color:rgba(142,215,242,.52);background:rgba(6,20,36,.55);color:#bed9e7}
        .expedition-map__history{margin-top:14px;padding:16px;border:1px solid rgba(104,213,255,.22);border-radius:8px;background:rgba(7,18,31,.42);backdrop-filter:blur(6px)}.expedition-map__history-list{gap:3px}.expedition-map__history-row{grid-template-columns:32px minmax(0,1fr) auto;gap:10px;padding:9px;border:0;border-radius:4px}.expedition-map__history-row:nth-child(odd){background:rgba(119,187,221,.08)}.expedition-map__history-row:nth-child(even){background:rgba(140,88,191,.08)}.expedition-map__history-row:hover{background:rgba(77,198,244,.17)}.expedition-map__history-state{display:grid;place-items:center;width:32px;height:32px;border:1px solid currentColor;border-radius:4px;font-size:0}.expedition-map__history-state::before{font-size:17px}.expedition-map__history-state.is-complete{color:#8cf0bd;background:rgba(36,142,93,.22)}.expedition-map__history-state.is-complete::before{content:"✦"}.expedition-map__history-state.is-failed{color:#f4a1b5;background:rgba(163,49,73,.2)}.expedition-map__history-state.is-failed::before{content:"×"}.expedition-map__history-copy{color:#d9ecf5}.expedition-map__history-time{color:#8db4c7}.expedition-map__dojo-launch{align-self:start;position:sticky;top:12px}.expedition-map__dojo-launch .expedition-map__start{margin:0 auto}@keyframes expedition-launch-pulse{50%{box-shadow:0 0 25px rgba(255,205,89,.85),0 0 48px rgba(218,79,142,.48)}}@media(max-width:680px){.expedition-map{padding:12px}.expedition-map__planets,.expedition-map__prep{grid-template-columns:1fr}.expedition-map__scene,.expedition-map__section,.expedition-map__launch,.expedition-map__history{padding:13px}.expedition-map__dojo-launch{position:static}.expedition-map__pet-list{grid-template-columns:repeat(2,minmax(0,1fr));max-height:none;overflow:visible;padding:0}.expedition-map__history-row{grid-template-columns:32px minmax(0,1fr)}.expedition-map__history-time{grid-column:2;font-size:10px}}@media(max-width:390px){.expedition-map__pet-list{grid-template-columns:1fr}.expedition-map__brief-grid{grid-template-columns:1fr}}
    `;
    style.textContent += `
        .expedition-map{padding-bottom:104px}.expedition-map__dojo-roster{display:contents}.expedition-map__dojo-roster>summary{display:none}
        .expedition-map__pet-role{position:absolute;top:7px;left:7px;z-index:2;padding:4px 7px;border:1px solid rgba(222,249,255,.78);border-radius:4px;background:rgba(5,22,36,.92);color:#fff4bd;font-size:11px;font-weight:900;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,.32)}
        .expedition-map__launch-dock{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));left:max(16px,env(safe-area-inset-left));z-index:20;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;width:min(1010px,calc(100% - 32px));min-height:68px;margin:auto;padding:10px 12px 10px 16px;border:1px solid rgba(139,230,255,.55);border-radius:8px;background:rgba(5,18,32,.94);box-shadow:0 10px 32px rgba(0,0,0,.52),inset 0 1px rgba(226,252,255,.12);color:#effbff;backdrop-filter:blur(12px)}
        .expedition-map__launch-summary{display:grid;gap:4px;min-width:0}.expedition-map__launch-summary strong{overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.expedition-map__launch-summary small{overflow:hidden;color:#a9d5e7;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.expedition-map__launch-summary b{color:#ffe187}.expedition-map__launch-dock .expedition-map__start{width:190px;min-height:48px;margin:0;flex:none}
        @media(max-width:680px){
            .expedition-map{padding-bottom:96px}
            .expedition-map__dojo-roster{display:block;grid-column:1/-1;border:1px solid rgba(104,213,255,.28);border-radius:8px;background:rgba(9,20,34,.48);overflow:hidden}
            .expedition-map__dojo-roster>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:10px 13px;color:#effbff;cursor:pointer;list-style:none}
            .expedition-map__dojo-roster>summary::-webkit-details-marker{display:none}
            .expedition-map__dojo-roster>summary span:first-child{display:grid;gap:3px;min-width:0}
            .expedition-map__dojo-roster>summary strong{font-size:14px}.expedition-map__dojo-roster>summary small{overflow:hidden;color:#a6cadc;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
            .expedition-map__dojo-toggle{flex:none;color:#91eaff;font-size:12px;font-weight:900}.expedition-map__dojo-roster[open] .expedition-map__dojo-toggle{font-size:0}.expedition-map__dojo-roster[open] .expedition-map__dojo-toggle::after{content:"收起阵容";font-size:12px}
            .expedition-map__dojo-roster>.expedition-map__section{border:0;border-top:1px solid rgba(104,213,255,.2);border-radius:0;box-shadow:none}
            .expedition-map__brief-item.is-detail{display:none}
            .expedition-map__launch-dock{right:10px;bottom:max(10px,env(safe-area-inset-bottom));left:10px;grid-template-columns:minmax(0,1fr) 128px;width:auto;min-height:64px;gap:8px;padding:8px 8px 8px 11px}.expedition-map__launch-summary strong{font-size:12px}.expedition-map__launch-summary small{font-size:10px}.expedition-map__launch-dock .expedition-map__start{width:128px;min-height:48px;font-size:13px}
        }
    `;
    document.head.appendChild(style);
}

function petArt(pet) {
    const sheet = String(pet?.imageSheetUrl || '').trim();
    if (sheet) {
        const row = ({ baby: 0, teen: 1, adult: 2, elder: 3 })[pet.stage] ?? 0;
        return `<span class="expedition-map__pet-art" style="background-image:url('${escapeHtml(sheet)}');background-size:400% 400%;background-position:0% ${(row * 100 / 3).toFixed(4)}%"></span>`;
    }
    const image = String(pet?.imageUrl || '').trim();
    if (image) return `<span class="expedition-map__pet-art"><img src="${escapeHtml(image)}" alt=""></span>`;
    return '<span class="expedition-map__pet-art" style="display:grid;place-items:center">🐾</span>';
}

function stageLabel(stage) {
    return ({ egg: '宠物蛋', baby: '幼年', teen: '少年', adult: '成年', elder: '长者' })[stage] || '成年';
}

function expeditionPetBenefit(pet) {
    const preview = pet?.expeditionPreview || {};
    const combatPower = Math.max(0, Number(preview.combatPower) || 0);
    const captureBonus = Math.max(0, Number(preview.captureBonusPercent) || 0);
    return `战力 ${combatPower} · 捕捉 +${captureBonus.toFixed(1)}%`;
}

export function expeditionPetReadiness(pet) {
    const energy = Math.max(0, Math.min(100, Math.round(Number(pet?.stats?.hunger) || 0)));
    const needsCare = energy < 35;
    return {
        energy,
        needsCare,
        label: needsCare ? `体力 ${energy}/100 · 建议先照料` : `体力 ${energy}/100 · 状态良好`,
    };
}

function expeditionBenefitItems(preview) {
    const combatPower = Math.max(0, Number(preview?.combatPower) || 0);
    const magic = Math.max(0, Number(preview?.magic) || 0);
    const captureBonus = Math.max(0, Number(preview?.captureBonusPercent) || 0);
    return `<div class="expedition-map__brief-item is-detail"><span class="expedition-map__brief-icon">◆</span><span>综合战力</span><strong>${combatPower}</strong></div><div class="expedition-map__brief-item is-detail"><span class="expedition-map__brief-icon">✧</span><span>魔法技能</span><strong>${magic} 魔法</strong></div><div class="expedition-map__brief-item is-detail"><span class="expedition-map__brief-icon">◎</span><span>幸运捕捉</span><strong>+${captureBonus.toFixed(1)}%</strong></div>`;
}

function dojoPetSummary(pet, order) {
    const preview = pet?.expeditionPreview || {};
    return `<span class="expedition-map__dojo-order">出战 ${order}</span><small>${escapeHtml(preview.speciesSpecialty?.name || stageLabel(pet?.stage))}</small><span class="expedition-map__dojo-stats"><span>HP ${Math.max(0, Number(preview.maxHp) || 0)}</span><span>攻 ${Math.max(0, Number(preview.attack) || 0)}</span><span>防 ${Math.max(0, Number(preview.defense) || 0)}</span></span>`;
}

function expeditionSceneImage(expedition) {
    const biome = String(expedition?.biome || '');
    if (biome.includes('森林')) return 'q4';
    if (biome.includes('海滩') || biome.includes('月湾')) return 'q1';
    if (biome.includes('沼泽')) return 'q6';
    if (biome.includes('遗迹') || biome.includes('碎岩')) return 'q5';
    if (biome.includes('冰') || biome.includes('雪')) return 'q3';
    if (biome.includes('熔') || biome.includes('火') || biome.includes('岩')) return 'q2';
    const id = String(expedition?.id || biome);
    const checksum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
    return `q${checksum % 6 + 1}`;
}

export function renderExpeditionMap(panel, { expeditions = [], pets = [], history = [], weeklyProgress = null, dojoStatus = null, investigationProgress = null, sectorEventProgress = null } = {}, { onBack, onLaunch, onLaunchConfrontation, onLaunchSectorFinale, onLaunchDojo, onChooseInvestigationBranch, onDiscoverSectorSideCase, onChooseSectorSideCase, onReviewHistory, onResetToday } = {}) {
    ensureStyles();
    expeditions = Array.isArray(expeditions) ? expeditions.filter(item => item?.id) : [];
    pets = Array.isArray(pets) ? pets.filter(item => item?.id) : [];
    history = Array.isArray(history) ? history.slice(0, 10) : [];
    let selectedExpeditionId = expeditions.find(item => !item.explored)?.id || '';
    let selectedPetId = pets.find(item => !item.isDispatching)?.id || '';
    let selectedSupportPetIds = [];
    let dojoSelectionIds = pets.filter(item => !item.isDispatching).slice(0, 3).map(item => item.id);
    let selectedDojoFloor = dojoStatus?.nextFloor || dojoStatus?.highestClearedFloor || 0;
    let dojoRosterExpanded = false;

    const render = () => {
        const expedition = expeditions.find(item => item.id === selectedExpeditionId && !item.explored) || null;
        const pet = pets.find(item => item.id === selectedPetId) || null;
        const petReadiness = expeditionPetReadiness(pet);
        const supportPets = pets.filter(item => selectedSupportPetIds.includes(item.id));
        const supportRoutePlan = createSupportRoutePlan(supportPets.map(item => item.expeditionPreview?.speciesSpecialty));
        const preview = pet?.expeditionPreview;
        const ecology = expedition?.ecologyPreview || {};
        const exploredCount = expeditions.filter(item => item.explored).length;
        const weeklyTheme = weeklyProgress?.theme || null;
        const themeGoal = Array.isArray(weeklyProgress?.goals)
            ? weeklyProgress.goals.find(goal => goal?.themeId === weeklyTheme?.id)
            : null;
        const targetBiomes = Array.isArray(weeklyTheme?.biomes) ? weeklyTheme.biomes : [];
        const weeklyRouteText = themeGoal?.complete
            ? `「${weeklyTheme.label}」研究已完成，任选星球继续积累资源。`
            : `目标生态：${targetBiomes.join(' / ')}`;
        const weeklyStateText = weeklyProgress?.claimed
            ? '奖励已领取'
            : weeklyProgress?.claimable ? '奖励待领取' : `${weeklyProgress?.completed || 0}/${weeklyProgress?.total || 0} 项`;
        const investigationVisible = investigationProgress?.stage && investigationProgress.stage !== 'undiscovered';
        const sideCase = sectorEventProgress?.sideCase;
        const sideCaseAvailable = sectorEventProgress?.stage === 'week2-divergence' || sectorEventProgress?.stage === 'week3-convergence' || sectorEventProgress?.stage === 'week4-finale';
        let investigationText = investigationProgress?.stage === 'choose-branch'
            ? '找到发光羽毛，踪迹在沼泽深处一分为二。选择后续调查方向。'
            : investigationProgress?.stage === 'confrontation-ready'
                ? '证据已经完整。选择伙伴后即可进入异变源头。'
                : investigationProgress?.stage === 'resolved'
                    ? `${investigationProgress.resolution?.ecologyChange || '孢子异变已经平息。'} 纪念物：${investigationProgress.resolution?.keepsake || '调查档案'}。`
                    : `正在${investigationProgress?.branch?.label || '调查孢子异变'}，下一次荧光沼泽远征可继续取证。`;
        if (investigationProgress?.stage === 'investigating' && expedition?.biome === investigationProgress?.biome) {
            const specialty = preview?.speciesSpecialty;
            const supportText = supportPets.length
                ? supportPets.map(item => `${item.name || '支援伙伴'}·${item.expeditionPreview?.speciesSpecialty?.name || '常规支援'}`).join('、')
                : '尚未选择支援伙伴';
            investigationText += ` 本局第 6 至 10 层将出现调查节点；领队由${specialty?.name || '常规能力'}出战，支援：${supportText}。`;
        }
        const dojoNextFloor = dojoStatus?.nextFloor;
        const dojoText = dojoNextFloor
            ? `已解锁至第 ${dojoStatus.highestClearedFloor || 0} 层 · 下一层 ${dojoNextFloor}F`
            : '五层守护试炼已全部首通';
        const dojoTokenText = `挑战函 ${Math.max(0, Number(dojoStatus?.challengeTokens) || 0)} / 2`;
        const dojoPets = pets.filter(item => dojoSelectionIds.includes(item.id));
        const compactLayout = window.matchMedia('(max-width: 680px)').matches;
        const dojoRosterSummary = dojoPets.length
            ? dojoPets.map(item => item.name || '未命名伙伴').join(' · ')
            : '尚未选择阵容';
        const dojoClearedFloors = new Set(dojoStatus?.clearedFloors || []);
        const dojoFloorAvailable = floor => dojoClearedFloors.has(floor) || floor === dojoStatus?.nextFloor;
        if (!dojoFloorAvailable(selectedDojoFloor)) selectedDojoFloor = dojoStatus?.nextFloor || dojoStatus?.highestClearedFloor || 0;
        const dojoReady = dojoPets.length === 3 && dojoFloorAvailable(selectedDojoFloor);
        panel.innerHTML = `
            <main class="expedition-map">
                <header class="expedition-map__top">
                    <button class="expedition-map__back" id="mhExpeditionBack" type="button" aria-label="返回">‹</button>
                    <div><div class="expedition-map__title">今日星图</div><div class="expedition-map__sub">每日固定 3 颗星球，已探索 ${exploredCount} / ${expeditions.length}</div></div>
                    ${typeof onResetToday === 'function' ? '<button class="expedition-map__reset" id="mhExpeditionReset" type="button">重置今日探索</button>' : ''}
                </header>
                <section class="expedition-map__scene">
                    <div class="expedition-map__intro"><h1>${expedition ? '选择一颗星球开始探险' : '今日三颗星球均已探索'}</h1><p>${expedition ? '每颗星球都有独立的怪物生态，完整远征分为两章、每章 15 层。' : '明天将生成新的三颗星球，今天的星图不会再刷新。'}</p></div>
                    ${investigationVisible ? `<div class="expedition-map__investigation"><div><strong>${escapeHtml(investigationProgress.title)}</strong><small>${escapeHtml(investigationText)}</small></div><span class="expedition-map__investigation-progress">证据 ${Math.max(0, Number(investigationProgress.evidence) || 0)} / ${Math.max(1, Number(investigationProgress.evidenceToConfront) || 1)}</span>${investigationProgress.stage === 'choose-branch' ? `<div class="expedition-map__investigation-branches">${investigationProgress.branches.map(branch => `<button class="expedition-map__investigation-branch" data-investigation-branch="${escapeHtml(branch.id)}" type="button">${escapeHtml(branch.label)}<small>${escapeHtml(branch.hint)}</small></button>`).join('')}</div>` : investigationProgress.stage === 'confrontation-ready' ? '<div class="expedition-map__investigation-branches"><button class="expedition-map__investigation-branch" id="mhInvestigationConfrontation" type="button">进入异变源头<small>使用当前选中的伙伴与调查优势。</small></button></div>' : ''}</div>` : ''}
                    ${sideCaseAvailable && !sideCase?.choiceId ? `<div class="expedition-map__investigation"><div><strong>伴随案件 · 晶流漂移</strong><small>${sideCase?.discovered ? '晶体碎片正随星尘潮汐迁移，选择处理方式会影响共同终局。' : '主案件的异常波动中出现了另一组晶体信号。'}</small></div><div class="expedition-map__investigation-branches">${sideCase?.discovered ? '<button class="expedition-map__investigation-branch" data-sector-side-choice="stabilize-current" type="button">稳定晶流<small>封住扩散路径，终局更稳妥。</small></button><button class="expedition-map__investigation-branch" data-sector-side-choice="follow-fragments" type="button">追踪碎片<small>保留风险，寻找隐藏共鸣。</small></button>' : '<button class="expedition-map__investigation-branch" id="mhDiscoverSectorSideCase" type="button">记录晶体信号<small>开启一次轻量选择，不占用远征次数。</small></button>'}</div></div>` : ''}
                    ${sectorEventProgress?.stage === 'week4-finale' ? '<div class="expedition-map__investigation"><div><strong>星尘潮汐 · 共同终局</strong><small>三层短航线将依次检验调查分支、冻结支援专精和异变洞察。</small></div><div class="expedition-map__investigation-branches"><button class="expedition-map__investigation-branch" id="mhSectorFinale" type="button">进入共同终局<small>完成后生成只读星域档案。</small></button></div></div>' : ''}
                    ${themeGoal ? `<div class="expedition-map__weekly-route"><div><strong>本周研究 · ${escapeHtml(weeklyTheme.label)}</strong><br>${escapeHtml(weeklyRouteText)}</div><span>${escapeHtml(weeklyStateText)}</span></div>` : ''}
                    ${dojoStatus ? `<div class="expedition-map__weekly-route"><div><strong>守护大师友好道馆 · 3v3 车轮战</strong><br>${escapeHtml(dojoText)} · 每成功 2 次远征获得 1 张挑战函。</div><span>${escapeHtml(dojoTokenText)}</span></div>` : ''}
                    <div class="expedition-map__planets">${expeditions.map(item => `
                        <button class="expedition-map__planet ${item.id === selectedExpeditionId ? 'is-selected' : ''} ${item.explored ? 'is-explored' : ''} ${!themeGoal?.complete && targetBiomes.includes(item.biome) ? 'is-weekly-target' : ''}" style="--planet-color:${escapeHtml(item.color)}" data-expedition-id="${escapeHtml(item.id)}" type="button" ${item.explored ? 'disabled' : ''}>
                            <span class="expedition-map__planet-visual" aria-hidden="true"><img src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/expedition-scenes/${expeditionSceneImage(item)}.webp" alt="" loading="lazy"></span><span class="expedition-map__planet-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.biome)} · ${escapeHtml(item.difficulty)}</span><small class="${!themeGoal?.complete && targetBiomes.includes(item.biome) ? 'expedition-map__weekly-tag' : ''}">${!themeGoal?.complete && targetBiomes.includes(item.biome) ? '本周研究目标 · ' : ''}${escapeHtml(item.ecologyPreview?.rareTrace || '未知伙伴踪迹')} · 两章各 15 层</small></span>
                        </button>`).join('')}</div>
                </section>
                ${dojoStatus ? `<section class="expedition-map__prep expedition-map__dojo-prep"><details class="expedition-map__dojo-roster" ${!compactLayout || dojoRosterExpanded ? 'open' : ''}><summary><span><strong>道馆挑战阵容</strong><small>${escapeHtml(dojoRosterSummary)}</small></span><span class="expedition-map__dojo-toggle">调整阵容</span></summary><div class="expedition-map__section"><h2>道馆挑战阵容</h2>${pets.length ? `<div class="expedition-map__pet-list">${pets.map(item => { const order = dojoSelectionIds.indexOf(item.id) + 1; return `<button class="expedition-map__pet ${order ? 'is-selected' : ''}" data-dojo-pet-id="${escapeHtml(item.id)}" type="button">${petArt(item)}<strong>${escapeHtml(item.name || '未命名伙伴')}</strong>${order ? dojoPetSummary(item, order) : `<small>${escapeHtml(item.expeditionPreview?.speciesSpecialty?.name || stageLabel(item.stage))}</small>`}</button>`; }).join('')}</div><p class="expedition-map__rename-note">按“出战 1 至 3”依次上场；倒下后将自动换下一只。取消并重新选择即可调整顺序。</p>` : '<div class="expedition-map__empty">需要 3 只在家的伙伴才可挑战。</div>'}</div></details><aside class="expedition-map__launch expedition-map__dojo-launch"><h2>守护大师友好道馆</h2><p>${dojoStatus.nextFloor ? `第 ${dojoStatus.nextFloor} 层等待挑战。首通消耗 1 张挑战函；已首通楼层可自由重打，奖励减半。` : '五层首通已完成，可选择已通关楼层重打。'}</p><div class="expedition-map__dojo-floors">${[1, 2, 3, 4, 5].map(floor => `<button class="expedition-map__dojo-floor ${dojoFloorAvailable(floor) ? 'is-available' : ''} ${floor === selectedDojoFloor ? 'is-selected' : ''}" data-dojo-floor="${floor}" type="button" ${dojoFloorAvailable(floor) ? '' : 'disabled'}>${floor}F</button>`).join('')}</div><button class="expedition-map__start" id="mhDojoStart" type="button" ${dojoReady ? '' : 'disabled'}>进入道馆挑战</button></aside></section>` : ''}
                <section class="expedition-map__prep expedition-map__pet-prep">
                    <div class="expedition-map__section"><h2>选择出战伙伴</h2>${pets.length ? `<div class="expedition-map__pet-list">${pets.map(item => `
                        <button class="expedition-map__pet ${item.id === selectedPetId ? 'is-selected' : ''}" data-pet-id="${escapeHtml(item.id)}" type="button">${item.id === selectedPetId ? '<span class="expedition-map__pet-role">出战</span>' : ''}${petArt(item)}<strong>${escapeHtml(item.name || '未命名伙伴')}</strong><small>${escapeHtml(item.expeditionPreview?.speciesSpecialty?.icon || '')} ${escapeHtml(item.expeditionPreview?.speciesSpecialty?.name || stageLabel(item.stage))}<br>${escapeHtml(expeditionPetBenefit(item))}<br><span class="expedition-map__pet-readiness ${expeditionPetReadiness(item).needsCare ? 'is-low' : ''}">${escapeHtml(expeditionPetReadiness(item).label)}</span></small></button>`).join('')}</div><p class="expedition-map__rename-note">伙伴会依物种倾向携带远征专精；体力不足时建议先照料，战力、魔法和幸运的实际收益可在右侧比较。</p>` : '<div class="expedition-map__empty">当前没有在家的可出战伙伴。请先让伙伴回到星球，再开始探险。</div>'}</div>
                    <aside class="expedition-map__launch"><h2>${escapeHtml(expedition?.name || '今日探索已完成')}</h2><p>${expedition ? (pet ? (petReadiness.needsCare ? `${escapeHtml(pet.name || '伙伴')} 当前体力 ${petReadiness.energy}/100，建议先回家照料；也可以继续出发。` : `${escapeHtml(pet.name || '伙伴')} 体力充足，准备进入 ${escapeHtml(expedition.biome)}。`) : '选择一只在家的伙伴后即可出发。') : '今天的三颗星球均已记录为已探索，明天再来查看新的星图。'}</p><div class="expedition-map__brief-grid">${preview?.speciesSpecialty ? `<div class="expedition-map__brief-item"><span class="expedition-map__brief-icon">${escapeHtml(preview.speciesSpecialty.icon)}</span><span>物种专精</span><strong>${escapeHtml(preview.speciesSpecialty.name)}</strong></div>` : ''}${expedition ? `<div class="expedition-map__brief-item"><span class="expedition-map__brief-icon">◈</span><span>伙伴踪迹</span><strong>${escapeHtml(ecology.rareTrace || '未知踪迹')}</strong></div><div class="expedition-map__brief-item"><span class="expedition-map__brief-icon">◆</span><span>矿脉信号</span><strong>${escapeHtml(ecology.mineralSignal || '信号微弱')}</strong></div><div class="expedition-map__brief-item"><span class="expedition-map__brief-icon">↗</span><span>路线事件</span><strong>${escapeHtml(ecology.eventFeature || '常规事件')}</strong></div>` : ''}${preview ? `${expeditionBenefitItems(preview)}<div class="expedition-map__brief-item is-detail"><span class="expedition-map__brief-icon">⚔</span><span>攻击增幅</span><strong>${Math.max(0, Number(preview.baseAttack) || 0)} → ${Math.max(0, Number(preview.attack) || 0)}</strong></div><div class="expedition-map__brief-item is-detail"><span class="expedition-map__brief-icon">◉</span><span>星图压力</span><strong>${Math.max(0, Number(preview.adaptiveThreat?.percent) || 0) ? `+${Math.max(0, Number(preview.adaptiveThreat?.percent) || 0)}%` : '标准'}</strong></div><div class="expedition-map__brief-item is-detail"><span class="expedition-map__brief-icon">✦</span><span>材料掉落</span><strong>+${Math.max(0, Number(preview.lootPercent) || 0)}%</strong></div>${preview.preparationCharges ? `<div class="expedition-map__brief-item is-detail"><span class="expedition-map__brief-icon">◌</span><span>路线芯片</span><strong>${preview.preparationCharges}/3</strong></div>` : ''}` : ''}</div></aside>
                </section>
                ${history.length ? `<section class="expedition-map__history"><h2>最近远征记录</h2><div class="expedition-map__history-list">${history.map((item, index) => { const completed = item?.completed === true; const contribution = item?.mineralContribution || {}; const museum = completed && (Number(contribution.attackPercent) || Number(contribution.lootPercent) || Number(contribution.bonusLootCount)) ? ` · 博物馆 +${Math.max(0, Number(contribution.bonusLootCount) || 0)} 材料` : ''; const progress = formatExpeditionHistoryProgress(item); const loot = Math.max(0, Number(item.lootCount) || 0); const captures = Math.max(0, Number(item.captureCount) || 0); const summary = [item.petName || '出战伙伴', item.expeditionName || item.expeditionId || '未知星图', progress, completed ? `材料 ${loot}${museum} · 伙伴 ${captures}` : '未带回战利品'].join(' · '); const time = Number(item.finishedAt) ? new Date(item.finishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; const detailId = `mhExpeditionHistoryDetail${index}`; return `<button class="expedition-map__history-row" data-expedition-history="${escapeHtml(String(item.runId || item.finishedAt || 'history'))}" type="button" title="${escapeHtml(summary)}" aria-expanded="false" aria-controls="${detailId}"><span class="expedition-map__history-state ${completed ? 'is-complete' : 'is-failed'}">${completed ? '完成' : '失败'}</span><span class="expedition-map__history-copy">${escapeHtml(summary)}</span><time class="expedition-map__history-time">${escapeHtml(time)}</time></button><div class="expedition-map__history-detail" id="${detailId}" hidden><span><small>远征结果</small><strong>${completed ? '正式返航' : '未完成'}</strong></span><span><small>路线进度</small><strong>${escapeHtml(progress)}</strong></span><span><small>返航收获</small><strong>${loot} 份材料 · ${captures} 位伙伴</strong></span><span><small>返航时间</small><strong>${escapeHtml(time || '未记录')}</strong></span></div>`; }).join('')}</div></section>` : ''}
                <div class="expedition-map__launch-dock"><div class="expedition-map__launch-summary"><strong>${expedition ? `前往 <b>${escapeHtml(expedition.name)}</b>` : '今日探索已完成'}</strong><small>${pet ? `出战：${escapeHtml(pet.name || '伙伴')} · 体力 ${petReadiness.energy}/100${petReadiness.needsCare ? '，建议先照料' : ''}` : '尚未选择出战伙伴'} · ${supportPets.length ? `支援：${supportPets.map(item => escapeHtml(item.name || '伙伴')).join('、')}` : '未选择支援伙伴'}</small></div><button class="expedition-map__start" data-expedition-launch type="button" ${expedition && pet ? '' : 'disabled'}>${expedition && pet ? '开始探险' : '请选择出战伙伴'}</button></div>
            </main>`;
        const petSection = panel.querySelector('.expedition-map__pet-prep .expedition-map__section');
        if (petSection && pets.length) {
            petSection.insertAdjacentHTML('beforeend', `<h2 style="margin-top:16px">选择支援伙伴 <small style="font-weight:500;color:var(--text-muted,#64748b)">最多 2 名，不参与战斗</small></h2><div class="expedition-map__pet-list">${pets.map(item => { const supportOrder = selectedSupportPetIds.indexOf(item.id) + 1; return `<button class="expedition-map__pet ${supportOrder ? 'is-selected' : ''}" data-support-pet-id="${escapeHtml(item.id)}" type="button" ${item.id === selectedPetId || item.isDispatching ? 'disabled' : ''}>${supportOrder ? `<span class="expedition-map__pet-role">支援 ${supportOrder}</span>` : ''}${petArt(item)}<strong>${escapeHtml(item.name || '未命名伙伴')}</strong><small>${escapeHtml(item.expeditionPreview?.speciesSpecialty?.icon || '')} ${escapeHtml(item.expeditionPreview?.speciesSpecialty?.name || stageLabel(item.stage))}<br>${escapeHtml(item.expeditionPreview?.speciesSpecialty?.investigationRole || '常规支援')}</small></button>`; }).join('')}</div>${supportRoutePlan ? `<p class="expedition-map__rename-note"><strong>${escapeHtml(supportRoutePlan.label)}</strong><br>收益：${escapeHtml(supportRoutePlan.benefit)}<br>代价：${escapeHtml(supportRoutePlan.cost)}</p>` : ''}`);
        }
        const petPrep = panel.querySelector('.expedition-map__pet-prep');
        const dojoPrep = panel.querySelector('.expedition-map__dojo-prep');
        if (petPrep && dojoPrep) dojoPrep.before(petPrep);
        const dojoRoster = panel.querySelector('.expedition-map__dojo-roster');
        if (dojoRoster) dojoRoster.ontoggle = () => { dojoRosterExpanded = dojoRoster.open; };
        panel.querySelector('#mhExpeditionBack').onclick = () => onBack?.();
        panel.querySelectorAll('[data-investigation-branch]').forEach(button => {
            button.onclick = () => {
                const result = onChooseInvestigationBranch?.(button.dataset.investigationBranch);
                if (result?.applied) {
                    investigationProgress = result.progress;
                    render();
                }
            };
        });
        const confrontationButton = panel.querySelector('#mhInvestigationConfrontation');
        if (confrontationButton) {
            confrontationButton.disabled = !pet;
            confrontationButton.onclick = () => pet && onLaunchConfrontation?.(pet);
        }
        const discoverSideCaseButton = panel.querySelector('#mhDiscoverSectorSideCase');
        if (discoverSideCaseButton) discoverSideCaseButton.onclick = () => {
            const result = onDiscoverSectorSideCase?.();
            if (result?.applied) {
                sectorEventProgress = result.progress;
                render();
            }
        };
        panel.querySelectorAll('[data-sector-side-choice]').forEach(button => {
            button.onclick = () => {
                const result = onChooseSectorSideCase?.(button.dataset.sectorSideChoice);
                if (result?.applied) {
                    sectorEventProgress = result.progress;
                    render();
                }
            };
        });
        const sectorFinaleButton = panel.querySelector('#mhSectorFinale');
        if (sectorFinaleButton) {
            sectorFinaleButton.disabled = !pet;
            sectorFinaleButton.onclick = () => pet && onLaunchSectorFinale?.(pet);
        }
        const resetButton = panel.querySelector('#mhExpeditionReset');
        if (resetButton) {
            resetButton.onclick = async () => {
                resetButton.disabled = true;
                resetButton.textContent = '正在重置...';
                try { await onResetToday(); } finally { resetButton.disabled = false; }
            };
        }
        panel.querySelectorAll('[data-pet-id]').forEach(button => {
            const item = pets.find(pet => pet.id === button.dataset.petId);
            if (!item?.isDispatching) return;
            button.classList.add('is-dispatching');
            button.disabled = true;
            const stage = button.querySelector('small');
            if (stage) stage.textContent = '勘探中';
        });
        panel.querySelectorAll('[data-dojo-pet-id]').forEach(button => {
            const item = pets.find(pet => pet.id === button.dataset.dojoPetId);
            if (!item || item.isDispatching) {
                button.disabled = true;
                return;
            }
            button.onclick = () => {
                const id = item.id;
                dojoSelectionIds = dojoSelectionIds.includes(id)
                    ? dojoSelectionIds.filter(selectedId => selectedId !== id)
                    : dojoSelectionIds.length < 3 ? [...dojoSelectionIds, id] : dojoSelectionIds;
                render();
            };
        });
        panel.querySelectorAll('[data-dojo-floor]').forEach(button => {
            button.onclick = () => {
                selectedDojoFloor = Number(button.dataset.dojoFloor) || 0;
                render();
            };
        });
        panel.querySelectorAll('[data-expedition-id]').forEach(button => {
            button.onclick = () => {
                const nextExpedition = expeditions.find(item => item.id === button.dataset.expeditionId && !item.explored);
                if (!nextExpedition) return;
                selectedExpeditionId = nextExpedition.id;
                render();
            };
        });
        panel.querySelectorAll('[data-pet-id]').forEach(button => {
            button.onclick = () => {
                if (button.disabled) return;
                selectedPetId = button.dataset.petId;
                selectedSupportPetIds = selectedSupportPetIds.filter(id => id !== selectedPetId);
                render();
            };
        });
        panel.querySelectorAll('[data-support-pet-id]').forEach(button => {
            button.onclick = () => {
                if (button.disabled) return;
                const id = button.dataset.supportPetId;
                selectedSupportPetIds = selectedSupportPetIds.includes(id)
                    ? selectedSupportPetIds.filter(selectedId => selectedId !== id)
                    : selectedSupportPetIds.length < 2 ? [...selectedSupportPetIds, id] : selectedSupportPetIds;
                render();
            };
        });
        panel.querySelectorAll('[data-expedition-launch]').forEach(button => {
            button.onclick = () => {
                if (expedition && pet) onLaunch?.(expedition, pet, supportPets);
            };
        });
        const dojoStart = panel.querySelector('#mhDojoStart');
        if (dojoStart) dojoStart.onclick = () => {
            if (dojoReady) onLaunchDojo?.(dojoPets, selectedDojoFloor);
        };
        panel.querySelectorAll('[data-expedition-history]').forEach(button => {
            button.onclick = () => {
                const detail = panel.querySelector(`#${button.getAttribute('aria-controls')}`);
                const expanded = button.getAttribute('aria-expanded') !== 'true';
                button.setAttribute('aria-expanded', String(expanded));
                if (detail) detail.hidden = !expanded;
                if (expanded) onReviewHistory?.(button.dataset.expeditionHistory);
            };
        });
    };
    render();
}