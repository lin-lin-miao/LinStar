/* ===== systems/battle.js —— 战斗系统核心 =====
 * 战斗状态机：idle -> running -> settled（胜负结算）-> 可重新开始
 *
 * tick 结算顺序（见清单 3.5）：
 *   1. 模块冷却倒计时
 *   2. 能量基础回复
 *   3. 累计各模块"有效贡献窗口"（activeTicks，用于 DPS 冻结）
 *   4. 行动：激活模块（目标解析 -> 能量门控 -> 词条执行器）
 *   5. 死亡清理与胜负判定
 *
 * ★ 模块效果执行器（解耦，词条驱动）：
 *   模块在 data/modules.js 中用 effects 词条声明效果——
 *     damage     → 对每个选定目标造成伤害（×船类系数）
 *     shield_gain → 对每个选定目标恢复护盾（×船类系数）
 *     （后续词条如 heal / energyDrain 在此同一框架追加执行器）
 *   effects.type 仅用于"特殊模块的特殊效果"标记，且为【列表参数】，
 *   未来一个模块可同时携带多个特殊效果（type: ['...', '...']）。
 *
 * ★ 统一目标系统（详情/单位框/指挥栏共用同一解析）：
 *   目标可用对象 kinds（self/ally/enemy）+ 目标数量 countMode
 *   （single/multi/all，multi 数量上限 maxCount）
 *   解析链：模块手动选择(单/多，互斥) → 上游（船指定 → 全队策略）自动补足
 *   目标不足/无目标 → 本次不激活。
 *
 * 契约：开始广播 combat:state{active:true}；结算完成广播 active:false（自动落档）。
 * 事件：'battle:settled' { result:'win'|'lose' }
 */
import { bus } from '../core/eventBus.js';
import { log, formatRich } from '../core/log.js';
import { i18n } from '../i18n/index.js';
import {
  createShip,
  installModule,
  coeff,
  recalcDerived,
  fillShieldPools,
  fillModuleShieldPool,
  syncShieldSummary,
  baseShieldPoolOf,
} from '../entities/ship.js';

const TPS = 20; // 1 秒 = 20 tick

/** 全队（阵营级）自动目标策略：顺序 / 最低血量 / 最低护盾 / 优先无人机 / 优先舰船（可扩展）。
 *  ship 级可用 ship.policy 覆盖（null=跟随全队）；该列表也作为 船舰主要目标 的策略选项。 */
export const TARGET_POLICIES = ['order', 'lowestHp', 'lowestShield', 'droneFirst', 'shipFirst'];

/** 按策略对存活目标排序：
 *  lowestHp / lowestShield 按数值升序；
 *  droneFirst / order（默认）→ 召唤(无人机)组视为"队首"，先于主力；
 *  shipFirst → 主力(舰船)先于召唤(无人机)。组内按阵列顺序。
 *  注：此处用于【目标选择队列】；渲染队列顺序与它无关（召唤物排在列尾显示）。 */
function orderedFoes(foes, policy) {
  const alive = foes.filter((f) => f.alive);
  if (policy === 'lowestHp') return alive.sort((a, b) => a.hull.hp - b.hull.hp);
  if (policy === 'lowestShield') return alive.sort((a, b) => a.hull.shield - b.hull.shield);
  const summoned = alive.filter((f) => f.isSummon);
  const mains = alive.filter((f) => !f.isSummon);
  if (policy === 'shipFirst') return [...mains, ...summoned];
  return [...summoned, ...mains]; // order / droneFirst
}

/** 单位类型名（多个同阵营同名单位时带 #序号 区分，如 战斗舰 #2） */
function typeName(ship) {
  const base = i18n.t(ship.nameKey);
  return (ship.sideSize || 1) > 1 ? `${base} #${ship.order || 1}` : base;
}

function nameForLog(ship) {
  const key = ship.side === 'ally' ? 'battle.unit.ally' : 'battle.unit.enemy';
  return i18n.t(key, { type: typeName(ship) });
}

/** 单位名着色段（敌方名红 / 我方名蓝，由渲染层包 span） */
function uTok(ship) {
  return { side: ship.side, label: nameForLog(ship) };
}

/** 战斗战报（channel=battle）：colorKeys 所列占位参数按着色单位名段替换 */
function battleLog(key, params, colorKeys) {
  const { msg, rich } = formatRich(key, params, colorKeys);
  log.add(msg, 'battle', rich);
}

/** 造成伤害：护盾先承伤，再扣血；目标死亡时记录战报 */
/** 目标当前是否处于"无敌"：自身有某模块正处于激活的持续期内且其 effects.type 含 invincible。
 * 无敌 = 免疫一切经 damageShip 结算的伤害（普通 + 爆炸波及）；自毁(self_destruct)为直接扣血，无法免疫。 */
function invincibleNow(target) {
  if (!target || !Array.isArray(target.modules)) return false;
  for (const inst of target.modules) {
    if (!inst || !(inst.durationLeft > 0)) continue;
    const cfg = inst.cfg && inst.cfg.effects;
    const t = (cfg && cfg.type) || [];
    if (Array.isArray(t) && t.includes('invincible')) return true;
  }
  return false;
}

/* ---------- 护盾独立池 + 同盟/防爆共享吸收支持 ----------
 * 承伤统一在各“护盾池”（见 ship.js 头部说明）上进行，本区 helpers 只改池值与闪标，
 * 不直接写 hull.shield（汇总由 syncShieldSummary 每次刷新）。
 *  - 自身吸收：目标自己的池按 时长型护盾模块池(激活序，先激活先用)→长期/本体池(最低优先级) 逐个扣减；
 *    普通伤害跳过防爆池（绝不能吃防爆池）；爆炸伤害可再吃防爆模块池。
 *  - 共享吸收：目标自身可吸池耗尽、伤害将扣血时，由友方各“共享模块池”
 *    (type alliance/blastproof) 按激活顺序代吸；爆炸伤防爆池优先。
 * 每 tick 由 createBattle.step 更新为当前双方编队；承伤时据此在“目标所属友方阵营”内找共享池。
 */
let activeAllies = [];
let activeEnemies = [];
const teamOf = (s) => (s.side === 'ally' ? activeAllies : activeEnemies);
const isType = (fx, k) => Array.isArray(fx && fx.type) && fx.type.includes(k);

/** 目标“自己的护盾池”按【使用顺序】列表：
 *  - 时长型护盾模块池：按激活顺序(_shieldSeq 先激活先使用)；allowBp=false 时跳过防爆池（普通伤害不碰防爆）；
 *  - 长期/本体池(并入常驻模块)排最末（最低优先级）。
 *  仅列出值>0 的池。 */
function ownShieldPools(target, allowBp) {
  const pools = target && target.hull && target.hull.pools;
  if (!(pools instanceof Map)) return [];
  const list = [];
  for (const inst of target.modules || []) {
    const p = pools.get(inst.id);
    if (!p || p.cap <= 0 || p.value <= 0) continue;
    if (!allowBp && p.blastproof) continue;
    list.push(p);
  }
  list.sort((a, b) => (a.inst._shieldSeq || 0) - (b.inst._shieldSeq || 0)); // 先激活先使用
  const base = pools.get('base');
  if (base && base.cap > 0 && base.value > 0) list.push(base); // 长期(本体)池：最低优先级、最后用
  return list;
}

/** 目标自身池吸收 amount：按 时长型护盾池(激活序，先激活先用)→长期(本体)池 的顺序扣减并刷新汇总。
 *  blast=true 时防爆模块池也可吸（爆炸伤；通常防爆池已在防爆拦截阶段优先被消耗）。
 *  返回 { rest: 剩余量, takes: [{pool, take}] }，takes 供反射核算。 */
function absorbOwnPools(target, amount, blast) {
  const zero = { rest: amount, takes: [] };
  if (amount <= 0 || !target) return zero;
  let rest = amount;
  const takes = [];
  for (const p of ownShieldPools(target, blast)) {
    if (rest <= 0) break;
    const take = Math.min(p.value, rest);
    p.value -= take;
    rest -= take;
    takes.push({ pool: p, take });
  }
  syncShieldSummary(target); // 汇总刷新（hull.shield = Σ 池值）
  return { rest, takes };
}

/** 目标盾量增减（正=补盾、负=汲取），直接作用到“池”，顺序同吸收（本体长期池先→时长护盾池），
 *  各自封顶自身 cap。补盾可把“共享池/防爆池”（施放者自己的时长模块池）一并补满——
 *  与旧“总量向总上限回满”观感一致；汲取也可打到防爆池（旧聚合语义即如此，汲取不走 blastFloor）。
 *  返回实际增减量（正=增加）。 */
function poolShieldAdd(target, amt) {
  const pools = target && target.hull && target.hull.pools;
  if (!(pools instanceof Map) || amt === 0) return 0;
  const order = [];
  const base = pools.get('base');
  if (base && base.cap > 0) order.push(base);
  for (const inst of target.modules || []) {
    const p = pools.get(inst.id);
    if (p && p.cap > 0) order.push(p);
  }
  let left = amt;
  if (left > 0) {
    for (const p of order) {
      if (left <= 0) break;
      const room = p.cap - p.value;
      if (room <= 0) continue;
      const add = Math.min(room, left);
      p.value += add;
      left -= add;
    }
  } else {
    for (const p of order) {
      if (left >= 0) break;
      const take = Math.min(p.value, -left);
      p.value -= take;
      left += take;
    }
  }
  syncShieldSummary(target);
  return amt - left; // 实际作用量（正=实际补入，负=实际汲取）
}

/** 友方共享吸收：target(某友方单位) 自身池耗尽、伤害将扣血时，由友方各同盟/防爆共享模块池
 *  (施放者池) 代吸。blast=true 时(爆炸型伤害)：防爆池先吸、随后同盟池；否则只允许非防爆的同盟池。
 *  施放者池被吸收时其护盾条相应闪标（同盟深蓝 _allyFlash、防爆橙 _bpFlash）。
 *  返回 { rest: 仍未吸收量, bpAbsorbed: 进入防爆池的量 }。 */
function absorbByAlliance(target, amount, blast) {
  const zero = { rest: amount, bpAbsorbed: 0 };
  if (amount <= 0) return zero;
  const cands = [];
  for (const O of teamOf(target)) {
    if (!O || !O.alive) continue;
    for (const p of O.hull.pools.values()) {
      if (!p.inst) continue; // 本体池不参与共享
      const isAl = p.alliance;
      const isBp = p.blastproof;
      if (!isAl && !isBp) continue;
      if (isBp && !blast) continue; // 防爆池只吸爆炸型伤害
      if (p.value <= 0) continue;
      cands.push({ O, p, seq: p.inst._shieldSeq || 0, bp: isBp });
    }
  }
  // 排序：爆炸伤 → 防爆池(isBp)先，再普通同盟池；普通伤 → 仅同盟池。同型按释放顺序。
  cands.sort((a, b) => {
    if (a.bp !== b.bp) return a.bp ? -1 : 1;
    return a.seq - b.seq;
  });
  let rest = amount;
  let bpAbsorbed = 0;
  const touched = new Set();
  for (const c of cands) {
    if (rest <= 0) break;
    const take = Math.min(c.p.value, rest);
    c.p.value -= take;
    touched.add(c.O);
    if (c.bp) {
      c.O._bpFlash = 40;   // 防爆层被吸收：护盾条橙色闪烁标记（≈2s）
      bpAbsorbed += take;
    } else {
      c.O._allyFlash = 40; // 同盟层被吸收：护盾条深蓝闪烁标记（≈2s）
    }
    rest -= take;
  }
  for (const O of touched) syncShieldSummary(O); // 被吸方汇总刷新
  return { rest, bpAbsorbed };
}

/** 防爆拦截（仅爆炸型伤害）：目标受防爆护盾保护时，先用友方防爆池抵挡本伤害（即使目标自带护盾），
 *  让爆炸不对主要目标造成伤害。池按“释放顺序”逐池扣减并置施放者橙色闪标。
 *  返回 { rest: 剩余量, drained: 进入防爆池的量 }。 */
function drainBlastproof(target, amount) {
  if (amount <= 0) return { rest: amount, drained: 0 };
  const cands = [];
  for (const O of teamOf(target)) {
    if (!O || !O.alive) continue;
    for (const p of O.hull.pools.values()) {
      if (!p.inst || !p.blastproof || p.value <= 0) continue;
      cands.push({ O, p, seq: p.inst._shieldSeq || 0 });
    }
  }
  cands.sort((a, b) => a.seq - b.seq);
  let rest = amount;
  let drained = 0;
  const touched = new Set();
  for (const c of cands) {
    if (rest <= 0) break;
    const take = Math.min(c.p.value, rest);
    c.p.value -= take;
    touched.add(c.O);
    c.O._bpFlash = 40; // 防爆层被拦截：护盾条橙色闪烁标记（≈2s）
    drained += take;
    rest -= take;
  }
  for (const O of touched) syncShieldSummary(O); // 被吸方汇总刷新
  return { rest, drained };
}

/**
 * 造成伤害（独立池模型）：按顺序在护盾池上结算，池尽后扣血；目标死亡时记录战报。
 * attacker（可选）：本次攻击来源（反射护盾需据此返还）。noReflect：此次伤害不触发反射（用于返还伤害，避免双方反射死循环）。
 * blast=true：爆炸型伤害——① 先由友方防爆池拦截；② 再按自身池吸（含防爆模块池）；
 *            否则为普通伤害——自身池只吃 本体→非防爆模块池（绝不碰防爆池）。
 * 若目标装有“反射护盾”(effects.shield_reflect>0 的模块池)，其模块池被消耗的部分按比例返还给 attacker。
 */
function damageShip(target, amount, attacker, noReflect, out, blast) {
  if (invincibleNow(target)) return 0; // 无敌：不受伤害、不阵亡
  let dealt = 0;
  let rest = amount;
  let shieldAbsorbed = 0; // 自身池吸收总量（供反射判定）
  const takes = [];       // 自身池逐池吸收明细（供反射核算）
  // ① 防爆拦截（仅爆炸型）：受防爆护盾保护时先用友方防爆池挡（即使目标自带护盾，爆炸也不伤目标）
  if (blast && rest > 0) {
    const bp = drainBlastproof(target, rest);
    const drained = rest - bp.rest;
    if (drained > 0 && out) {
      out.allyAbsorbed = (out.allyAbsorbed || 0) + drained;
      out.bpAbsorbed = (out.bpAbsorbed || 0) + drained;
    }
    rest = bp.rest;
  }
  // ② 自身护盾池承伤：普通伤 base→非防爆模块池（防爆存在不再禁吃本体/其它模块盾，
  //    blastFloor 判定已移除）；爆炸伤可再吃防爆模块池（通常已在①被拦截耗尽）。
  if (rest > 0) {
    const own = absorbOwnPools(target, rest, !!blast);
    const absorbed = rest - own.rest;
    if (absorbed > 0) {
      shieldAbsorbed = absorbed;
      dealt += absorbed;
      rest = own.rest;
      for (const t of own.takes) takes.push(t);
      target._dmgFlash = 40; // 普通护盾受击：护盾条白色闪烁（≈2s；反射/同盟/防爆等另有各自色，覆盖此白）
    }
  }
  // ③ 自身池耗尽且伤害将扣血：友方同盟/防爆护盾(施放者共享模块池)代为吸收；不够的部分才真正扣血
  const beforeAlly = rest;
  const ar = rest > 0 ? absorbByAlliance(target, rest, !!blast) : { rest, bpAbsorbed: 0 };
  const allyAbsorbed = beforeAlly - ar.rest;
  if (out) {
    out.allyAbsorbed = (out.allyAbsorbed || 0) + allyAbsorbed;
    out.bpAbsorbed = (out.bpAbsorbed || 0) + ar.bpAbsorbed;
  }
  if (ar.rest > 0) {
    target.hull.hp -= ar.rest;
    dealt += ar.rest;
  }
  if (target.hull.hp <= 0 && target.alive) {
    target.hull.hp = 0;
    target.alive = false;
    battleLog('battle.log.destroyed', { ship: uTok(target) }, ['ship']);
  }
  if (!noReflect && attacker && attacker !== target && shieldAbsorbed > 0) {
    reflectShieldDamage(target, attacker, takes);
  }
  return dealt;
}

/** 反射护盾（独立池模型）：把本次落在目标“反射护盾模块池”内被消耗的量按 shield_reflect
 *  返还给攻击者。其它池被消耗不返还（takes 已按逐池吸收明细给出）。
 *  返还伤害对 attacker 正常护盾→血结算，但 noReflect=true（不再引发二次反射）。 */
function reflectShieldDamage(target, attacker, takes) {
  let reflected = 0;
  for (const t of takes) {
    const inst = t.pool && t.pool.inst;
    const fx = inst && inst.cfg && inst.cfg.effects;
    if (!fx || (fx.shield_reflect || 0) <= 0) continue;
    reflected += (fx.shield_reflect || 0) * t.take;
  }
  if (reflected <= 0) return;
  target._reflectFlash = 40; // 反射闪光标记（≈2s，UI 据此闪烁护盾条黄色）
  battleLog(
    'battle.log.reflect',
    { ship: uTok(target), attacker: uTok(attacker), dmg: Math.round(reflected) },
    ['ship', 'attacker']
  );
  damageShip(attacker, reflected, null, true); // 返还（不二次反射）
}

/**
 * 创建一场战斗。
 * @param {{ally: [{type, modules}], enemy: [{type, modules}]}} preset 双方编队配置
 */
export function createBattle(preset) {
  const allies = [];
  const enemies = [];
  let phase = 'idle'; // idle | running | settled
  let result = null;
  let tickOff = null;
  let runTicks = 0; // 战斗已进行的 tick 数（running 起计）
  const seqCount = { ally: 0, enemy: 0 }; // 各阵营"出场序号"分配器：编号由出场顺序决定、不随队列变化
  let shieldSeq = 0; // 护盾模块"激活顺序"分配器（时长型护盾激活即递增，先激活先使用）

  function spawnList(arr, side, list) {
    for (const cfg of list) {
      const ship = createShip(cfg.type, side);
      for (const mod of cfg.modules) {
        // 支持字符串 id（level=1）或规格对象 { moduleId/id, level }
        const spec = mod && typeof mod === 'object' ? mod : { moduleId: mod };
        installModule(ship, spec.moduleId ?? spec.id, spec.level ?? 1);
      }
      // 开战满盾：把各护盾池（本体池 + 当前贡献模块池）补满到各自 cap；
      // 汇总后 hull.shield = shieldCap（与旧“满盾登场”观感一致；时长型模块持续期外无池）
      fillShieldPools(ship);
      seqCount[side] += 1;
      ship.order = seqCount[side]; // 出场序号（#编号），稳定不随队列/移除变化
      arr.push(ship);
    }
  }

  // 单位在创建战斗时即生成完毕（UI 可在 start() 前据此渲染实体框）
  spawnList(allies, 'ally', preset.ally || []);
  spawnList(enemies, 'enemy', preset.enemy || []);
  for (const s of allies) s.sideSize = allies.length;
  for (const s of enemies) s.sideSize = enemies.length;

  /* ---------- 召唤 / 临时单位支持 ---------- */
  const sidesOf = (side) => (side === 'ally' ? allies : enemies);
  /** 该阵营当前存活的某种单位数量（用于"最大召唤数"判定） */
  function countLiveOfType(side, typeId) {
    let n = 0;
    for (const u of sidesOf(side)) if (u.alive && u.typeId === typeId) n += 1;
    return n;
  }
  /** 该阵营人数变化后同步各单位的 sideSize（仅决定是否显示 # 前缀），不改动出场序号 */
  function refreshSideSize(side) {
    const arr = sidesOf(side);
    for (const u of arr) u.sideSize = arr.length;
  }
  /** 生成一个召唤单位并入阵营（overrides 覆写模板），排在该阵营队列【列尾】显示；
   * 目标队列顺序由 orderedFoes 另行处理（召唤物视为队首）。
   * 出场序号由 seqCount 统一分配、稳定不随队列/移除变化。
   * temp=true → 临时单位：受存在时间(lifespan)约束，到期自动死亡；阵亡/到期后直接移出场景。
   * temp=false → 普通单位：不设存在时间，持续作战至死亡（阵亡后保留灰色卡片）。 */
  function spawnSummoned(typeId, side, overrides, temp) {
    const s = createShip(typeId, side, overrides || null);
    s.isSummon = true;           // 召唤单位标记（目标队列视为队首；渲染仍排在列尾）
    s.temp = !!temp;             // 是否为临时单位（由召唤配置决定）
    if (s.temp) s.tempLeft = 0;  // 剩余存在 tick（仅临时单位使用）
    seqCount[side] += 1;
    s.order = seqCount[side];    // #编号由出场顺序决定（整队统一递增）
    sidesOf(side).push(s);       // 排在列尾（显示在主力之后）；目标顺序由 orderedFoes 另行处理
    refreshSideSize(side);
    return s;
  }
  /** 把临时单位移出场景，并清理其各模块对本场其它单位施加的影响 */
  function removeSummoned(side, u) {
    for (const inst of u.modules) {
      if (inst.durationLeft > 0) inst.durationLeft = 0;
      dropSourceMods(inst);
    }
    const arr = sidesOf(side);
    const i = arr.indexOf(u);
    if (i >= 0) {
      arr.splice(i, 1);
      refreshSideSize(side);
    }
  }

  /* ---------- 统一目标系统 ---------- */
  const policies = { ally: 'order', enemy: 'order' };
  // 单位级策略：ship.policy 有效则用它覆盖全队策略；否则跟随全队
  const policyOf = (ship) =>
    ship.policy && TARGET_POLICIES.includes(ship.policy) ? ship.policy : policies[ship.side] || 'order';
  /** 设置某船的自动目标策略（ship 对象或 id）；kind=null → 跟随全队。即时清除旧自动粘性目标。 */
  function setShipPolicy(ship, kind) {
    if (!ship) return false;
    if (kind && !TARGET_POLICIES.includes(kind)) return false;
    ship.policy = kind || null;
    for (const inst of ship.modules || []) inst._stick = undefined; // 策略变化即时生效
    return true;
  }

  /** 依目标词条(kinds/countMode/maxCount)解析本次命中的目标列表（引擎与 UI 共用）
   *  - 目标池：self → 自身；enemy → 敌方存活（按全队策略排序）；ally → 同阵营其它存活
   *  - 手动选择互斥（去重）；未手动覆盖的空位由上游自动补足：
   *      船指定目标(ship.targetId)置前 → 其余按全队策略顺序
   *  - countMode：single=1 / multi=min(maxCount, 可用) / all=全部；空目标池 → 无目标 []
   */
  function moduleTargetList(ship, inst) {
    const fx = (inst && inst.cfg.effects) || {};
    const tgt = (inst && inst.cfg.target) || {};
    const kinds = Array.isArray(tgt.kinds) ? tgt.kinds : [];
    const mode = tgt.countMode || 'single';
    const maxN = Math.max(1, tgt.maxCount || 1);
    const foes = ship.side === 'ally' ? enemies : allies;
    const sameSide = ship.side === 'ally' ? allies : enemies;

    // —— 锁定单位（如一次性火箭）：目标在召唤时固定、永不可改——
    //    即使锁定目标已阵亡也只返回空（绝不另选/改换其他目标）。
    if (ship.lockTargetId) {
      const b = foes.find((u) => u.id === ship.lockTargetId);
      return b && b.alive ? [b] : [];
    }

    const pool = [];
    if (kinds.includes('self')) pool.push(ship);
    if (kinds.includes('enemy')) pool.push(...orderedFoes(foes, policyOf(ship)));
    if (kinds.includes('ally')) {
      pool.push(...sameSide.filter((u) => u.alive && u.id !== ship.id));
    }
    if (kinds.includes('any')) pool.push(...[...allies, ...enemies]); // 敌我任意（含自身）
    const uniq = [];
    for (const u of pool) {
      if (!u.alive) continue;
      if (!uniq.some((x) => x.id === u.id)) uniq.push(u);
    }
    if (!uniq.length) return [];
    // 船指定目标（上游）置于池前（若其在池中）
    if (ship.targetId) {
      const i = uniq.findIndex((u) => u.id === ship.targetId);
      if (i > 0) {
        const [d] = uniq.splice(i, 1);
        uniq.unshift(d);
      }
    }
    // —— 自动目标"粘性"：无任何手动锁定(船 targetId / 模块 unit|units)时，
    //     沿用上一轮自动已锁定的存活目标并前置；旧目标未阵亡前不切到新单位
    //     （如新召到队首的单位不会立刻被集火），旧目标丢失后才按策略选新目标 ——
    const manualLocked = !!ship.targetId || (inst.target && inst.target.mode !== 'follow');
    if (!manualLocked && Array.isArray(inst._stick) && inst._stick.length) {
      const aliveStick = inst._stick.filter((id) => uniq.some((u) => u.id === id));
      if (aliveStick.length) {
        const head = [];
        const rest = [];
        for (const u of uniq) (aliveStick.includes(u.id) ? head : rest).push(u);
        const ord = aliveStick.map((id) => head.find((u) => u.id === id)).filter(Boolean);
        uniq.length = 0;
        uniq.push(...ord, ...rest);
      }
    }

    if (mode === 'all') return uniq;

    if (mode === 'multi') {
      // 手动多选（互斥集合）优先，不足 maxN 的空位由上游顺序自动补足
      const selIds = new Set(
        inst.target && inst.target.mode === 'units' ? inst.target.ids || [] : []
      );
      const out = [];
      for (const u of uniq) {
        if (selIds.has(u.id) && out.length < maxN) out.push(u);
      }
      for (const u of uniq) {
        if (out.length >= maxN) break;
        if (!selIds.has(u.id)) out.push(u);
      }
      return out;
    }

    // single
    if (inst.target && inst.target.mode === 'unit') {
      const u = uniq.find((f) => f.id === inst.target.id);
      if (u) return [u];
    }
    return uniq.slice(0, 1);
  }

  /** 船的"当前实际目标"（供 UI 显示单位主要目标/提示）：
   * 优先手动目标；否则取首个能攻击敌方的模块的实时解析结果（moduleTargetList 含自动"粘性"，
   * 即沿用上一轮已锁定的存活目标），而不是只看目标队列队首。 */
  function shipEffectiveTarget(ship) {
    const foes = ship.side === 'ally' ? enemies : allies;
    if (ship.lockTargetId) {
      const b = foes.find((f) => f.id === ship.lockTargetId && f.alive);
      return b || null; // 锁定单位不回落其他目标（即使锁定目标已阵亡也返回 null）
    }
    if (ship.targetId) {
      const u = foes.find((f) => f.id === ship.targetId && f.alive);
      if (u) return u;
    }
    if (ship.modules && ship.modules.length) {
      for (const inst of ship.modules) {
        const fx = (inst.cfg && inst.cfg.effects) || {};
        const kinds = (inst.cfg && inst.cfg.target && inst.cfg.target.kinds) || [];
        const offensive = kinds.includes('enemy') || kinds.includes('any') || (fx.damage > 0);
        if (!offensive) continue; // 跳过纯增益/召唤等不攻敌的模块
        const list = moduleTargetList(ship, inst);
        if (list.length) return list[0];
      }
    }
    return orderedFoes(foes, policyOf(ship))[0] || null;
  }

  /** 阵营策略预览：该阵营当前全队首个命中目标 */
  function fleetPreview(side) {
    const foes = side === 'ally' ? enemies : allies;
    return orderedFoes(foes, policies[side])[0] || null;
  }

  /* ---------- 目标级 护盾/血量/能量 词条管理 ----------
   * 指向"选定目标"的词条（kinds 可含 self/ally/enemy/any）：
   *   量值型（每次激活即时 加/减 当前值，正=加负=减）：
   *       shield_gain_target / hp_target / energy_target
   *   上限型（抬/压 cap，随本模块停用/时长结束/来源失效撤销）：
   *       shield_cap_target / hp_cap_target / energy_cap_target
   * shield_gain / shield_cap_bonus（只作用于自身的旧词条）仍由 recalcDerived 处理。
   */
  const capOverlays = new Map(); // targetId -> Map(sourceModId, {sh,hp,en})
  const AMOUNT = { shield_gain_target: 'shield', hp_target: 'hp', energy_target: 'energy' };
  const CAPFIELD = { shield_cap_target: 'sh', hp_cap_target: 'hp', energy_cap_target: 'en' };

  function ownerOf(inst) {
    for (const s of [...allies, ...enemies]) if (s.modules.includes(inst)) return s;
    return null;
  }

  /** 重算目标三围上限 = 自身(基础+被动+自身时长加成) + Σ目标级 cap 增/减
   *  每次均从各自基础值(baseShieldCap/baseHpMax/baseEnergyCap)重算，
   *  保证非累加：撤销旧影响后新施加不会在已减值上再叠。
   *  护盾叠加(shield_cap_target)记入“本体池”的 capExtra（随本体池容量由 recalcDerived
   *  一并钳制/汇总）；血量/能量叠加仍直接改对应上限（无池概念）。 */
  function recomputeCap(target) {
    const m = capOverlays.get(target.id);
    let sh = 0;
    let hp = 0;
    let en = 0;
    if (m) for (const v of m.values()) { sh += v.sh; hp += v.hp; en += v.en; }
    const base = baseShieldPoolOf(target);
    if (base) base.capExtra = sh; // 非累加：每次按目标级叠加总和重设
    recalcDerived(target); // 护盾池同步（本体池=baseShieldCap+capExtra、各模块池）并刷新汇总
    target.hull.hpMax = target.hull.baseHpMax; // 先复位血量/能量上限到基准
    target.hull.energyCap = target.hull.baseEnergyCap;
    if (hp !== 0) target.hull.hpMax = Math.max(1, target.hull.hpMax + hp);
    if (en !== 0) target.hull.energyCap = Math.max(0, target.hull.energyCap + en);
    target.hull.hp = Math.min(target.hull.hp, target.hull.hpMax);
    target.hull.energy = Math.min(target.hull.energy, target.hull.energyCap);
  }

  /** 设置/覆盖本模块对某目标某一 cap(sh/hp/en) 的增/减并立即生效 */
  function setOverlay(target, inst, field, value) {
    if (!capOverlays.has(target.id)) capOverlays.set(target.id, new Map());
    const src = capOverlays.get(target.id);
    if (!src.has(inst.id)) src.set(inst.id, { sh: 0, hp: 0, en: 0 });
    src.get(inst.id)[field] = value;
    recomputeCap(target);
  }

  /** 移除本模块对全部目标的 cap 影响（停用/时长结束/失效时调用）并重算受影响目标 */
  function dropSourceMods(inst) {
    let touched = false;
    for (const m of capOverlays.values()) {
      if (m.has(inst.id)) {
        m.delete(inst.id);
        touched = true;
      }
    }
    if (touched) for (const s of [...allies, ...enemies]) recomputeCap(s);
  }

  /** 启用/停用模块（处理自身被动重算 + 移除其目标级 cap 影响） */
  function enableModule(inst) {
    inst.enabled = true;
    const o = ownerOf(inst);
    if (o) recalcDerived(o); // 重新计入自身被动加成
  }
  function disableModule(inst) {
    inst.enabled = false;
    if (inst._ramp) inst._ramp = { key: '', count: 0 }; // 停用 → 逐步伤害成长归零
    dropSourceMods(inst); // 移除其施加在其它单位上的护盾上限影响
    const o = ownerOf(inst);
    if (!o) return;
    if (inst.durationLeft > 0) {
      inst.durationLeft = 0;
      inst.cooldown = inst.cfg.effects.cooldown_ticks ?? 1;
    }
    recalcDerived(o); // 结束自身被动/自身时长加成
  }

  /** 进入战斗（开始 tick 结算） */
  function start() {
    if (phase !== 'idle') return;
    phase = 'running';
    result = null;
    tickOff = bus.on('tick', step);
    bus.emit('combat:state', { active: true });
    log.add(i18n.t('battle.log.start'), 'battle');
  }

  /** 中止/离开战斗（未结算） */
  function stop() {
    if (tickOff) {
      tickOff();
      tickOff = null;
    }
    const wasActive = phase === 'running';
    phase = 'idle';
    result = null;
    if (wasActive) bus.emit('combat:state', { active: false });
  }

  /** 结算完成（随后自动存档） */
  function settle(res) {
    if (phase !== 'running') return;
    phase = 'settled';
    result = res;
    if (tickOff) {
      tickOff();
      tickOff = null;
    }
    bus.emit('battle:settled', { result: res });
    bus.emit('combat:state', { active: false }); // 结算完成后允许/触发存档
  }

  /* ---------- tick 结算 ---------- */

  /** 模块状态推进：
   *  - 有 duration_ticks 的模块：效果持续期递减；持续结束 → 撤销效果(重算派生)
   *    → 进入 cooldown_ticks 冷却；
   *  - 无 duration 的模块：直接按冷却递减（激活后进入冷却）。
   *  - 停用模块：一切冻结。
   */
  function moduleCycleTick(ship) {
    for (const inst of ship.modules) {
      if (!inst.enabled) continue; // 停用的模块冷却/持续冻结
      const fx = inst.cfg.effects;
      if (inst.durationLeft > 0) {
        inst.durationLeft -= 1;
        if (inst.durationLeft <= 0) {
          inst.durationLeft = 0;
          dropSourceMods(inst);   // 时长结束 → 撤销其对目标护盾上限的影响
          recalcDerived(ship);    // 撤销自身时长加成（如自身护盾上限回落）
          if ((fx.cooldown_ticks || 0) > 0) inst.cooldown = fx.cooldown_ticks ?? 1; // 进入冷却
        }
      } else if (inst.cooldown > 0) {
        inst.cooldown -= 1;
      }
    }
  }

  function energyRegenTick(ship) {
    ship.hull.energy = Math.min(
      ship.hull.energyCap,
      ship.hull.energy + ship.energyRegenPerSec / TPS
    );
  }

  /** 模块此刻是否处于"有效贡献窗口"（窗口冻结 → DPS 冻结） */
  function moduleActiveNow(ship, inst) {
    if (!ship.alive || !inst.enabled) return false;
    const fx = inst.cfg.effects;
    const hasDmg = (fx.damage || 0) > 0;
    const hasShield = (fx.shield_gain || 0) > 0;
    if (hasShield && !hasDmg) {
      // 纯回复类：须盾未满且能量足够（满盾/能量不足不算窗口）
      return ship.hull.shield < ship.hull.shieldCap && ship.hull.energy >= (fx.energy_cost || 0);
    }
    return true;
  }

  /** 召唤类模块执行：按 fx.summon 补召一个临时单位（携带模组数量不受该单位槽限约束）
   *  - 已达该阵营该单位的"最大召唤数" → 不召唤（保持待命，有空位即补召）
   *  - 能量不足 → 不召唤
   *  - 召唤单位存在 lifespan_ticks tick，到期自动死亡；临时单位阵亡/到期后直接移出场景 */
  function doSummon(ship, inst, fx, boundId, ignoreCap) {
    const sum = (fx.summon && typeof fx.summon === 'object') ? fx.summon : {};
    if (!sum.type) return;
    const side = ship.side;
    // 场上存活上限按"所属召唤模块"(family)计：不同召唤模块即使复用同一船型(如 drone)也不互相挤占。
    // ignoreCap：本次为"按目标数齐射"（per_target），不受该模块在场上限限制。
    if (!ignoreCap) {
      let n = 0;
      for (const u of sidesOf(side)) if (u.alive && u.summonMod === inst.moduleId) n += 1;
      if (n >= (sum.maxSummoned || 1)) return; // 已达该模块在场召唤数上限
    }
    const cost = fx.energy_cost || 0;
    if (ship.hull.energy < cost) return; // 能量不足
    ship.hull.energy -= cost;
    // —— 用召唤模块给通用无人机"覆写模板"：attrs 按船型结构整条可覆写，缺省沿用模板 ——
    const A = (sum.attrs && typeof sum.attrs === 'object') ? sum.attrs : {};
    const ov = {
      ...(A.nameKey ? { nameKey: A.nameKey } : {}),
      ...(A.base && typeof A.base === 'object' ? { base: A.base } : {}),
      ...(A.coefficients && typeof A.coefficients === 'object' ? { coefficients: A.coefficients } : {}),
    };
    // temp：缺省 true（临时单位，存在时间到期自动死亡+阵亡直接移除）；
    //     设 false 则召出的是一艘普通单位（无存在时间限制，阵亡保留灰色卡片）
    const isTemp = !(sum.temp === false);
    const u = spawnSummoned(sum.type, side, ov, isTemp);
    u.summonMod = inst.moduleId; // 用于按召唤模块统计在场存活上限（不同召唤模块互不挤占）
    if (isTemp) u.tempLeft = (sum.lifespan_ticks || 0) > 0 ? sum.lifespan_ticks : 60;
    u.summonIcon = A.icon || inst.cfg.icon || ''; // 召唤单位图标：attrs.icon 优先，其次模块 icon
    u.tempNoIcon = !u.summonIcon;                   // 无图标 → 单位降级 ▲
    // 显示名：模块给召唤单位显式指定名称词条(attrs.nameKey)则用之；
    // 模块未指定时才覆写为所属召唤模块名（模板 ship.drone 词条仅作缺省安全回退）。
    if (!A.nameKey) u.nameKey = inst.cfg.nameKey || u.nameKey;
    if (boundId) {
      u.lockTargetId = boundId; // 固定目标：召唤时锁定，不可再改（即使目标阵亡也不切换）
      u.targetId = boundId;
    }
    // 携带模组：等级默认 = 召唤模块等级；若 spec.level 显式给出则用之
    const mods = Array.isArray(sum.modules) ? sum.modules : [];
    for (const m of mods) {
      const spec = m && typeof m === 'object' ? m : { moduleId: m };
      const mid = spec.moduleId ?? spec.id;
      if (!mid) continue;
      const lv = spec.level ? spec.level : (inst.level || 1);
      installModule(u, mid, lv, true); // force：不受该单位模块槽上限约束（cool_first 引信在模块安装时统一处理）
    }
    fillShieldPools(u); // 满盾登场（同 spawnList 逻辑）：本体+模块各池补满
    // 继承模块所属船舰的自动策略与该船当前目标（仅非锁定单位；锁定单位目标由 boundId 固定）
    if (!boundId) {
      if (ship.policy) u.policy = ship.policy; // ship.policy 为空=跟随全队（召唤物同默认）
      const parentTarget = shipEffectiveTarget(ship);
      if (parentTarget && parentTarget.alive) {
        for (const inner of u.modules) {
          const ifx = (inner.cfg && inner.cfg.effects) || {};
          const ikinds = (inner.cfg && inner.cfg.target && inner.cfg.target.kinds) || [];
          const off = ikinds.includes('enemy') || ikinds.includes('any') || (ifx.damage > 0);
          if (off) inner._stick = [parentTarget.id];
        }
      }
    } else {
      inst._stick = [boundId]; // 发射器持续瞄准同一锁定目标（存活时）
    }
    inst.cooldown = fx.cooldown_ticks ?? 1;
    battleLog(
      'battle.log.summon',
      {
        ship: uTok(ship),
        unit: uTok(u),
        module: i18n.t(inst.cfg.nameKey),
      },
      ['ship', 'unit']
    );
  }

  /** 激活前可行性：时长型加盾模块（未在持续期即可激活）；纯增益须对某目标生效 */
  function canImpact(targets, fx, inst) {
    if ((fx.damage || 0) > 0) return true;
    // 目标级量值词条（shield/hp/energy）：负(削减)恒可影响；正(增益)需存在未满目标
    for (const k of Object.keys(AMOUNT)) {
      const v = fx[k] || 0;
      if (!v) continue;
      const f = AMOUNT[k];
      const atCap = (t) =>
        f === 'shield'
          ? t.hull.shield >= t.hull.shieldCap
          : f === 'hp'
            ? t.hull.hp >= t.hull.hpMax
            : t.hull.energy >= t.hull.energyCap;
      if (v < 0) return true;
      if (targets.some((t) => !atCap(t))) return true;
      return false; // 全满且为正增益 → 无益，不激活
    }
    // 目标级上限词条：恒可影响
    for (const k of Object.keys(CAPFIELD)) if ((fx[k] || 0) !== 0) return true;
    if ((fx.shield_gain || 0) > 0 && targets.some((t) => t.hull.shield < t.hull.shieldCap)) {
      return true;
    }
    if ((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0) {
      return !inst || inst.durationLeft <= 0; // 效果未在持续期 → 可激活
    }
    const tags = Array.isArray(fx.type) ? fx.type : fx.type ? [fx.type] : [];
    if (tags.length) return true; // 特殊效果视为可影响（预留）
    return false;
  }

  /** 统一的模块激活（词条执行器，与激活框架解耦） */
  function activate(ship, inst) {
    const fx = inst.cfg.effects;
    if (!fx || !inst.enabled) return;
    if (inst.cooldown > 0) return;
    if (inst.durationLeft > 0) return; // 持续效果进行中不可重复触发
    const cost = fx.energy_cost || 0;
    if (ship.hull.energy < cost) {
      // 能量不足：本次不触发；逐步伤害(ramp)成长清零 → 断能后伤害回到基础值
      if (inst._ramp) inst._ramp = { key: '', count: 0 };
      return;
    }

    // —— 召唤类模块（fx.summon 存在）：走召唤执行 ——
    if (fx.summon && typeof fx.summon === 'object' && fx.summon.type) {
      const sTypes = Array.isArray(fx.type) ? fx.type : fx.type ? [fx.type] : [];
      const perTarget = sTypes.includes('per_target'); // 特殊 type 标记：召唤数量 = 当前目标数（每个目标一枚）
      const needTargets = perTarget || fx.summon.bind_target; // 需先解析发射器模块目标
      const aimList = needTargets ? moduleTargetList(ship, inst) : [];
      if (perTarget) {
        // 逐目标补召一枚（每枚绑定其对应目标）；无目标则不召唤
        if (!aimList.length) return;
        for (const t of aimList) doSummon(ship, inst, fx, t.id, true); // ignoreCap：本次齐射不受在场上限限制
        return;
      }
      if (fx.summon.bind_target) {
        const boundId = aimList.length ? aimList[0].id : undefined;
        if (boundId) doSummon(ship, inst, fx, boundId); // 有目标才召唤并锁定
        return;
      }
      doSummon(ship, inst, fx);
      return;
    }

    const targets = moduleTargetList(ship, inst);
    // 自毁词条(self_destruct_damage)：即使无可命中目标也必须引爆自毁（始终触发）
    const isSuicide = (fx.self_destruct_damage || 0) !== 0;
    if (!isSuicide && !targets.length) return; // 无足够目标：本次不激活
    if (!isSuicide && !canImpact(targets, fx, inst)) return; // 无可生效目标：不激活不耗能

    ship.hull.energy -= cost;
    if ((fx.duration_ticks || 0) > 0) {
      // 持续时间词条：先进入持续期并【先应用时长型加成（生成该模块的护盾池）】，
      // 再执行瞬间效果词条（如 shield_gain 补盾）；持续结束后自动进冷却
      inst.durationLeft = fx.duration_ticks;
      inst.cooldown = 0;
      if ((fx.shield_cap_bonus || 0) > 0) {
        recalcDerived(ship);              // 生成该模块的护盾池（空池，总上限即提高）
        fillModuleShieldPool(ship, inst); // ★ 只把该模块自身池补满到其 cap；本体/其它模块池保持现值
        inst._shieldSeq = ++shieldSeq;    // 记录激活顺序（先激活的先被使用）
      }
    } else {
      inst.cooldown = fx.cooldown_ticks ?? 1;
    }

    // —— 目标级量值/上限词条：对每个选定目标同时生效（shield/hp/energy 三类）——
    const co = coeff(ship, inst.cfg.category);
    const amtKeys = Object.keys(AMOUNT).filter((k) => (fx[k] || 0) !== 0);
    const capKeys = Object.keys(CAPFIELD).filter((k) => (fx[k] || 0) !== 0);
    if (amtKeys.length || capKeys.length) {
      // 上限类词条为"单次一次性、仅对当前所选目标"：
      // 每次触发先撤销上次施加在(旧)目标上的上限影响，再对本次解析目标重新施加——
      // 故不随多次触发累加；切换目标后于下一次触发时生效到新目标（旧目标影响随之消失），
      // 携带者阵亡亦由 cleanDeadEffects 撤销。
      if (capKeys.length) dropSourceMods(inst);
      for (const target of targets) {
        for (const k of capKeys) setOverlay(target, inst, CAPFIELD[k], fx[k] * co);
        for (const k of amtKeys) {
          const amt = fx[k] * co;
          const f = AMOUNT[k];
          if (f === 'shield') {
            poolShieldAdd(target, amt); // 目标级护盾量值词条 → 作用到“池”（正=补 本体→模块池，负=汲取）
          } else if (f === 'energy') {
            target.hull.energy =
              amt > 0
                ? Math.min(target.hull.energyCap, target.hull.energy + amt)
                : Math.max(0, target.hull.energy + amt);
          } else {
            // hp：正=加血，负=扣血（直接作用于机体，可能致死）
            target.hull.hp =
              amt > 0
                ? Math.min(target.hull.hpMax, target.hull.hp + amt)
                : Math.max(0, target.hull.hp + amt);
              if (target.hull.hp <= 0 && target.alive) {
                target.hull.hp = 0;
                target.alive = false;
                battleLog('battle.log.destroyed', { ship: uTok(target) }, ['ship']);
              }
          }
        }
      }
    }

    let dmgTotal = 0;
    let shieldTotal = 0;
    // —— 逐步伤害（ramp_per_hit）：每次成功激活 +ramp，持续同一组目标则逐次累加 ——
    //  有 max_damage：从基础 damage 起涨，封顶 max_damage；无则从 0 起涨，封顶 damage。
    //  目标组改变（切换/阵亡）→ 于本次激活检测到并清零、重新累加。
    const baseRaw = fx.damage || 0;
    let effRaw = baseRaw;
    if ((fx.ramp_per_hit || 0) > 0) {
      const typeArr = fx.type || [];
      if (typeArr.includes('ramp_by_enemy_count')) {
        // —— type 钩子 ramp_by_enemy_count：单次伤害随“当前场上敌方存活数”提升（不随时间累积）——
        //    伤害 = 基础 damage + ramp_per_hit × 当前敌方存活数；有 max_damage 则封顶。
        //    敌方阵亡越多，单发伤害越低。 ——
        const foes = ship.side === 'ally' ? enemies : allies;
        let foeCount = 0;
        for (const f of foes) if (f.alive) foeCount += 1;
        const hasMax = (fx.max_damage || 0) > 0;
        const rawBonus = baseRaw + (fx.ramp_per_hit || 0) * foeCount;
        effRaw = hasMax ? Math.min(fx.max_damage, rawBonus) : rawBonus;
      } else {
        // —— type 钩子 ramp_full：仅当“目标选择的所有槽位都有目标”才逐击增伤；
        //    目标未满时（如 dualLaser 只命中 1/2）不成长，伤害维持基础 ——
        const needFull = typeArr.includes('ramp_full');
        let canRamp = true;
        if (needFull) {
          const reqCount = Math.max(
            1,
            (inst.cfg.target && inst.cfg.target.maxCount) || targets.length
          );
          canRamp = targets.length >= reqCount;
        }
        if (canRamp) {
          const sig = targets
            .map((u) => u.id)
            .sort()
            .join(',');
          if (!inst._ramp) inst._ramp = { key: '', count: 0 };
          if (sig !== inst._ramp.key) {
            inst._ramp.key = sig;
            inst._ramp.count = 0;
          }
          inst._ramp.count += 1; // 本次激活计数 +1
          const steps = inst._ramp.count - 1; // 首次=基础，此后每次激活 +ramp
          const hasMax = (fx.max_damage || 0) > 0;
          const cap = hasMax ? fx.max_damage : baseRaw;
          const start = hasMax ? baseRaw : 0;
          effRaw = Math.min(cap, start + (fx.ramp_per_hit || 0) * steps);
        }
      }
    }
    const effDmg = effRaw * coeff(ship, inst.cfg.category);
    const isBlastMod = isType(fx, 'blast'); // 爆炸型伤害（如火箭/导弹爆炸）
    let primaryBpAbsorbed = 0;              // 主目标命中进入防爆池的总量（用于抑制 blast_range）
    for (const target of targets) {
      // —— 词条执行器：依据 effects 中的词条对每个选定目标同时生效 ——
      if ((fx.damage || 0) > 0) {
        const dmg = effDmg;
        const out = { allyAbsorbed: 0, bpAbsorbed: 0 };
        const dealt = damageShip(target, dmg, ship, false, out, isBlastMod);
        dmgTotal += dealt + out.allyAbsorbed;
        primaryBpAbsorbed += out.bpAbsorbed;
        if (out.allyAbsorbed > 0) {
          // 命中同时打在目标与共享护盾层上：同时显示目标承伤与同盟/防爆承伤
          const key = out.bpAbsorbed > 0 ? 'battle.log.fireBlastproof' : 'battle.log.fireAlliance';
          battleLog(
            key,
            {
              actor: uTok(ship),
              target: uTok(target),
              dmg: Math.round(dealt),
              ally: Math.round(out.bpAbsorbed > 0 ? out.bpAbsorbed : out.allyAbsorbed),
            },
            ['actor', 'target']
          );
        } else {
          battleLog(
            'battle.log.fire',
            { actor: uTok(ship), target: uTok(target), dmg: Math.round(dealt) },
            ['actor', 'target']
          );
        }
      }
      if ((fx.shield_gain || 0) > 0) {
        const gain = fx.shield_gain * coeff(ship, inst.cfg.category);
        // 补盾作用到池：本体池(封顶 baseShieldCap+叠加) → 各模块池（各自封顶），汇总随之刷新
        const restored = poolShieldAdd(target, gain);
        shieldTotal += restored;
        if (restored > 0) target._healFlash = 40; // 回盾闪光标记（≈2s，UI 据此闪烁护盾条）
      }
      // 未来词条执行器在此追加（如 heal / energyDrain / shieldDrain …）
    }
    // —— 爆炸范围 blast_range：命中主目标后，对其所在队列"视觉顺序中的前后"各 blast_range 个位置内
    //    的存活单位同时造成同额爆炸伤害。目标在发射时锁定，爆炸不另行选目标、不随目标改变。 ——
    //    防爆护盾：主目标命中被防爆池吸收时，blast_range 被抑制（不再波及相邻单位）。 ——
    const blastR = ((fx.blast_range || 0) | 0);
    if (blastR > 0 && (fx.damage || 0) > 0 && !(isBlastMod && primaryBpAbsorbed > 0)) {
      const roster = ship.side === 'ally' ? enemies : allies; // 敌方队列（视觉顺序）
      const hitSet = new Set(targets.map((u) => u.id));       // 主目标已结算，不再重复受爆炸
      for (const primary of targets) {
        const idx = roster.findIndex((u) => u.id === primary.id);
        if (idx < 0) continue;
        for (let k = 1; k <= blastR; k += 1) {
          for (const nb of [roster[idx - k], roster[idx + k]]) {
            if (!nb || !nb.alive || hitSet.has(nb.id)) continue;
            hitSet.add(nb.id);
            const out = { allyAbsorbed: 0, bpAbsorbed: 0 };
            const dealt = damageShip(nb, effDmg, ship, false, out, isBlastMod);
            dmgTotal += dealt + out.allyAbsorbed;
            if (out.allyAbsorbed > 0) {
              const key =
                out.bpAbsorbed > 0 ? 'battle.log.blastBlastproof' : 'battle.log.blastAlliance';
              battleLog(
                key,
                {
                  actor: uTok(ship),
                  target: uTok(nb),
                  dmg: Math.round(dealt),
                  ally: Math.round(out.bpAbsorbed > 0 ? out.bpAbsorbed : out.allyAbsorbed),
                },
                ['actor', 'target']
              );
            } else {
              battleLog(
                'battle.log.blast',
                { actor: uTok(ship), target: uTok(nb), dmg: Math.round(dealt) },
                ['actor', 'target']
              );
            }
          }
        }
      }
    }
    // —— 自毁词条 self_destruct_damage：对所属单位自身血量"正加负减"（负值即扣光机体死亡）；
    //    始终触发（锁定目标即使已阵亡也照常引爆），且置于对目标造成伤害之后。 ——
    if (isSuicide && ship.alive) {
      const sdam = fx.self_destruct_damage || 0;
      ship.hull.hp =
        sdam > 0
          ? Math.min(ship.hull.hpMax, ship.hull.hp + sdam)
          : Math.max(0, ship.hull.hp + sdam);
      if (ship.hull.hp <= 0) {
        ship.hull.hp = 0;
        ship.alive = false;
        battleLog('battle.log.selfDestruct', { ship: uTok(ship) }, ['ship']);
      }
    }
    // 持久化自动目标（粘性）：无手动锁定时记住本次实际命中的目标，下次沿用存活者
    const autoLocked =
      !ship.targetId && (!inst.target || inst.target.mode === 'follow');
    if (autoLocked && targets.length) inst._stick = targets.map((t) => t.id);
    inst.lastDmg = dmgTotal;       // 本次激活造成的总伤害（供"本场贡献/本击"实时显示）
    inst.lastShield = shieldTotal; // 本次激活恢复的总护盾
    inst.stats.activations += 1;
    inst.stats.damageDealt += dmgTotal;
    inst.stats.shieldRestored += shieldTotal;
    inst.stats.energySpent += cost;
    // type 列表 = 特殊效果钩子（M1 无内建特殊钩子；M2 特殊模块在 activate 前/后挂接）
  }

  /** 手动指定目标（船级/模块级单/多选）阵亡 → 清理/回落上游 */
  function dropDeadTargets() {
    for (const ship of [...allies, ...enemies]) {
      const foes = ship.side === 'ally' ? enemies : allies;
      const aliveId = (id) => {
        const u = foes.find((f) => f.id === id);
        return u && u.alive;
      };
      if (ship.targetId && !ship.lockTargetId && !aliveId(ship.targetId)) {
        ship.targetId = null;
        battleLog('battle.log.autoTarget', { ship: uTok(ship) }, ['ship']);
      }
      for (const inst of ship.modules) {
        const t = inst.target;
        if (!t) continue;
        if (t.mode === 'unit') {
          if (!aliveId(t.id)) {
            inst.target = { mode: 'follow' };
            battleLog(
              'battle.log.moduleFollow',
              { ship: uTok(ship), module: i18n.t(inst.cfg.nameKey) },
              ['ship']
            );
          }
        } else if (t.mode === 'units') {
          const kept = (t.ids || []).filter(aliveId);
          if (kept.length !== (t.ids || []).length) {
            if (!kept.length) {
              inst.target = { mode: 'follow' };
              battleLog(
                'battle.log.moduleFollow',
                { ship: uTok(ship), module: i18n.t(inst.cfg.nameKey) },
                ['ship']
              );
            } else {
              t.ids = kept; // 部分目标阵亡：仅移除并保留其余
            }
          }
        }
      }
    }
  }

  /** 单位阵亡后清理其仍存续的效果（自身时长 buff / 施加到其它目标上的 cap 影响） */
  function cleanDeadEffects() {
    const all = [...allies, ...enemies];
    for (const ship of all) {
      if (ship.alive) continue;
      for (const inst of ship.modules) {
        if (inst.durationLeft > 0) inst.durationLeft = 0; // 结束自身时长 buff
        dropSourceMods(inst); // 撤销其对其它目标护盾上限的影响（若无则无操作）
      }
    }
    // 清除仍指向已阵亡目标（target 已死）的 cap 影响
    for (const tid of [...capOverlays.keys()]) {
      const t = all.find((s) => s.id === tid);
      if (!t || !t.alive) capOverlays.delete(tid);
    }
  }

  /** 破盾机制（独立池模型）：每个“时长型大护盾”模块（duration_ticks>0 且 shield_cap_bonus>0 且持续中）
   *  贡献一个独立护盾池（cap = shield_cap_bonus × 护盾系数，与 recalcDerived 一致）。
   *  - 该模块池被打空(pool.value ≤ 0) ⇔ “该护盾破盾”→ 立即结束其持续并进入冷却；
   *    与其它护盾/本体池是否打空无关。
   *  - no_break：破盾后仍保持激活（池打空也不提前结束，走自然持续到期），故不参与“破盾”判定。 */
  function breakShieldOnDepletion(ship) {
    if (!ship.alive) return;
    const broken = [];
    for (const inst of ship.modules) {
      if (!inst.enabled || !(inst.durationLeft > 0)) continue;
      const fx = inst.cfg.effects || {};
      if (!((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0)) continue;
      if (isType(fx, 'no_break')) continue;
      const p = ship.hull.pools.get(inst.id);
      if (p && p.value <= 1e-6) broken.push(inst); // 该模块池已被抽空 → 破盾
    }
    if (!broken.length) return;
    for (const inst of broken) {
      inst.durationLeft = 0;
      inst.cooldown = inst.cfg.effects.cooldown_ticks ?? 1; // 破盾 → 进入冷却
      battleLog(
        'battle.log.shieldBreak',
        { module: i18n.t(inst.cfg.nameKey), ship: uTok(ship) },
        ['ship']
      );
    }
    recalcDerived(ship); // 移除已破盾模块的池（值丢弃）并刷新汇总
  }

  function step() {
    if (phase !== 'running') return;
    runTicks += 1;
    activeAllies = allies; // 同盟护盾跨单位结算用的当前阵营引用
    activeEnemies = enemies;
    dropDeadTargets();
    cleanDeadEffects();
    const alive = [...allies, ...enemies].filter((s) => s.alive);
    for (const s of alive) {
      if (s._healFlash > 0) s._healFlash -= 1;   // 回盾闪光逐 tick 递减
      if (s._reflectFlash > 0) s._reflectFlash -= 1; // 反射闪光逐 tick 递减
      if (s._allyFlash > 0) s._allyFlash -= 1;   // 同盟层被吸收闪光逐 tick 递减
      if (s._bpFlash > 0) s._bpFlash -= 1;       // 防爆层被拦截/吸收闪光逐 tick 递减
      if (s._dmgFlash > 0) s._dmgFlash -= 1;     // 普通护盾受击闪光逐 tick 递减
    }
    for (const s of alive) moduleCycleTick(s);
    for (const s of alive) energyRegenTick(s);
    // 累计各模块有效贡献窗口（先于激活，含当前 tick）
    for (const s of alive) {
      for (const inst of s.modules) {
        if (moduleActiveNow(s, inst)) inst.stats.activeTicks += 1;
      }
    }
    // 敌方先行动，我方后行动（先手规则占位，M2 细调）。
    // 用 slice() 副本迭代：本次召唤/移除单位不干扰本轮遍历。
    for (const s of enemies.slice()) if (s.alive) for (const inst of s.modules.slice()) activate(s, inst);
    for (const s of allies.slice()) if (s.alive) for (const inst of s.modules.slice()) activate(s, inst);
    // —— 临时(召唤)单位生命周期：存在时间逐 tick 递减，到期自动死亡；
    //     临时单位阵亡/到期后直接移出场景（普通单位仍保留灰色卡片）——
    for (const side of ['ally', 'enemy']) {
      for (const u of sidesOf(side).slice()) {
        if (!u.temp) continue;
        if (u.alive) {
          u.tempLeft -= 1;
          if (u.tempLeft <= 0) {
            u.hull.hp = 0;
            u.alive = false;
            battleLog('battle.log.tempExpired', { ship: uTok(u) }, ['ship']);
          }
        }
        if (!u.alive) removeSummoned(side, u);
      }
    }
    for (const s of alive) breakShieldOnDepletion(s); // 破盾检测（护盾耗尽即提前结束护盾持续）
    checkEnd();
  }

  function checkEnd() {
    const anyAlly = allies.some((s) => s.alive);
    const anyEnemy = enemies.some((s) => s.alive);
    if (!anyEnemy) settle('win');
    else if (!anyAlly) settle('lose');
  }

  /** 汇总某阵营符合 pred 的“共享护盾池”（模块池，非本体）{value,max}：逐池累加池值/池容量。 */
  function poolTotalFor(side, pred) {
    let value = 0;
    let max = 0;
    for (const u of sidesOf(side)) {
      if (!u.alive) continue;
      for (const p of u.hull.pools.values()) {
        if (!p.inst) continue; // 本体池不参与共享统计
        if (!pred(p)) continue;
        value += p.value;
        max += p.cap;
      }
    }
    return { value, max };
  }

  return {
    get phase() { return phase; },
    get result() { return result; },
    get allies() { return allies; },
    get enemies() { return enemies; },
    get runTicks() { return runTicks; },
    get allyPolicy() { return policies.ally; },
    get enemyPolicy() { return policies.enemy; },
    setShipPolicy,
    setAllyPolicy(kind) {
      if (!TARGET_POLICIES.includes(kind)) return false;
      policies.ally = kind;
      for (const s of allies) if (!s.policy) for (const inst of s.modules) inst._stick = undefined;
      return true;
    },
    /** 全部存活单位（含双方） */
    units() { return [...allies, ...enemies]; },
    /** 某阵营同盟共享池的总盾量/上限（只统计非防爆 alliance && !blastproof 的模块池）。 */
    alliancePool(side) {
      return poolTotalFor(side, (p) => p.alliance && !p.blastproof);
    },
    alliancePoolTotal(side) { return this.alliancePool(side).value; },
    /** 某阵营防爆共享池的总盾量/上限（只统计 blastproof 的模块池）。 */
    blastPool(side) {
      return poolTotalFor(side, (p) => p.blastproof);
    },
    blastPoolTotal(side) { return this.blastPool(side).value; },
    moduleTargetList,
    shipEffectiveTarget,
    fleetPreview,
    enableModule,
    disableModule,
    start,
    stop,
  };
}

export default createBattle;
