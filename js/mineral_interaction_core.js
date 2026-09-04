export const MINERAL_INTERACTION_TYPES = Object.freeze({
    claw: Object.freeze({ id:'claw', name:'磁力抓矿', instruction:'瞄准移动矿石，点击发射磁力爪。' }),
    hammer: Object.freeze({ id:'hammer', name:'弱点破岩', instruction:'在弱点消失前敲中金色圆环。' }),
    resonance: Object.freeze({ id:'resonance', name:'共鸣校准', instruction:'追踪发光晶核，等光环收缩到边缘时点击；不要碰裂纹诱饵。' }),
    trace: Object.freeze({ id:'trace', name:'晶脉描线', instruction:'按住并一笔拖过编号节点，中途松手或走错会重置线路。' }),
});

const INTERACTION_ROTATION = Object.freeze([
    'claw', 'resonance', 'trace', 'hammer',
    'resonance', 'trace', 'claw', 'hammer',
    'trace', 'resonance', 'claw', 'trace',
]);

function boundedDepth(value) {
    return Math.max(1, Math.min(12, Math.floor(Number(value) || 1)));
}

export function remainingHammerHits(requiredHits, stageHits) {
    return Math.max(0, Math.floor(Number(requiredHits) || 0) - Math.floor(Number(stageHits) || 0));
}

export function mineralInteractionForDepth(depth, nodeId = 'mine') {
    const currentDepth = boundedDepth(depth);
    const tier = Math.floor((currentDepth - 1) / 3);
    const depthIndex = currentDepth - 1;
    const type = nodeId === 'elite' || nodeId === 'boss'
        ? 'hammer'
        : INTERACTION_ROTATION[currentDepth - 1];
    const target = MINERAL_INTERACTION_TYPES[type];
    const requiredHits = type === 'trace'
        ? 4 + Math.floor(depthIndex / 2)
        : type === 'resonance'
            ? 3 + Math.floor(depthIndex / 2)
            : type === 'hammer'
                ? 3 + Math.floor(depthIndex / 3)
                : 3 + Math.floor(depthIndex / 3);
    return {
        ...target,
        depth:currentDepth,
        tier,
        requiredHits:nodeId === 'boss' ? 7 : nodeId === 'elite' ? 5 + Math.floor(tier / 2) : requiredHits,
        durationSeconds:Math.max(24, 44 - depthIndex * 1.7),
        targetSpeed:1 + depthIndex * .12,
        targetRadius:Math.max(15, 27 - depthIndex * 1.05),
        weakPointMs:Math.max(950, 2700 - depthIndex * 145),
        resonanceWindow:Math.max(.09, .25 - depthIndex * .012),
        driftAmplitude:Math.min(42, depthIndex * 4),
        decoyCount:Math.floor(depthIndex / 3),
        tracePathWidth:Math.max(18, 42 - depthIndex * 2),
        label:`矿层强度 ${currentDepth} / 12`,
    };
}