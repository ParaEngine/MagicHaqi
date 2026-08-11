"use strict";
/* =========================================================================
   《哈奇深渊：机甲矿工》—— 阶段一：核心抓取物理引擎
   纯 Vanilla JS，无外部依赖。世界单位 = 像素，y 轴向下为正（Canvas 坐标系）。

   本文件只负责【物理与状态】，不含任何渲染。所有“Juice / 打击感”都通过
   回调钩子(hooks)向外抛事件（震屏、粒子、墩弟后仰动画…），渲染层自行实现。

   导出三个核心类：
     · Claw  —— 钟摆 / 发射 / 抓取 / 按重量回拉 的能量爪
     · Ore   —— 带碰撞体的矿物（金矿/钻石/废石/黑卡/雷怪…）
     · AbyssEngine —— 串起爪子+矿区+Combo 的物理世界管理器
   ========================================================================= */

//==========================================================================
// 0. 调参区（手感数值集中于此）
//==========================================================================
const ENGINE_CFG = {
  // —— 钟摆 ——
  swingArcDeg:    160,     // 摆动总角度（以正下方为中心，左右各 80°）
  swingPeriod:    2.4,     // 一个完整来回的秒数（越小摆越快）
  ropeMinLen:     46,      // 收回到位时的绳长（爪子贴近机甲的距离）

  // —— 发射 / 回拉 ——
  shootSpeed:     1180,    // 发射时绳子伸长速度 px/s（出爪很快）
  basePullSpeed:  640,     // 空爪 / 标准回拉速度 px/s
  // 重量手感：回拉速度 = basePullSpeed * (pullMassRef / (pullMassRef + weight))
  //  → weight 越大越慢；pullMassRef 决定“感知重量”的灵敏度
  pullMassRef:    1.6,
  minPullSpeed:   90,      // 再重也不至于完全拉不动的下限
  ropeSagBoot:    0.18,    // 自由摆动时绳子的重力下垂系数（0=笔直, 渲染层用）

  // —— Combo ——
  comboMax:       12,      // Combo 上限
  comboPullPer:   0.07,    // 每层 Combo 给回拉速度的加成（线性叠加）
  // 触发 Combo+1 的矿物类型（高价值目标）；其余正常矿（rock）会清零
  comboGoodTypes: ["gold", "diamond", "blackcard"],

  // —— 道具 / Buff ——
  friedChickenMul: 2.0,    // 高热量炸鸡桶：本局回拉速度 ×2 且无视重量

  // —— 雷属性干扰怪 ——
  stunTime:       2.0,     // 被电击麻痹时长（秒）

  // —— 碰撞 ——
  clawTipRadius:  16,      // 能量爪爪尖的碰撞半径
};

// 各矿物类型的默认属性（weight 影响回拉速度，value 由结算层使用）
const ORE_TYPES = {
  // type        weight  value  radius  combo友好?
  gold_small:  { weight: 0.9,  value: 100,  radius: 18 },
  gold_big:    { weight: 3.4,  value: 350,  radius: 34, heavy: true }, // 超大金矿→墩弟用力后仰
  diamond:     { weight: 0.6,  value: 600,  radius: 16 },
  rock:        { weight: 4.2,  value: 12,   radius: 30 },             // 废石：重且不值钱，清 Combo
  blackcard:   { weight: 0.5,  value: 0,    radius: 20, mystery: true }, // 盲盒黑卡，过关再鉴定
  thunder:     { weight: 0.0,  value: 0,    radius: 22, hazard: true },  // 雷怪：碰到 = 麻痹
};

//==========================================================================
// 1. 小工具
//==========================================================================
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 把基础类型属性套用到自定义覆盖项上
function oreSpec(type, override = {}) {
  const base = ORE_TYPES[type] || ORE_TYPES.gold_small;
  return Object.assign({ type }, base, override);
}

//==========================================================================
// 2. Ore —— 矿物 / 碰撞体
//==========================================================================
class Ore {
  /**
   * @param {string} type  ORE_TYPES 中的键
   * @param {number} x,y    世界坐标（圆心）
   * @param {object} opts   覆盖属性（weight/value/radius/vx…）
   */
  constructor(type, x, y, opts = {}) {
    const spec = oreSpec(type, opts);
    this.type    = spec.type;
    this.x = x; this.y = y;
    this.radius  = spec.radius;
    this.weight  = spec.weight;
    this.value   = spec.value;
    this.heavy   = !!spec.heavy;     // 超大金矿，需要后仰动画 + 震屏
    this.mystery = !!spec.mystery;   // 黑卡，结算时鉴定
    this.hazard  = !!spec.hazard;    // 雷怪，碰到麻痹

    // 游荡：雷怪会左右游动；其余默认静止
    this.vx = opts.vx ?? (this.hazard ? 60 : 0);
    this.rangeMinX = opts.rangeMinX ?? null; // 巡逻边界（可选）
    this.rangeMaxX = opts.rangeMaxX ?? null;

    this.alive    = true;   // 是否还在矿区（被抓走后置 false）
    this.captured = false;  // 是否正被爪子拖拽
  }

  update(dt) {
    if (this.captured || !this.alive) return;
    if (this.vx !== 0) {
      this.x += this.vx * dt;
      if (this.rangeMinX != null && this.x < this.rangeMinX) { this.x = this.rangeMinX; this.vx *= -1; }
      if (this.rangeMaxX != null && this.x > this.rangeMaxX) { this.x = this.rangeMaxX; this.vx *= -1; }
    }
  }

  // 点 / 爪尖圆 与本矿的圆-圆碰撞
  hitTest(px, py, r = 0) {
    const dx = px - this.x, dy = py - this.y;
    const rr = this.radius + r;
    return dx * dx + dy * dy <= rr * rr;
  }

  // Combo 是否友好（高价值目标）
  isComboGood() { return ENGINE_CFG.comboGoodTypes.includes(this.type); }
}

//==========================================================================
// 3. Claw —— 能量爪（钟摆 / 发射 / 抓取 / 按重量回拉）
//==========================================================================
const CLAW = { SWING: "swing", SHOOT: "shoot", PULL: "pull", STUN: "stun" };

class Claw {
  /** @param {number} pivotX,pivotY  机甲上爪子的悬挂支点（屏幕正上方） */
  constructor(pivotX, pivotY) {
    this.pivot = { x: pivotX, y: pivotY };
    this.state = CLAW.SWING;

    this.angle  = 0;                 // 与“正下方”的夹角（弧度），左负右正
    this.length = ENGINE_CFG.ropeMinLen;
    this.swingT = 0;                 // 钟摆相位累计

    this.payload    = null;          // 当前抓到的 Ore（null=空爪）
    this.pullSpeed  = ENGINE_CFG.basePullSpeed;
    this.stunTimer  = 0;

    this.open = true;                // 爪子张合状态（渲染用：发射前张开，命中后闭合）
  }

  // 爪尖世界坐标
  get tip() {
    const a = this.angle;
    return {
      x: this.pivot.x + Math.sin(a) * this.length,
      y: this.pivot.y + Math.cos(a) * this.length, // y 向下 → 用 cos 正向
    };
  }

  get maxLen() { return this._maxLen; }
  setMaxLen(v) { this._maxLen = v; }   // 由引擎按矿区高度注入

  // 玩家点击 / Space：仅在自由摆动时可发射
  fire() {
    if (this.state !== CLAW.SWING) return false;
    this.state = CLAW.SHOOT;
    this.open  = true;
    return true;
  }

  // 寿司飞镖：切断绳索、丢弃当前垃圾，立刻回收空爪
  cutRope() {
    if (this.state === CLAW.PULL && this.payload) {
      this.payload.captured = false;
      this.payload.alive = false; // 被丢弃的矿不再回到矿区（按 PRD：放弃它）
      this.payload = null;
      this.open = true;
    }
  }

  // 被雷怪电击 → 麻痹
  electrocute() {
    if (this.payload) { this.payload.captured = false; this.payload.alive = true; this.payload = null; }
    this.state = CLAW.STUN;
    this.stunTimer = ENGINE_CFG.stunTime;
    this.open = true;
  }

  // 命中矿物 → 进入回拉，按重量 + Combo + Buff 计算回拉速度
  _grab(ore, comboMul, friedChicken) {
    this.payload = ore;
    ore.captured = true;
    this.open = false;
    this.state = CLAW.PULL;

    if (friedChicken) {
      // 炸鸡桶：无视重量，马力全开
      this.pullSpeed = ENGINE_CFG.basePullSpeed * ENGINE_CFG.friedChickenMul;
    } else {
      const massFactor = ENGINE_CFG.pullMassRef / (ENGINE_CFG.pullMassRef + ore.weight);
      this.pullSpeed = Math.max(
        ENGINE_CFG.minPullSpeed,
        ENGINE_CFG.basePullSpeed * massFactor * comboMul
      );
    }
  }

  /**
   * @param {number} dt
   * @param {object} ctx  { ores, comboMul, friedChicken, hooks }
   * @returns {object|null}  当一次抓取结算完成时返回 {ore|null, empty:bool}，否则 null
   */
  update(dt, ctx) {
    const { hooks } = ctx;

    switch (this.state) {
      //---------------------------------------------------------------- 摆动
      case CLAW.SWING: {
        this.swingT += dt;
        const half = (ENGINE_CFG.swingArcDeg * 0.5) * DEG;
        // 用 sin 做平滑钟摆；端点处自然减速
        this.angle  = half * Math.sin((this.swingT / ENGINE_CFG.swingPeriod) * Math.PI * 2);
        this.length = ENGINE_CFG.ropeMinLen;
        return null;
      }

      //---------------------------------------------------------------- 发射
      case CLAW.SHOOT: {
        this.length += ENGINE_CFG.shootSpeed * dt;
        const tip = this.tip;

        // 命中检测：优先级——雷怪危险，其余取最先命中的
        for (const ore of ctx.ores) {
          if (!ore.alive || ore.captured) continue;
          if (!ore.hitTest(tip.x, tip.y, ENGINE_CFG.clawTipRadius)) continue;

          if (ore.hazard) {                       // 撞上雷怪 → 麻痹
            hooks.onElectrocute?.(ore, tip);
            this.electrocute();
            return { ore: null, empty: true, electrocuted: true };
          }
          // 抓中矿物
          hooks.onGrab?.(ore, tip);
          if (ore.heavy) hooks.onHeavyGrab?.(ore, tip); // 超大金矿：后仰+震屏+土块粒子
          this._grab(ore, ctx.comboMul, ctx.friedChicken);
          return null;
        }

        // 探到底也没抓到 → 抓空，原速回拉
        if (this.length >= this._maxLen) {
          this.pullSpeed = ENGINE_CFG.basePullSpeed;
          this.state = CLAW.PULL;
          this.open = false;
          hooks.onMiss?.(tip);
        }
        return null;
      }

      //---------------------------------------------------------------- 回拉
      case CLAW.PULL: {
        this.length -= this.pullSpeed * dt;
        if (this.payload) {                        // 拖着货：货跟随爪尖
          const tip = this.tip;
          this.payload.x = tip.x;
          this.payload.y = tip.y;
        }
        if (this.length <= ENGINE_CFG.ropeMinLen) {  // 收回到位 → 结算
          this.length = ENGINE_CFG.ropeMinLen;
          const ore = this.payload;
          if (ore) { ore.captured = false; ore.alive = false; }
          this.payload = null;
          this.state = CLAW.SWING;
          this.open = true;
          return { ore, empty: !ore };
        }
        return null;
      }

      //---------------------------------------------------------------- 麻痹
      case CLAW.STUN: {
        this.stunTimer -= dt;
        this.length = ENGINE_CFG.ropeMinLen;
        if (this.stunTimer <= 0) { this.state = CLAW.SWING; this.swingT = 0; }
        return null;
      }
    }
    return null;
  }

  // 给渲染层：返回一条带重力下垂的绳索折线（自由摆动时下垂，绷紧拖拽时趋直）
  ropePoints(segments = 8) {
    const tip = this.tip;
    const taut = (this.state === CLAW.PULL || this.state === CLAW.SHOOT) ? 1 : 0;
    const sag  = ENGINE_CFG.ropeSagBoot * this.length * (1 - taut);
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = this.pivot.x + (tip.x - this.pivot.x) * t;
      const y = this.pivot.y + (tip.y - this.pivot.y) * t;
      pts.push({ x, y: y + Math.sin(t * Math.PI) * sag }); // 抛物线下垂
    }
    return pts;
  }
}

//==========================================================================
// 4. AbyssEngine —— 物理世界管理器（爪子 + 矿区 + Combo）
//==========================================================================
class AbyssEngine {
  /**
   * @param {object} cfg  { pivotX, pivotY, depth, hooks }
   *   hooks: { onGrab, onHeavyGrab, onMiss, onElectrocute, onResolve, onCombo }
   */
  constructor(cfg) {
    this.claw  = new Claw(cfg.pivotX, cfg.pivotY);
    this.claw.setMaxLen(cfg.depth || 900);
    this.ores  = [];
    this.combo = 0;
    this.score = 0;
    this.friedChicken = false;       // 本局是否吃了炸鸡桶（Buff）
    this.hooks = cfg.hooks || {};
  }

  addOre(type, x, y, opts) { const o = new Ore(type, x, y, opts); this.ores.push(o); return o; }

  // 当前 Combo 对应的回拉速度倍率
  get comboMul() {
    return 1 + clamp(this.combo, 0, ENGINE_CFG.comboMax) * ENGINE_CFG.comboPullPer;
  }

  fire()    { return this.claw.fire(); }       // 玩家发射
  cutRope() { this.claw.cutRope(); }           // 寿司飞镖

  update(dt) {
    for (const o of this.ores) o.update(dt);

    const result = this.claw.update(dt, {
      ores: this.ores,
      comboMul: this.comboMul,
      friedChicken: this.friedChicken,
      hooks: this.hooks,
    });

    if (result) this._resolve(result);

    // 清理已离场的矿物
    if (this.ores.some(o => !o.alive)) this.ores = this.ores.filter(o => o.alive);
  }

  // 一次抓取的结算：算分、更新 Combo
  _resolve(result) {
    const { ore, empty, electrocuted } = result;

    if (electrocuted || empty || (ore && !ore.isComboGood())) {
      // 抓空 / 被电 / 抓到废石 → Combo 清零
      if (this.combo !== 0) this.hooks.onCombo?.(0, this.combo);
      this.combo = 0;
    } else if (ore && ore.isComboGood()) {
      const prev = this.combo;
      this.combo = clamp(this.combo + 1, 0, ENGINE_CFG.comboMax);
      this.hooks.onCombo?.(this.combo, prev);
    }

    // 黑卡不立刻给钱（过关鉴定）；其余按 value 入账
    if (ore && !ore.mystery && !ore.hazard) this.score += ore.value;

    this.hooks.onResolve?.({ ore, empty, electrocuted, combo: this.combo, score: this.score });
  }
}

//==========================================================================
// 5. 导出（浏览器全局 + 可选 ES Module）
//==========================================================================
if (typeof window !== "undefined") {
  window.HaqiAbyss = { Claw, Ore, AbyssEngine, ENGINE_CFG, ORE_TYPES, CLAW };
}
export { Claw, Ore, AbyssEngine, ENGINE_CFG, ORE_TYPES, CLAW };
