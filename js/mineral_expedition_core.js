export const MINERAL_EXPEDITION_MAX_DEPTH = 12;

export const MINERAL_EXPEDITION_MODULES = Object.freeze({
    reinforcedClaw: Object.freeze({ id:'reinforcedClaw', name:'强化探矿爪', description:'采矿节点额外回收 1 枚原石。' }),
    resonanceDrill: Object.freeze({ id:'resonanceDrill', name:'共鸣钻头', description:'连击达到 3 时额外获得 1 点研究。' }),
    safetyAnchor: Object.freeze({ id:'safetyAnchor', name:'安全锚', description:'每次危机优先抵消 8 点矿层压力。' }),
});

export const MINERAL_EXPEDITION_ASSISTS = Object.freeze({
    sureGrip: Object.freeze({ id:'sureGrip', name:'稳手牵引', description:'采矿挑战所需命中 -1，最低 2 次。' }),
    pressureVeil: Object.freeze({ id:'pressureVeil', name:'护压场', description:'每层首次增加的压力减少 4%。' }),
    cargoSense: Object.freeze({ id:'cargoSense', name:'矿脉共感', description:'每次成功采矿额外回收 1 枚原石。' }),
    coreRhythm: Object.freeze({ id:'coreRhythm', name:'核心节律', description:'精英与主矿核挑战所需命中 -1，最低 1 次。' }),
    fieldRepair: Object.freeze({ id:'fieldRepair', name:'随行检修', description:'获得时立刻降低 10% 矿层压力。' }),
    researchEcho: Object.freeze({ id:'researchEcho', name:'回声记录', description:'每次成功矿核挑战额外获得 1 点研究。' }),
});

export const MINERAL_EXPEDITION_DIRECTIVES = Object.freeze({
    survey: Object.freeze({ id:'survey', name:'声呐勘测', description:'本层获得 1 点矿层情报，并抵消 3% 压力。' }),
    extraction: Object.freeze({ id:'extraction', name:'超载采掘', description:'成功采矿额外回收 2 枚原石，但本层压力额外 +5%。' }),
    stabilization: Object.freeze({ id:'stabilization', name:'护盾下潜', description:'进入矿层前先降低 8% 压力；本层不追求额外收益。' }),
});

export const MINERAL_EXPEDITION_EVENTS = Object.freeze({
    lostDrill: Object.freeze({ id:'lostDrill', name:'失联钻机', description:'旧钻机仍在运转，货舱与安全只能取其一。', choices:Object.freeze({ salvage:Object.freeze({ name:'接管钻机', description:'回收 4 枚原石，但压力 +12%。' }), repair:Object.freeze({ name:'拆作检修件', description:'压力 -14%，放弃钻机货物。' }) }) }),
    echoChamber: Object.freeze({ id:'echoChamber', name:'回声矿室', description:'矿壁记录着未知共鸣，选择带走价值或留下更完整的情报。', choices:Object.freeze({ record:Object.freeze({ name:'提取矿芯记录', description:'研究 +2，但压力 +6%。' }), chart:Object.freeze({ name:'绘制声呐图', description:'矿层情报 +3，保持当前压力。' }) }) }),
    abandonedCart: Object.freeze({ id:'abandonedCart', name:'废弃货轨', description:'一辆满载矿车堵在裂隙前，路线需要一次果断判断。', choices:Object.freeze({ load:Object.freeze({ name:'强行装载', description:'原石 +5，但压力 +10%。' }), bypass:Object.freeze({ name:'标记绕行', description:'矿层情报 +2，压力 -4%。' }) }) }),
});

const NODE_LIBRARY = Object.freeze({
    mine: Object.freeze({ id:'mine', name:'富集矿脉', description:'进行采矿，原石进入本次货舱。' }),
    hazard: Object.freeze({ id:'hazard', name:'失稳裂隙', description:'承担风险以寻找深层捷径。' }),
    shop: Object.freeze({ id:'shop', name:'流动补给站', description:'选择本局模块或修复矿层压力。' }),
    rest: Object.freeze({ id:'rest', name:'安全前哨', description:'修整设备，降低矿层压力。' }),
    elite: Object.freeze({ id:'elite', name:'精英矿核', description:'高风险矿核，击破后获得大量货舱。' }),
    boss: Object.freeze({ id:'boss', name:'深层主矿核', description:'本次远征的终点挑战。' }),
});

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    return Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
}

function uniqueModuleIds(moduleIds = []) {
    return [...new Set((Array.isArray(moduleIds) ? moduleIds : [])
        .map(id => String(id || ''))
        .filter(id => MINERAL_EXPEDITION_MODULES[id]))];
}

function uniqueAssistIds(assistIds = []) {
    return [...new Set((Array.isArray(assistIds) ? assistIds : [])
        .map(id => String(id || ''))
        .filter(id => MINERAL_EXPEDITION_ASSISTS[id]))];
}

function directiveId(value) {
    const id = String(value || 'survey');
    return MINERAL_EXPEDITION_DIRECTIVES[id] ? id : 'survey';
}

function expeditionEventId(depth) {
    return ['lostDrill', 'echoChamber', 'abandonedCart'][(integer(depth, 1, MINERAL_EXPEDITION_MAX_DEPTH) / 3 - 1) % 3];
}

export function expeditionAssistChoices(depth, assistIds = []) {
    const owned = new Set(uniqueAssistIds(assistIds));
    const pool = Object.keys(MINERAL_EXPEDITION_ASSISTS).filter(id => !owned.has(id));
    const start = integer(depth, 0, MINERAL_EXPEDITION_MAX_DEPTH) % Math.max(1, pool.length);
    return [...pool.slice(start), ...pool.slice(0, start)].slice(0, 3);
}

function node(id, depth, lane) {
    const template = NODE_LIBRARY[id] || NODE_LIBRARY.mine;
    return { ...template, depth, lane };
}

export function expeditionRoutes(depth) {
    const currentDepth = integer(depth, 0, MINERAL_EXPEDITION_MAX_DEPTH);
    if (currentDepth >= MINERAL_EXPEDITION_MAX_DEPTH - 1) return [node('boss', MINERAL_EXPEDITION_MAX_DEPTH, 'core')];
    if (currentDepth === 0) return [node('mine', 1, 'left'), node('hazard', 1, 'right')];
    const nextDepth = currentDepth + 1;
    const routes = [node('mine', nextDepth, 'left')];
    if (nextDepth % 4 === 0) routes.push(node('elite', nextDepth, 'right'));
    else if (nextDepth % 3 === 0) routes.push(node('shop', nextDepth, 'right'));
    else if (nextDepth % 2 === 0) routes.push(node('rest', nextDepth, 'right'));
    else routes.push(node('hazard', nextDepth, 'right'));
    return routes;
}

export function createMineralExpedition({ petId = '', petName = '哈奇伙伴', petTrait = 'steady', moduleIds = [], assistIds = [] } = {}) {
    return {
        version: 1,
        status: 'routing',
        petId: String(petId || ''),
        petName: String(petName || '哈奇伙伴'),
        petTrait: String(petTrait || 'steady'),
        depth: 0,
        pressure: 0,
        cargo: { rawStone: 0, research: 0 },
        combo: 0,
        bestCombo: 0,
        moduleIds: uniqueModuleIds(moduleIds),
        assistIds: uniqueAssistIds(assistIds),
        pendingAssistChoices: [],
        pendingEventId: '',
        directiveId: 'survey',
        intel: 0,
        history: [],
        routes: expeditionRoutes(0),
    };
}

export function normalizeMineralExpedition(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const depth = integer(source.depth, 0, MINERAL_EXPEDITION_MAX_DEPTH);
    const status = ['routing', 'cleared', 'withdrawn', 'collapsed'].includes(source.status) ? source.status : 'routing';
    const expedition = createMineralExpedition(source);
    expedition.status = status;
    expedition.depth = depth;
    expedition.pressure = integer(source.pressure, 0, 100);
    expedition.cargo = {
        rawStone: integer(source.cargo?.rawStone, 0, 99),
        research: integer(source.cargo?.research, 0, 99),
    };
    expedition.combo = integer(source.combo, 0, 99);
    expedition.bestCombo = Math.max(expedition.combo, integer(source.bestCombo, 0, 99));
    expedition.moduleIds = uniqueModuleIds(source.moduleIds);
    expedition.assistIds = uniqueAssistIds(source.assistIds);
    expedition.pendingAssistChoices = (Array.isArray(source.pendingAssistChoices) ? source.pendingAssistChoices : [])
        .map(id => String(id || '')).filter(id => MINERAL_EXPEDITION_ASSISTS[id] && !expedition.assistIds.includes(id)).slice(0, 3);
    expedition.pendingEventId = MINERAL_EXPEDITION_EVENTS[source.pendingEventId] ? source.pendingEventId : '';
    expedition.directiveId = directiveId(source.directiveId);
    expedition.intel = integer(source.intel, 0, 99);
    expedition.history = (Array.isArray(source.history) ? source.history : []).slice(-24)
        .map(entry => ({ depth:integer(entry?.depth, 0, MINERAL_EXPEDITION_MAX_DEPTH), nodeId:String(entry?.nodeId || ''), outcome:String(entry?.outcome || '') }));
    expedition.routes = status === 'routing' ? expeditionRoutes(depth) : [];
    return expedition;
}

function hasModule(expedition, moduleId) {
    return expedition.moduleIds.includes(moduleId);
}

function hasAssist(expedition, assistId) {
    return expedition.assistIds.includes(assistId);
}

function withHistory(expedition, selectedNode, outcome) {
    expedition.history.push({ depth:expedition.depth, nodeId:selectedNode.id, outcome });
    expedition.history = expedition.history.slice(-24);
    expedition.routes = expedition.status === 'routing' ? expeditionRoutes(expedition.depth) : [];
    return expedition;
}

export function resolveMineralExpeditionNode(state, nodeId, { success = true, shopChoice = '', hazardChoice = 'force' } = {}) {
    const expedition = normalizeMineralExpedition(state);
    if (expedition.status !== 'routing') return { expedition, changed:false, report:'本次远征已结束。' };
    if (expedition.pendingEventId) return { expedition, changed:false, report:'请先处理当前矿层异常。' };
    if (expedition.pendingAssistChoices.length) return { expedition, changed:false, report:'请先回应伙伴协助协议。' };
    const selectedNode = expedition.routes.find(route => route.id === nodeId);
    if (!selectedNode) return { expedition, changed:false, report:'请选择当前可见的矿层路线。' };

    expedition.depth = selectedNode.depth;
    const directive = MINERAL_EXPEDITION_DIRECTIVES[expedition.directiveId];
    if (directive.id === 'stabilization') expedition.pressure = integer(expedition.pressure - 8, 0, 100);
    if (directive.id === 'survey') {
        expedition.intel += 1;
        expedition.pressure = integer(expedition.pressure - 3, 0, 100);
    }
    let report = '';
    if (selectedNode.id === 'mine') {
        const traitBonus = expedition.petTrait === 'miner' ? 1 : 0;
        const moduleBonus = hasModule(expedition, 'reinforcedClaw') ? 1 : 0;
        const assistBonus = success && hasAssist(expedition, 'cargoSense') ? 1 : 0;
        const directiveBonus = success && directive.id === 'extraction' ? 2 : 0;
        const gained = 2 + traitBonus + moduleBonus + assistBonus + directiveBonus + (success ? 1 : 0);
        expedition.cargo.rawStone += gained;
        expedition.combo = success ? expedition.combo + 1 : 0;
        expedition.bestCombo = Math.max(expedition.bestCombo, expedition.combo);
        if (hasModule(expedition, 'resonanceDrill') && expedition.combo >= 3) expedition.cargo.research += 1;
        report = `回收 ${gained} 枚原石，货舱正在变重。`;
    } else if (selectedNode.id === 'hazard') {
        const shield = hasModule(expedition, 'safetyAnchor') ? 8 : 0;
        const stabilize = hazardChoice === 'stabilize';
        const pressure = stabilize ? 4 : success ? 8 : 22;
        const assistShield = hasAssist(expedition, 'pressureVeil') ? 4 : 0;
        expedition.pressure = integer(expedition.pressure + Math.max(0, pressure - shield - assistShield), 0, 100);
        expedition.cargo.rawStone += !stabilize && success ? 2 : 0;
        expedition.combo = 0;
        report = stabilize ? '稳定穿过裂隙，没有冒险搜寻隐藏矿脉。' : success ? '强行穿过裂隙并发现隐藏原石。' : '强行穿越失败，矿层剧烈失稳。';
    } else if (selectedNode.id === 'rest') {
        expedition.pressure = integer(expedition.pressure - 18, 0, 100);
        expedition.combo = 0;
        report = '设备完成检修，矿层压力下降。';
    } else if (selectedNode.id === 'shop') {
        if (MINERAL_EXPEDITION_MODULES[shopChoice] && !hasModule(expedition, shopChoice)) {
            expedition.moduleIds.push(shopChoice);
            report = `装配了${MINERAL_EXPEDITION_MODULES[shopChoice].name}。`;
        } else {
            expedition.pressure = integer(expedition.pressure - 12, 0, 100);
            report = '补给站完成了应急维护。';
        }
    } else if (selectedNode.id === 'elite' || selectedNode.id === 'boss') {
        const required = selectedNode.id === 'boss' ? 3 : 2;
        if (success) {
            expedition.cargo.rawStone += selectedNode.id === 'boss' ? 8 : 5;
            expedition.cargo.research += 2 + (hasAssist(expedition, 'researchEcho') ? 1 : 0);
            expedition.pressure = integer(expedition.pressure + Math.max(0, 12 - (hasAssist(expedition, 'pressureVeil') ? 4 : 0)), 0, 100);
            report = `${selectedNode.name}已击破，获得高价值货舱。`;
        } else {
            expedition.pressure = integer(expedition.pressure + required * 14, 0, 100);
            report = `${selectedNode.name}反冲，矿层压力急剧上升。`;
        }
        if (selectedNode.id === 'boss' && success) expedition.status = 'cleared';
    }
    if (directive.id === 'extraction') expedition.pressure = integer(expedition.pressure + 5, 0, 100);
    expedition.directiveId = 'survey';
    if (expedition.pressure >= 100) {
        expedition.status = 'collapsed';
        expedition.cargo.rawStone = Math.floor(expedition.cargo.rawStone * .45);
        expedition.cargo.research = Math.floor(expedition.cargo.research * .5);
        report = '矿层坍塌，只带回了部分货舱。';
    }
    if (expedition.status === 'routing' && expedition.depth % 3 === 0 && expedition.depth < MINERAL_EXPEDITION_MAX_DEPTH) {
        expedition.pendingEventId = expeditionEventId(expedition.depth);
        report += ` 深处传来异常信号：${MINERAL_EXPEDITION_EVENTS[expedition.pendingEventId].name}。`;
    } else if (expedition.status === 'routing' && !expedition.pendingAssistChoices.length) {
        expedition.pendingAssistChoices = expeditionAssistChoices(expedition.depth, expedition.assistIds);
        if (expedition.pendingAssistChoices.length) report += ' 伙伴发现新的协助协议。';
    }
    return { expedition:withHistory(expedition, selectedNode, success ? 'success' : 'fail'), changed:true, report };
}

export function chooseMineralExpeditionDirective(state, selectedDirectiveId) {
    const expedition = normalizeMineralExpedition(state);
    const id = directiveId(selectedDirectiveId);
    if (expedition.status !== 'routing' || expedition.pendingEventId || expedition.pendingAssistChoices.length || !MINERAL_EXPEDITION_DIRECTIVES[id]) {
        return { expedition, changed:false, report:'当前无法调整深潜指令。' };
    }
    expedition.directiveId = id;
    return { expedition, changed:true, report:`本层指令已切换为：${MINERAL_EXPEDITION_DIRECTIVES[id].name}。` };
}

export function resolveMineralExpeditionEvent(state, choiceId) {
    const expedition = normalizeMineralExpedition(state);
    const event = MINERAL_EXPEDITION_EVENTS[expedition.pendingEventId];
    const choice = event?.choices[String(choiceId || '')];
    if (expedition.status !== 'routing' || !event || !choice) return { expedition, changed:false, report:'当前没有可处理的矿层异常。' };
    if (event.id === 'lostDrill') {
        if (choiceId === 'salvage') { expedition.cargo.rawStone += 4; expedition.pressure = integer(expedition.pressure + 12, 0, 100); }
        else expedition.pressure = integer(expedition.pressure - 14, 0, 100);
    } else if (event.id === 'echoChamber') {
        if (choiceId === 'record') { expedition.cargo.research += 2; expedition.pressure = integer(expedition.pressure + 6, 0, 100); }
        else expedition.intel += 3;
    } else if (event.id === 'abandonedCart') {
        if (choiceId === 'load') { expedition.cargo.rawStone += 5; expedition.pressure = integer(expedition.pressure + 10, 0, 100); }
        else { expedition.intel += 2; expedition.pressure = integer(expedition.pressure - 4, 0, 100); }
    }
    expedition.pendingEventId = '';
    if (expedition.pressure >= 100) {
        expedition.status = 'collapsed';
        expedition.cargo.rawStone = Math.floor(expedition.cargo.rawStone * .45);
        expedition.cargo.research = Math.floor(expedition.cargo.research * .5);
        return { expedition:withHistory(expedition, { id:event.id }, 'collapsed'), changed:true, report:'异常处置引发矿层坍塌，只带回了部分货舱。' };
    }
    expedition.pendingAssistChoices = expeditionAssistChoices(expedition.depth, expedition.assistIds);
    return { expedition:withHistory(expedition, { id:event.id }, choiceId), changed:true, report:`${event.name}已处理：${choice.name}。${expedition.pendingAssistChoices.length ? ' 伙伴提出了新的协助协议。' : ''}` };
}

export function chooseMineralExpeditionAssist(state, assistId) {
    const expedition = normalizeMineralExpedition(state);
    const selectedId = String(assistId || '');
    if (expedition.status !== 'routing' || !expedition.pendingAssistChoices.includes(selectedId)) {
        return { expedition, changed:false, report:'请选择当前伙伴提供的协助协议。' };
    }
    expedition.assistIds.push(selectedId);
    expedition.pendingAssistChoices = [];
    if (selectedId === 'fieldRepair') expedition.pressure = integer(expedition.pressure - 10, 0, 100);
    return { expedition, changed:true, report:`${MINERAL_EXPEDITION_ASSISTS[selectedId].name}已加入本次远征。` };
}

export function withdrawMineralExpedition(state) {
    const expedition = normalizeMineralExpedition(state);
    if (expedition.status !== 'routing') return { expedition, changed:false, report:'本次远征已结束。' };
    expedition.status = 'withdrawn';
    expedition.routes = [];
    return { expedition, changed:true, report:`在第 ${expedition.depth} 层撤离，货舱已安全回收。` };
}