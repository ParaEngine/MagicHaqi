const SCENE_POSITIONS = [
    [{ x: 20, y: 62 }, { x: 48, y: 48 }, { x: 76, y: 66 }],
    [{ x: 27, y: 48 }, { x: 61, y: 61 }, { x: 82, y: 43 }],
    [{ x: 17, y: 75 }, { x: 53, y: 42 }, { x: 73, y: 72 }],
];

export function npcProgressId(planetId, fieldId, npcId) {
    return `${String(planetId || 'default')}:${String(fieldId || '1')}:${String(npcId || 'npc')}`;
}

export function sceneTaskProgressFeedback(interaction, step, completedCount) {
    const total = Math.max(0, interaction?.play?.steps?.length || 0);
    const completed = Math.max(0, Math.min(total, Number(completedCount) || 0));
    if (['carry', 'petAssist'].includes(interaction?.play?.interactionMode)) {
        return step?.feedback || `已完成${step?.label || '当前步骤'}`;
    }
    if (completed >= total) return `已处理${step?.label || '最后一处'}，所有目标均已完成`;
    return `已处理${step?.label || '该处'}，还剩 ${total - completed} 处`;
}

export function isSequentialSceneTask(interaction) {
    return ['carry', 'petAssist'].includes(interaction?.play?.interactionMode);
}

export function isSceneTaskStepAvailable(interaction, collected, stepId) {
    const completed = Array.isArray(collected) ? collected : [];
    if (completed.includes(stepId)) return false;
    if (!isSequentialSceneTask(interaction)) return true;
    return interaction?.play?.steps?.find(step => !completed.includes(step.id))?.id === stepId;
}

export function isSceneTaskCompleted(relationship, interaction) {
    const interactionId = interaction?.id;
    if (!interactionId) return false;
    if (Array.isArray(relationship?.completedInteractionIds)
        && relationship.completedInteractionIds.includes(interactionId)) return true;
    const steps = Array.isArray(interaction?.play?.steps) ? interaction.play.steps : [];
    const collected = relationship?.sceneCollected?.[interactionId];
    return steps.length > 0
        && Array.isArray(collected)
        && steps.every(step => collected.includes(step.id));
}

export function reconcileSceneTaskCompletion(relationship, interaction, storyFlags, completedAt = Date.now()) {
    if (!isSceneTaskCompleted(relationship, interaction)) return false;
    const interactionId = interaction.id;
    const completedIds = Array.isArray(relationship.completedInteractionIds)
        ? relationship.completedInteractionIds
        : (relationship.completedInteractionIds = []);
    let changed = false;
    if (!completedIds.includes(interactionId)) {
        completedIds.push(interactionId);
        changed = true;
    }
    if (relationship.activeSceneInteractionId === interactionId) {
        relationship.activeSceneInteractionId = '';
        changed = true;
    }
    if (storyFlags && !storyFlags[interactionId]) {
        storyFlags[interactionId] = completedAt;
        changed = true;
    }
    return changed;
}

export function shouldShowSceneTaskSteps(relationship, interaction) {
    return !isSceneTaskCompleted(relationship, interaction)
        && relationship?.activeSceneInteractionId === interaction?.id;
}

export function generatedNpcSceneInteraction(npc, npcIndex = 0) {
    if ((npc?.interactions || []).some(interaction => interaction.play?.type === 'sceneCollect')) return null;
    const source = (npc?.interactions || [])[0];
    if (!source) return null;
    const label = String(source.label || '协助现场工作').replace(/^(一起|帮忙|开始|进行|学习|参与|选择)/, '') || '现场工作';
    const keywords = `${npc.role || ''}${source.label || ''}${source.response || ''}`;
    let icon = '🔎';
    let action = '确认现场';
    let markerIcon = '✅';
    if (/安全|巡查|检查|护栏|设施|水域/.test(keywords)) { icon = '🛟'; action = '排除隐患'; markerIcon = '🛡️'; }
    else if (/观察|动物|熊猫|金鱼|鸟|猴|生态|化石|冰晶/.test(keywords)) { icon = '🔭'; action = '记录线索'; markerIcon = '📍'; }
    else if (/布置|装饰|舞台|沙堡|设计|制作|整理/.test(keywords)) { icon = '🧰'; action = '安装部件'; markerIcon = '✨'; }
    else if (/农|作物|灌溉|水渠|竹|食物/.test(keywords)) { icon = '🌱'; action = '照护区域'; markerIcon = '🌿'; }
    else if (/声音|鸟鸣|节奏|舞|训练|魔法/.test(keywords)) { icon = '🎵'; action = '激活节拍'; markerIcon = '⭐'; }
    const positions = SCENE_POSITIONS[npcIndex % SCENE_POSITIONS.length];
    return {
        id: `scene_${source.id}`,
        label: `进入场景：${label}`,
        response: source.response,
        play: {
            type: 'sceneCollect',
            instruction: `离开对话框，在场景中完成“${label}”。`,
            success: source.response || `${npc.name}确认现场工作已经完成。`,
            revisit: `${npc.name}还记得你完成的“${label}”，现场一直保留着你们的成果。`,
            markerIcon,
            markerLabel: label,
            steps: positions.map((position, index) => ({
                id: `action_${index + 1}`,
                label: `${action} ${index + 1}`,
                icon,
                feedback: index < 2 ? `${action}成功，继续前往下一个位置。` : `最后一处也已处理，可以向${npc.name}汇报了。`,
                ...position,
            })),
        },
    };
}

export function withPrimarySceneInteraction(npc, { npcIndex = 0, planetId = 'default', fieldId = '1' } = {}) {
    const generatedInteraction = generatedNpcSceneInteraction(npc, npcIndex);
    return {
        ...npc,
        progressId: npcProgressId(planetId, fieldId, npc.id),
        interactions: generatedInteraction ? [generatedInteraction, ...(npc.interactions || [])] : (npc.interactions || []),
    };
}