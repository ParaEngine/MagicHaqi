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

export const ProtocolRegistry = Object.freeze({
    highPressureDrill: Object.freeze({ id:'highPressureDrill', name:'高压钻头', type:'demolition', description:'每次推进的不稳定度增长提高 50%，换取更激进的深潜节奏。', effect:'instability_gain_150' }),
    thermalChain: Object.freeze({ id:'thermalChain', name:'热能连锁', type:'demolition', description:'不稳定度达到 60% 后，高稀有矿石发现率额外提高 15%。', effect:'high_instability_rare_bonus' }),
    prismVision: Object.freeze({ id:'prismVision', name:'棱镜视野', type:'scout', description:'选择时揭示后续 2 层的节点类型。', effect:'reveal_next_two_floors' }),
    collapseGuard: Object.freeze({ id:'collapseGuard', name:'规避直觉', type:'scout', description:'首次坍塌时保护当前全部货物，触发后失效。', effect:'protect_collapse_once' }),
    beaconRelay: Object.freeze({ id:'beaconRelay', name:'信标中继', type:'scout', description:'失落信标挑战失败时额外回收一半遗失货物。', effect:'boost_beacon_partial_recovery' }),
    isotopeCopy: Object.freeze({ id:'isotopeCopy', name:'同位素复制', type:'resonance', description:'发现高稀有矿石时有 35% 概率复制 1 枚并直接放入已封装货舱。', effect:'copy_rare_to_secured' }),
    resonanceBuffer: Object.freeze({ id:'resonanceBuffer', name:'共振缓冲', type:'resonance', description:'成功获得货物时额外降低 2% 不稳定度。', effect:'stabilize_on_loot' }),
    safetyAirbag: Object.freeze({ id:'safetyAirbag', name:'安全气囊', type:'extraction', description:'每次推进的不稳定度增长降低 30%。', effect:'instability_gain_70' }),
    smugglerCompartment: Object.freeze({ id:'smugglerCompartment', name:'走私暗格', type:'extraction', description:'进入撤离节点时额外获得 1 点研究线索。', effect:'evacuation_research_bonus' }),
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
    explore: Object.freeze({ type:'explore', name:'声呐勘探', description:'预览矿层信号，以较低风险积累情报。' }),
    drill: Object.freeze({ type:'drill', name:'富集钻探', description:'开采当前矿脉，矿石进入本次货舱。' }),
    combat: Object.freeze({ type:'combat', name:'矿兽遭遇', description:'击退矿区生物，争夺高价值矿脉。' }),
    event: Object.freeze({ type:'event', name:'异常事件', description:'处理未知信号，结果可能改变收益与风险。' }),
    protocol_cache: Object.freeze({ type:'protocol_cache', name:'协议缓存', description:'从废弃终端中选择一项本局协议。' }),
    beacon: Object.freeze({ type:'beacon', name:'失落信标', description:'追踪上次坍塌留下的信号，夺回遗失货舱。' }),
    evacuate: Object.freeze({ type:'evacuate', name:'撤离升降梯', description:'结束本次深潜，安全结算全部货舱。' }),
    mine: Object.freeze({ id:'mine', name:'富集矿脉', description:'进行采矿，原石进入本次货舱。' }),
    hazard: Object.freeze({ id:'hazard', name:'失稳裂隙', description:'承担风险以寻找深层捷径。' }),
    shop: Object.freeze({ id:'shop', name:'流动补给站', description:'选择本局模块或修复矿层压力。' }),
    rest: Object.freeze({ id:'rest', name:'安全前哨', description:'修整设备，降低矿层压力。' }),
    elite: Object.freeze({ id:'elite', name:'精英矿核', description:'高风险矿核，击破后获得大量货舱。' }),
    boss: Object.freeze({ id:'boss', name:'深层主矿核', description:'本次远征的终点挑战。' }),
});

const MINE_ROUTE_TYPES = Object.freeze(['explore', 'drill', 'combat', 'event', 'shop', 'protocol_cache']);

function seededRandom(seed) {
    let state = integer(seed, 1, 0x7fffffff) || 1;
    return () => {
        state = (state * 48271) % 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function mineRouteNode(type, depth, lane, index) {
    const template = NODE_LIBRARY[type] || NODE_LIBRARY.explore;
    return {
        id:`mine-${depth}-${lane}-${type}-${index}`,
        type,
        depth,
        lane,
        name:template.name,
        description:template.description,
        risk:type === 'combat' || type === 'event' ? 'high' : type === 'drill' ? 'medium' : 'low',
        nextNodeIds:[],
    };
}

export function generateMineRoute({ depth = MINERAL_EXPEDITION_MAX_DEPTH, seed = Date.now(), lostBeacon = null } = {}) {
    const maxDepth = integer(depth, 1, MINERAL_EXPEDITION_MAX_DEPTH);
    const random = seededRandom(seed);
    const layers = [];
    for (let floor = 1; floor <= maxDepth; floor += 1) {
        let nodes;
        if (floor <= 4 || [6, 7, 10, 11].includes(floor)) {
            nodes = [mineRouteNode('drill', floor, 'center', 0)];
        } else if (floor === maxDepth) {
            nodes = [mineRouteNode('boss', floor, 'core', 0)];
            if (floor === MINERAL_EXPEDITION_MAX_DEPTH) nodes.push(mineRouteNode('evacuate', floor, 'exit', 1));
        } else {
            const firstIndex = Math.floor(random() * MINE_ROUTE_TYPES.length);
            let secondIndex = Math.floor(random() * MINE_ROUTE_TYPES.length);
            if (secondIndex === firstIndex) secondIndex = (secondIndex + 1) % MINE_ROUTE_TYPES.length;
            nodes = [
                mineRouteNode(MINE_ROUTE_TYPES[firstIndex], floor, 'left', 0),
                mineRouteNode(MINE_ROUTE_TYPES[secondIndex], floor, 'right', 1),
            ];
            if (floor === 4 || floor === 8) nodes.push(mineRouteNode('evacuate', floor, 'exit', 2));
        }
        if (floor === 2 && normalizeLostBeacon(lostBeacon)) nodes.push(mineRouteNode('beacon', floor, 'beacon', nodes.length));
        layers.push(nodes);
    }
    layers.forEach((nodes, index) => {
        const nextNodeIds = layers[index + 1]?.map(node => node.id) || [];
        nodes.forEach(node => { node.nextNodeIds = [...nextNodeIds]; });
    });
    return layers;
}

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

function uniqueProtocolIds(protocolIds = []) {
    return [...new Set((Array.isArray(protocolIds) ? protocolIds : [])
        .map(id => String(id || ''))
        .filter(id => ProtocolRegistry[id] || MINERAL_EXPEDITION_ASSISTS[id]))];
}

function hasProtocolEffect(expedition, effect) {
    return expedition.activeProtocols.some(id => ProtocolRegistry[id]?.effect === effect);
}

export function generateProtocolChoices(runState = {}, { random = Math.random, count = 3 } = {}) {
    const owned = new Set(uniqueProtocolIds(runState?.activeProtocols));
    const pool = Object.keys(ProtocolRegistry).filter(id => !owned.has(id));
    const choices = [];
    while (pool.length && choices.length < integer(count, 1, 3)) {
        const index = Math.min(pool.length - 1, Math.floor(Math.max(0, Number(random()) || 0) * pool.length));
        choices.push(pool.splice(index, 1)[0]);
    }
    return choices;
}

function directiveId(value) {
    const id = String(value || 'survey');
    return MINERAL_EXPEDITION_DIRECTIVES[id] ? id : 'survey';
}

function loot(value = {}, limits = {}) {
    return {
        rawStone:integer(value?.rawStone, 0, limits.rawStone ?? 99),
        research:integer(value?.research, 0, limits.research ?? 99),
        rareStone:integer(value?.rareStone, 0, limits.rareStone ?? 99),
    };
}

export function normalizeLostBeacon(value) {
    if (!value || typeof value !== 'object') return null;
    const cargo = loot(value.cargo);
    if (!cargo.rawStone && !cargo.research && !cargo.rareStone) return null;
    const beacon = { cargo, sourceDepth:integer(value.sourceDepth, 0, MINERAL_EXPEDITION_MAX_DEPTH) };
    const recoveryProgress = integer(value.recoveryProgress, 0, 99);
    if (recoveryProgress) beacon.recoveryProgress = recoveryProgress;
    return beacon;
}

function expeditionHighlight(value) {
    const type = String(value?.type || '');
    if (!['cargo_guarded', 'beacon_recovered', 'beacon_partial'].includes(type)) return null;
    return {
        type,
        depth:integer(value?.depth, 0, MINERAL_EXPEDITION_MAX_DEPTH),
        petName:String(value?.petName || '哈奇伙伴').slice(0, 40),
        cargo:loot(value?.cargo),
    };
}

function appendHighlight(expedition, type, cargo) {
    expedition.highlights.push({ type, depth:expedition.currentFloor, petName:expedition.petName, cargo:loot(cargo) });
    expedition.highlights = expedition.highlights.slice(-8);
}

function proportionalLoot(cargo, ratio) {
    return loot({
        rawStone:Math.ceil(cargo.rawStone * ratio),
        research:Math.ceil(cargo.research * ratio),
        rareStone:Math.ceil(cargo.rareStone * ratio),
    });
}

function subtractLoot(cargo, removed) {
    return loot({
        rawStone:cargo.rawStone - removed.rawStone,
        research:cargo.research - removed.research,
        rareStone:cargo.rareStone - removed.rareStone,
    });
}

export function expeditionBuilds(runState = {}, additionalProtocolId = '') {
    const protocolIds = uniqueProtocolIds([...(runState?.activeProtocols || []), additionalProtocolId]);
    const effects = new Set(protocolIds.map(id => ProtocolRegistry[id]?.effect).filter(Boolean));
    const definitions = [
        { id:'high_pressure', name:'高压采掘', color:'#ff8a66', effects:['instability_gain_150', 'high_instability_rare_bonus'], description:'以更快的失稳换取高稀有矿石爆发。' },
        { id:'safe_storage', name:'安全封装', color:'#72e2b0', effects:['instability_gain_70', 'protect_collapse_once'], description:'压低失稳增长，并保住一次完整货舱。' },
        { id:'beacon_hunter', name:'信标猎手', color:'#72cfff', effects:['reveal_next_two_floors', 'boost_beacon_partial_recovery'], description:'提前揭示路线，失败时也能追回更多信标货物。' },
    ];
    return definitions.map(definition => {
        const matched = definition.effects.filter(effect => effects.has(effect)).length;
        return { ...definition, matched, required:definition.effects.length, active:matched === definition.effects.length };
    }).filter(build => build.matched > 0).sort((left, right) => Number(right.active) - Number(left.active) || right.matched - left.matched);
}

function lostCargo(cargo, securedLoot) {
    return loot({
        rawStone:Math.max(0, cargo.rawStone - securedLoot.rawStone),
        research:Math.max(0, cargo.research - securedLoot.research),
        rareStone:Math.max(0, cargo.rareStone - securedLoot.rareStone),
    });
}

export function mineRiskAt(instability) {
    const value = integer(instability, 0, 100);
    return {
        rareDropChance:Math.min(.35, .05 + value * .003),
        collapseChance:value < 40 ? 0 : Math.min(.25, (value - 35) * .004),
    };
}

function nodeInstabilityGain(expedition, type, success) {
    let gain = {
        explore:4,
        drill:success ? 9 : 15,
        combat:success ? 16 : 28,
        event:success ? 12 : 22,
        shop:3,
        boss:success ? 20 : 35,
        protocol_cache:6,
        beacon:0,
        evacuate:0,
    }[type] ?? 8;
    if (hasProtocolEffect(expedition, 'instability_gain_150')) gain *= 1.5;
    if (hasProtocolEffect(expedition, 'instability_gain_70')) gain *= .7;
    gain = Math.round(gain);
    return type === 'shop' ? gain - 10 : gain;
}

export function nodeRiskPreview(state, node) {
    const expedition = normalizeMineralExpedition(state);
    const type = String(node?.type || node || '');
    const successDelta = nodeInstabilityGain(expedition, type, true);
    const failureDelta = nodeInstabilityGain(expedition, type, false);
    const minDelta = Math.min(successDelta, failureDelta);
    const maxDelta = Math.max(successDelta, failureDelta);
    const minInstability = integer(expedition.instability + minDelta, 0, 100);
    const maxInstability = integer(expedition.instability + maxDelta, 0, 100);
    return {
        minDelta,
        maxDelta,
        minInstability,
        maxInstability,
        minCollapseChance:mineRiskAt(minInstability).collapseChance,
        maxCollapseChance:mineRiskAt(maxInstability).collapseChance,
    };
}

function syncRunStateAliases(expedition) {
    expedition.depth = expedition.currentFloor;
    expedition.pressure = expedition.instability;
    expedition.assistIds = uniqueAssistIds(expedition.activeProtocols);
    return expedition;
}

function syncRunStateFields(expedition) {
    expedition.currentFloor = expedition.depth;
    expedition.instability = expedition.pressure;
    expedition.activeProtocols = uniqueProtocolIds([...(expedition.activeProtocols || []), ...expedition.assistIds]);
    return expedition;
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

export function mineralAssistChoicePreview(state, assistId) {
    const expedition = normalizeMineralExpedition(state);
    const id = String(assistId || '');
    const remainingFloors = Math.max(0, MINERAL_EXPEDITION_MAX_DEPTH - expedition.currentFloor);
    const previews = {
        sureGrip:`采矿命中 -1 · 剩余 ${remainingFloors} 层`,
        pressureVeil:`每层压力 -4% · 当前 ${expedition.instability}%`,
        cargoSense:`采矿原石 +1 · 货舱 ${expedition.cargo.rawStone}`,
        coreRhythm:`精英/矿核命中 -1 · 剩余 ${remainingFloors} 层`,
        fieldRepair:`压力 ${expedition.instability}% → ${Math.max(0, expedition.instability - 10)}%`,
        researchEcho:`矿核研究 +1 · 当前 ${expedition.cargo.research}`,
    };
    if (!MINERAL_EXPEDITION_ASSISTS[id]) return { summary:'', recommended:false };
    const available = new Set(expedition.pendingAssistChoices);
    let recommendedId = '';
    if (expedition.instability >= 55 && available.has('fieldRepair')) recommendedId = 'fieldRepair';
    else if (expedition.instability >= 35 && available.has('pressureVeil')) recommendedId = 'pressureVeil';
    else if (available.has('cargoSense')) recommendedId = 'cargoSense';
    else if (available.has('sureGrip')) recommendedId = 'sureGrip';
    else recommendedId = expedition.pendingAssistChoices[0] || '';
    return { summary:previews[id], recommended:id === recommendedId };
}

function node(id, depth, lane) {
    const template = NODE_LIBRARY[id] || NODE_LIBRARY.mine;
    return { ...template, depth, lane };
}

export function expeditionRoutes(depth) {
    const currentDepth = integer(depth, 0, MINERAL_EXPEDITION_MAX_DEPTH);
    if (currentDepth >= MINERAL_EXPEDITION_MAX_DEPTH - 1) return [node('boss', MINERAL_EXPEDITION_MAX_DEPTH, 'core')];
    const nextDepth = currentDepth + 1;
    if (nextDepth <= 4) return [node('mine', nextDepth, 'center')];
    const routes = [node('mine', nextDepth, 'left')];
    if (nextDepth % 4 === 0) routes.push(node('elite', nextDepth, 'right'));
    else if (nextDepth % 3 === 0) routes.push(node('shop', nextDepth, 'right'));
    else if (nextDepth % 2 === 0) routes.push(node('rest', nextDepth, 'right'));
    else routes.push(node('hazard', nextDepth, 'right'));
    return routes;
}

export function createMineralExpedition({ petId = '', petName = '哈奇伙伴', petTrait = 'steady', moduleIds = [], assistIds = [], lostBeacon = null, seed = Date.now() } = {}) {
    const routeSeed = integer(seed, 1, 0x7fffffff) || 1;
    const beacon = normalizeLostBeacon(lostBeacon);
    return {
        version: 2,
        status: 'routing',
        petId: String(petId || ''),
        petName: String(petName || '哈奇伙伴'),
        petTrait: String(petTrait || 'steady'),
        depth: 0,
        currentFloor: 0,
        pressure: 0,
        instability: 0,
        cargo: { rawStone: 0, research: 0, rareStone: 0 },
        securedLoot: { rawStone: 0, research: 0, rareStone: 0 },
        combo: 0,
        bestCombo: 0,
        moduleIds: uniqueModuleIds(moduleIds),
        assistIds: uniqueAssistIds(assistIds),
        activeProtocols: uniqueProtocolIds(assistIds),
        pendingAssistChoices: [],
        pendingProtocolChoices: [],
        revealedNodeTypes: [],
        pendingEventId: '',
        directiveId: 'survey',
        intel: 0,
        history: [],
        highlights: [],
        lostBeacon: beacon,
        routeSeed,
        routeMap: generateMineRoute({ seed:routeSeed, lostBeacon:beacon }),
        routes: expeditionRoutes(0),
    };
}

export function nextContinuousMineNode(state) {
    const expedition = normalizeMineralExpedition(state);
    if (expedition.status !== 'routing' || expedition.currentFloor < 1 || expedition.pendingProtocolChoices.length) return null;
    const nextNodes = expedition.routeMap[expedition.currentFloor] || [];
    return nextNodes.length === 1 && nextNodes[0].type === 'drill' ? nextNodes[0] : null;
}

export function normalizeMineralExpedition(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const depth = integer(source.depth ?? source.currentFloor, 0, MINERAL_EXPEDITION_MAX_DEPTH);
    const status = ['routing', 'cleared', 'withdrawn', 'collapsed'].includes(source.status) ? source.status : 'routing';
    const expedition = createMineralExpedition(source);
    expedition.status = status;
    expedition.depth = depth;
    expedition.currentFloor = depth;
    expedition.pressure = integer(source.pressure ?? source.instability, 0, 100);
    expedition.instability = expedition.pressure;
    expedition.cargo = loot(source.cargo);
    expedition.securedLoot = loot(source.securedLoot, expedition.cargo);
    expedition.combo = integer(source.combo, 0, 99);
    expedition.bestCombo = Math.max(expedition.combo, integer(source.bestCombo, 0, 99));
    expedition.moduleIds = uniqueModuleIds(source.moduleIds);
    expedition.assistIds = uniqueAssistIds([...(source.assistIds || []), ...(source.activeProtocols || [])]);
    expedition.activeProtocols = uniqueProtocolIds([...(source.activeProtocols || []), ...expedition.assistIds]);
    expedition.pendingAssistChoices = (Array.isArray(source.pendingAssistChoices) ? source.pendingAssistChoices : [])
        .map(id => String(id || '')).filter(id => MINERAL_EXPEDITION_ASSISTS[id] && !expedition.assistIds.includes(id)).slice(0, 3);
    expedition.pendingProtocolChoices = (Array.isArray(source.pendingProtocolChoices) ? source.pendingProtocolChoices : [])
        .map(id => String(id || '')).filter(id => ProtocolRegistry[id] && !expedition.activeProtocols.includes(id)).slice(0, 3);
    expedition.revealedNodeTypes = (Array.isArray(source.revealedNodeTypes) ? source.revealedNodeTypes : []).slice(0, 2)
        .map(entry => ({ depth:integer(entry?.depth, 1, MINERAL_EXPEDITION_MAX_DEPTH), types:[...new Set((entry?.types || []).map(type => String(type || '')))] }));
    expedition.pendingEventId = MINERAL_EXPEDITION_EVENTS[source.pendingEventId] ? source.pendingEventId : '';
    expedition.directiveId = directiveId(source.directiveId);
    expedition.intel = integer(source.intel, 0, 99);
    expedition.history = (Array.isArray(source.history) ? source.history : []).slice(-24)
        .map(entry => ({ depth:integer(entry?.depth, 0, MINERAL_EXPEDITION_MAX_DEPTH), nodeId:String(entry?.nodeId || ''), outcome:String(entry?.outcome || '') }));
    expedition.highlights = (Array.isArray(source.highlights) ? source.highlights : []).map(expeditionHighlight).filter(Boolean).slice(-8);
    expedition.lostBeacon = normalizeLostBeacon(source.lostBeacon);
    expedition.routeSeed = integer(source.routeSeed, 1, 0x7fffffff) || expedition.routeSeed;
    expedition.routeMap = generateMineRoute({ seed:expedition.routeSeed, lostBeacon:expedition.lostBeacon });
    expedition.routes = status === 'routing' ? expeditionRoutes(depth) : [];
    return syncRunStateAliases(expedition);
}

export function collapse(state, report = '不稳定度达到极限，矿层发生坍塌。') {
    const expedition = normalizeMineralExpedition(state);
    if (expedition.status !== 'routing') return { expedition, changed:false, report:'本次远征已结束。' };
    expedition.status = 'collapsed';
    expedition.instability = 100;
    let protectedCargo = false;
    if (hasProtocolEffect(expedition, 'protect_collapse_once')) {
        const consumedId = expedition.activeProtocols.find(id => ProtocolRegistry[id]?.effect === 'protect_collapse_once');
        expedition.activeProtocols = expedition.activeProtocols.filter(id => id !== consumedId);
        expedition.securedLoot = { ...expedition.cargo };
        report += `${ProtocolRegistry[consumedId].name}保护了全部货物。`;
        appendHighlight(expedition, 'cargo_guarded', expedition.cargo);
        protectedCargo = true;
    } else {
        expedition.lostBeacon = normalizeLostBeacon({ cargo:lostCargo(expedition.cargo, expedition.securedLoot), sourceDepth:expedition.currentFloor });
        expedition.cargo = { ...expedition.securedLoot };
    }
    expedition.routes = [];
    const beaconReport = expedition.lostBeacon ? ' 遗失货舱发出了失落信标，可在下一次远征中夺回。' : '';
    return { expedition:syncRunStateAliases(expedition), changed:true, lostBeacon:expedition.lostBeacon, report:protectedCargo ? report : `${report}仅已封装货物被安全带回。${beaconReport}` };
}

export function secureMineLoot(state) {
    const expedition = normalizeMineralExpedition(state);
    if (expedition.status !== 'routing' || ![4, 8].includes(expedition.currentFloor)) {
        return { expedition, changed:false, report:'只有抵达第 4 或第 8 层的安全升降梯才能封装货物。' };
    }
    expedition.securedLoot = { ...expedition.cargo };
    return { expedition:syncRunStateAliases(expedition), changed:true, report:`第 ${expedition.currentFloor} 层货舱已封装，后续坍塌仍可带回。` };
}

export function evacuate(state) {
    const expedition = normalizeMineralExpedition(state);
    if (expedition.status !== 'routing') return { expedition, changed:false, report:'本次远征已结束。' };
    if (![4, 8, 12].includes(expedition.currentFloor)) {
        return { expedition, changed:false, report:'只能在第 4、8 或 12 层通过升降梯撤离。' };
    }
    expedition.status = 'withdrawn';
    expedition.securedLoot = { ...expedition.cargo };
    expedition.routes = [];
    return { expedition:syncRunStateAliases(expedition), changed:true, report:`在第 ${expedition.currentFloor} 层主动撤离，全部货舱已安全结算。` };
}

export function advanceToNode(state, selectedNode, { success = true, random = Math.random } = {}) {
    const expedition = normalizeMineralExpedition(state);
    if (expedition.status !== 'routing') return { expedition, changed:false, event:'ended', report:'本次远征已结束。' };
    const target = selectedNode && typeof selectedNode === 'object'
        ? expedition.routeMap.flat().find(node => node.id === selectedNode.id)
        : expedition.routeMap.flat().find(node => node.id === selectedNode);
    const expectedFloor = expedition.currentFloor + 1;
    if (!target || target.depth !== expectedFloor) {
        return { expedition, changed:false, event:'invalid', report:'该节点不在当前可选择的下一层路线中。' };
    }
    expedition.currentFloor = target.depth;
    expedition.depth = target.depth;
    if (target.type === 'evacuate') {
        if (hasProtocolEffect(expedition, 'evacuation_research_bonus')) expedition.cargo.research += 1;
        expedition.securedLoot = { ...expedition.cargo };
        const result = evacuate(syncRunStateAliases(expedition));
        return { ...result, event:'evacuate', node:target };
    }

    if (target.type === 'beacon') {
        const beacon = normalizeLostBeacon(expedition.lostBeacon);
        if (!beacon) return { expedition, changed:false, event:'invalid', report:'失落信标已经消失。' };
        const recoveryRatio = success ? 1 : hasProtocolEffect(expedition, 'boost_beacon_partial_recovery') ? .67 : .34;
        const recoveredCargo = proportionalLoot(beacon.cargo, recoveryRatio);
        const remainingCargo = subtractLoot(beacon.cargo, recoveredCargo);
        expedition.cargo.rawStone += recoveredCargo.rawStone;
        expedition.cargo.research += recoveredCargo.research;
        expedition.cargo.rareStone += recoveredCargo.rareStone;
        expedition.securedLoot.rawStone += recoveredCargo.rawStone;
        expedition.securedLoot.research += recoveredCargo.research;
        expedition.securedLoot.rareStone += recoveredCargo.rareStone;
        expedition.lostBeacon = normalizeLostBeacon({ cargo:remainingCargo, sourceDepth:beacon.sourceDepth, recoveryProgress:(beacon.recoveryProgress || 0) + 1 });
        const outcome = expedition.lostBeacon ? 'partial' : 'recovered';
        appendHighlight(expedition, outcome === 'recovered' ? 'beacon_recovered' : 'beacon_partial', recoveredCargo);
        expedition.history.push({ depth:target.depth, nodeId:target.id, outcome });
        expedition.history = expedition.history.slice(-24);
        expedition.routes = [];
        const report = outcome === 'recovered'
            ? `失落货舱已完整夺回：原石 ${recoveredCargo.rawStone}、研究 ${recoveredCargo.research}、高稀有矿石 ${recoveredCargo.rareStone}。`
            : `信标同步受阻，但仍抢回原石 ${recoveredCargo.rawStone}、研究 ${recoveredCargo.research}、高稀有矿石 ${recoveredCargo.rareStone}；剩余货物将在下一局继续发出信号。`;
        return { expedition:syncRunStateAliases(expedition), changed:true, event:'beacon', beaconOutcome:outcome, recoveredCargo, node:target, lostBeacon:expedition.lostBeacon, report };
    }

    const instabilityGain = nodeInstabilityGain(expedition, target.type, success);
    expedition.instability = integer(expedition.instability + instabilityGain, 0, 100);
    let report;
    if (target.type === 'explore') {
        expedition.intel += 2;
        report = '勘探完成，获得 2 点矿层情报。';
    } else if (target.type === 'drill') {
        const gained = success ? 3 : 1;
        expedition.cargo.rawStone += gained;
        report = `钻探${success ? '完成' : '受阻'}，回收 ${gained} 枚原石。`;
    } else if (target.type === 'combat') {
        if (success) { expedition.cargo.rawStone += 5; expedition.cargo.research += 1; }
        report = success ? '遭遇战获胜，回收 5 枚原石和 1 点研究。' : '遭遇战撤退，没有获得货物。';
    } else if (target.type === 'event') {
        if (success) expedition.cargo.research += 2;
        report = success ? '异常信号已解析，获得 2 点研究。' : '异常信号失控，矿层更加不稳定。';
        if (success) expedition.pendingProtocolChoices = generateProtocolChoices(expedition, { random });
    } else if (target.type === 'protocol_cache') {
        expedition.pendingProtocolChoices = generateProtocolChoices(expedition, { random });
        report = expedition.pendingProtocolChoices.length ? '协议缓存已解锁，请从三个协议中选择一个。' : '协议缓存中没有新的可用协议。';
    } else if (target.type === 'shop') {
        report = '神秘商人完成应急维护，不稳定度降低。';
    } else if (target.type === 'boss') {
        if (success) {
            expedition.cargo.rawStone += 8;
            expedition.cargo.research += 2;
            expedition.status = 'cleared';
            expedition.securedLoot = { ...expedition.cargo };
            report = '深层主矿核已击破，全部货舱完成结算。';
        } else report = '主矿核反冲，不稳定度急剧上升。';
    }
    const risk = mineRiskAt(expedition.instability);
    const rareDropChance = Math.min(1, risk.rareDropChance + (expedition.instability >= 60 && hasProtocolEffect(expedition, 'high_instability_rare_bonus') ? .15 : 0));
    if (success && ['drill', 'combat', 'event', 'boss'].includes(target.type) && random() < rareDropChance) {
        expedition.cargo.rareStone += 1;
        report += ' 高压矿脉中发现 1 枚高稀有矿石。';
        if (hasProtocolEffect(expedition, 'copy_rare_to_secured') && random() < .35) {
            expedition.cargo.rareStone += 1;
            expedition.securedLoot.rareStone += 1;
            report += ' 同位素复制将额外矿石送入已封装货舱。';
        }
    }
    if (success && ['drill', 'combat', 'event', 'boss'].includes(target.type) && hasProtocolEffect(expedition, 'stabilize_on_loot')) {
        expedition.instability = integer(expedition.instability - 2, 0, 100);
    }
    if (expedition.status === 'routing' && [4, 8].includes(target.depth)) {
        expedition.securedLoot = { ...expedition.cargo };
        report += ` 第 ${target.depth} 层安全仓已自动封装当前货舱。`;
    }
    expedition.history.push({ depth:target.depth, nodeId:target.id, outcome:success ? 'success' : 'fail' });
    expedition.history = expedition.history.slice(-24);
    if (expedition.status === 'routing' && (expedition.instability >= 100 || random() < risk.collapseChance)) {
        const result = collapse(syncRunStateAliases(expedition));
        return { ...result, event:'collapse', node:target };
    }
    expedition.routes = [];
    return { expedition:syncRunStateAliases(expedition), changed:true, event:target.type, node:target, report };
}

export function selectProtocol(runState, protocolId) {
    const expedition = normalizeMineralExpedition(runState);
    const selectedId = String(protocolId || '');
    if (expedition.status !== 'routing' || !ProtocolRegistry[selectedId] || !expedition.pendingProtocolChoices.includes(selectedId)) {
        return { expedition, changed:false, report:'请选择当前协议缓存提供的协议。' };
    }
    expedition.activeProtocols.push(selectedId);
    expedition.pendingProtocolChoices = [];
    if (ProtocolRegistry[selectedId].effect === 'reveal_next_two_floors') {
        expedition.revealedNodeTypes = expedition.routeMap.slice(expedition.currentFloor, expedition.currentFloor + 2)
            .map(nodes => ({ depth:nodes[0]?.depth || expedition.currentFloor, types:[...new Set(nodes.map(node => node.type))] }));
    }
    return { expedition:syncRunStateAliases(expedition), changed:true, report:`${ProtocolRegistry[selectedId].name}已加入本次远征。` };
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
    return syncRunStateFields(expedition);
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
        expedition.cargo = { ...expedition.securedLoot };
        report = '矿层坍塌，只带回了已封装货舱。';
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
        expedition.cargo = { ...expedition.securedLoot };
        return { expedition:withHistory(expedition, { id:event.id }, 'collapsed'), changed:true, report:'异常处置引发矿层坍塌，只带回了已封装货舱。' };
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
    return evacuate(state);
}