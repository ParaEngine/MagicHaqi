import { FRIENDLY_GUARD_DOJO } from './dojo_core.js';

const GUARDIAN_NAMES = Object.freeze([
    Object.freeze(['岩甲小卫', '月湾巡游者', '星核护卫']),
    Object.freeze(['密林守望', '潮汐骑手', '熔岩前锋']),
    Object.freeze(['雪原哨兵', '遗迹解读者', '苍穹斗士']),
    Object.freeze(['琥珀守卫', '深渊行者', '雷鸣领主']),
    Object.freeze(['馆主之盾', '馆主之矛', '守护大师']),
]);

function integer(value, fallback = 0) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? number : fallback;
}

function stat(value, fallback) {
    return Math.max(1, integer(value, fallback));
}

function cloneFighter(source, index) {
    const stats = source?.stats || source?.battleStats || {};
    const maxHp = stat(stats.maxHp ?? stats.hp, 120);
    return {
        id: String(source?.id || `fighter-${index + 1}`),
        name: String(source?.name || `伙伴 ${index + 1}`).slice(0, 32),
        maxHp,
        hp: maxHp,
        attack: stat(stats.attack ?? stats.power, 36),
        defense: Math.max(0, integer(stats.defense, 12)),
        magic: Math.max(0, integer(stats.magic, 18)),
        luck: Math.max(0, integer(stats.luck, 5)),
        imageUrl: String(source?.imageUrl || source?.imageSheetUrl || '').slice(0, 500),
    };
}

function activeFighter(team, activeIndex) {
    return team[activeIndex] || null;
}

function damageFor(attacker, defender) {
    const raw = attacker.attack + Math.floor(attacker.magic * 0.35) - Math.floor(defender.defense * 0.55);
    return Math.max(8, Math.floor(raw));
}

export function createFriendlyGuardBattle(playerTeam, floor) {
    const normalizedFloor = integer(floor);
    const multiplier = FRIENDLY_GUARD_DOJO.floorMultipliers[normalizedFloor - 1];
    if (!multiplier || !Array.isArray(playerTeam) || playerTeam.length !== FRIENDLY_GUARD_DOJO.teamSize) return null;
    const players = playerTeam.map(cloneFighter);
    const names = GUARDIAN_NAMES[normalizedFloor - 1];
    const guardians = names.map((name, index) => cloneFighter({
        id: `friendly-guard-${normalizedFloor}-${index + 1}`,
        name,
        stats: {
            maxHp: Math.round((132 + normalizedFloor * 14 + index * 18) * multiplier),
            attack: Math.round((38 + normalizedFloor * 5 + index * 5) * multiplier),
            defense: Math.round((13 + normalizedFloor * 2 + index * 2) * multiplier),
            magic: Math.round((18 + normalizedFloor * 3 + index * 3) * multiplier),
            luck: 4 + normalizedFloor + index,
        },
    }, index));
    return {
        floor: normalizedFloor,
        turn: 0,
        state: 'active',
        playerTeam: players,
        guardianTeam: guardians,
        playerActiveIndex: 0,
        guardianActiveIndex: 0,
        log: [`第 ${normalizedFloor} 层开始，${players[0].name} 对阵 ${guardians[0].name}。`],
    };
}

export function advanceFriendlyGuardBattle(battle) {
    if (!battle || battle.state !== 'active') return battle;
    const player = activeFighter(battle.playerTeam, battle.playerActiveIndex);
    const guardian = activeFighter(battle.guardianTeam, battle.guardianActiveIndex);
    if (!player || !guardian) return { ...battle, state: player ? 'won' : 'lost' };
    const log = [...battle.log];
    const next = { ...battle, playerTeam: battle.playerTeam.map(fighter => ({ ...fighter })), guardianTeam: battle.guardianTeam.map(fighter => ({ ...fighter })), log, turn: battle.turn + 1 };
    const activePlayer = activeFighter(next.playerTeam, next.playerActiveIndex);
    const activeGuardian = activeFighter(next.guardianTeam, next.guardianActiveIndex);
    const playerDamage = damageFor(activePlayer, activeGuardian);
    activeGuardian.hp = Math.max(0, activeGuardian.hp - playerDamage);
    log.push(`${activePlayer.name} 造成 ${playerDamage} 点伤害。`);
    if (activeGuardian.hp === 0) {
        next.guardianActiveIndex += 1;
        const replacement = activeFighter(next.guardianTeam, next.guardianActiveIndex);
        if (!replacement) return { ...next, state: 'won', log: [...log, '守护馆主的三只伙伴全部倒下。'] };
        return { ...next, log: [...log, `${replacement.name} 接替守护位置。`] };
    }
    const guardianDamage = damageFor(activeGuardian, activePlayer);
    activePlayer.hp = Math.max(0, activePlayer.hp - guardianDamage);
    log.push(`${activeGuardian.name} 反击造成 ${guardianDamage} 点伤害。`);
    if (activePlayer.hp === 0) {
        next.playerActiveIndex += 1;
        const replacement = activeFighter(next.playerTeam, next.playerActiveIndex);
        if (!replacement) return { ...next, state: 'lost', log: [...log, '你的三只伙伴全部倒下。'] };
        log.push(`${replacement.name} 接替出战。`);
    }
    return next;
}