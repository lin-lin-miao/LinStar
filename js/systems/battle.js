/* ===== systems/battle.js —— 战斗系统核心 =====
 * 战斗状态机：idle -> running -> settled（胜负结算）-> 可重新开始
 *
 * tick 结算顺序（两段式结算，见下方 step()）：
 *   Pass 1 —— 行动遍历（对 tick 起始存活全体【单遍单位 for】，每单位一次完成）：
 *     闪标递减 → __pending 初始化 → 清理自身指向已死目标的引用 → 能量回充 → 模块
 *     结构推进(时长/冷却倒计时，时长结束撤销)→ 判定并激活就绪模块(只记账不改目标数值)
 *     → 临时单位存在时间递减。全部单位【先记录后】，不再有“敌方先跑、先杀后”的顺序差
 *     → 同 tick 双方同归判 draw。
 *   Pass 2 —— 结算：
 *     Phase A（单遍单位 for）：合并应用各单位收到的 pending 数值影响(补/汲取盾、能量、
 *       血量、自毁)并收集本 tick 全部伤害命中(主目标/爆炸波及)。
 *     Phase B（相内子步，迭代命中条目）：按“普通/爆炸”吸收链结算真·武器/爆炸命中；
 *     Phase B2：反射返程统一在本 tick 命中全部结算完之后补打回（不递归、逐笔 noReflect）。
 *     Phase C（单遍单位 for 收尾）：统计写回 + 清 __pending + 临时单位移出。
 *     判死发生即就地撤销死者残留效果/cap(onDeath)，故不再需要 Pass0 的全量 dropDead/cleanDead。
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
 * 事件：'battle:settled' { result:'win'|'lose'|'draw' }
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

/* ===== 命中成句（逐吸收段）辅助 =====
 * 每笔命中断言 = 表头动词句 + 逗号罗列的“对{承接者}造成 N 点{dtype}伤害”各吸收段。
 * 承接者：目标自身时长盾模块(绿)、舰载护盾(base 池)、共享同盟/共享防爆、舰体(hull)。
 * 伤害类型 {dtype}：取伤害来源模块 fx.type 里的命中伤害标签(projectile→动能 / beam→能量)，
 * 无已识别标签→普通；反射返程→反射。模块名一律渲染绿色。 */
const DTYPE_TAGS = ['projectile', 'beam', 'explosive']; // 命中伤害类型标签（i18n battle.dmgType.* 建映射，可扩展）

/** 解析伤害来源模块的命中伤害类型标签 → 返回 i18n key 后缀（reflect 由调用方显式给） */
function damageTypeTag(fx) {
  const tags = Array.isArray(fx && fx.type) ? fx.type : fx && fx.type ? [fx.type] : [];
  for (const t of DTYPE_TAGS) if (tags.includes(t)) return t;
  return 'normal';
}
/** 模块名绿色段 */
function modTok(inst) {
  return { label: i18n.t(inst.cfg.nameKey), mod: true };
}
/** 一个吸收段 → 填入 {abs} 的值：自身护盾模块=绿段对象；舰载护盾/共享同盟/防爆/舰体=纯文本标签 */
function segAbs(s) {
  if (s.k === 'mod') return modTok(s.inst);
  return i18n.t('battle.abs.' + s.k); // base/alliance/blastproof/hull
}
/** 把 表头模板 + 逐吸收段模板 拼成一行并落日志（多段各自经 formatRich，再串联 msg/rich） */
function emitHitLog(headKey, headParams, seg, dtypeTag) {
  const dtype = i18n.t('battle.dmgType.' + dtypeTag);
  let msg = '';
  const rich = [];
  const append = (key, params, colorKeys) => {
    const r = formatRich(key, params, colorKeys);
    msg += r.msg;
    rich.push(...r.rich);
  };
  append(headKey, headParams, ['actor', 'target', 'attacker', 'owner']); // 单位红/蓝、模块(mod)恒绿
  for (const s of seg || []) {
    if (!(s && s.amount > 0)) continue;
    append('battle.log.hit.absorb', { abs: segAbs(s), amount: Math.round(s.amount), dtype }, []);
  }
  if (msg) log.add(msg, 'battle', rich);
}

/** 目标当前是否处于"无敌"：自身有某模块正处于激活的持续期内且其 effects.type 含 invincible。
 * 无敌 = 免疫一切经伤害结算（applyHit/旧 damageShip）的伤害（普通 + 爆炸波及）；
 * 自毁(self_destruct)为直接扣血，无法免疫。 */
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
  const spentOwners = new Set();
  for (const c of cands) {
    if (rest <= 0) break;
    const take = Math.min(c.p.value, rest);
    c.p.value -= take;
    touched.add(c.O);
    if (noBreakPoolSpent(c.O, c.p)) spentOwners.add(c.O); // no_break 共享池被抽空 → 标耗尽
    if (c.bp) {
      c.O._bpFlash = 40;   // 防爆层被吸收：护盾条橙色闪烁标记（≈2s）
      bpAbsorbed += take;
    } else {
      c.O._allyFlash = 40; // 同盟层被吸收：护盾条深蓝闪烁标记（≈2s）
    }
    rest -= take;
  }
  for (const O of touched) syncShieldSummary(O); // 被吸方汇总刷新
  for (const O of spentOwners) recalcDerived(O); // 已耗尽 no_break 池移除、cap 回落（recalc 亦刷新汇总）
  return { rest, bpAbsorbed };
}

/** 共享吸收把某施放者 O 的“no_break 时长护盾池”抽空(value≤0) → 标其 _shieldSpent(不再贡献 cap/池)。
 *  因共享池常由"队友承伤"抽干(不经过 O 自身的 breakShieldOnDepletion)，此处单独兜底。
 *  返回 true 表示该 O 需随后 recalcDerived 以落地 cap 回落。 */
function noBreakPoolSpent(O, pool) {
  if (!O || !O.alive || !pool || pool.value > 1e-6) return false;
  const inst = pool.inst;
  if (!inst || inst._shieldSpent) return false;
  const fx = inst.cfg && inst.cfg.effects;
  if (!fx || (fx.duration_ticks || 0) <= 0 || (fx.shield_cap_bonus || 0) <= 0) return false;
  if (!isType(fx, 'no_break')) return false;
  inst._shieldSpent = true; // 不动持续/冷却/日志，仅停贡献
  return true;
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
  const spentOwners = new Set();
  for (const c of cands) {
    if (rest <= 0) break;
    const take = Math.min(c.p.value, rest);
    c.p.value -= take;
    touched.add(c.O);
    if (noBreakPoolSpent(c.O, c.p)) spentOwners.add(c.O); // no_break 防爆池被抽空 → 标耗尽
    c.O._bpFlash = 40; // 防爆层被拦截：护盾条橙色闪烁标记（≈2s）
    drained += take;
    rest -= take;
  }
  for (const O of touched) syncShieldSummary(O); // 被吸方汇总刷新
  for (const O of spentOwners) recalcDerived(O); // 已耗尽 no_break 池移除、cap 回落（recalc 亦刷新汇总）
  return { rest, drained };
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
  let reflectQueue = []; // 本 tick 反射返程记账：{ owner, attacker, mod, amount }，待"武器/爆炸命中全部结算完"后统一补打回并成句

  /** 开战/召唤即满盾就位：把单位“自带持续护盾”（时长型护盾模块，duration_ticks>0 且
   *  shield_cap_bonus>0）视为已在首个可行动 tick 就位满盾——按 spawnList/doSummon 已用的
   *  fillShieldPools/满盾逻辑，把该模块池补满。复用机制，不逐 tick 白送盾（仅登场一次）。
   *  实现：令该模块进入持续期（生池）并只把其自身池补满到 cap（本体/其它模块池保持现值），
   *  记激活序 _shieldSeq。 */
  function seedSpawnShields(ship) {
    if (!ship || !ship.alive) return ship;
    for (const inst of ship.modules || []) {
      if (!inst.enabled) continue;
      const fx = inst.cfg && inst.cfg.effects;
      if (!fx) continue;
      if (!((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0)) continue; // 仅持续护盾
      if (inst.durationLeft > 0) continue; // 已在持续期
      inst.durationLeft = fx.duration_ticks;
      inst.cooldown = 0;
      inst._shieldSpent = false; // 首次激活/重新激活：确保不残留"已耗尽"标记
      recalcDerived(ship);              // 生成该模块的护盾池（空池）
      fillModuleShieldPool(ship, inst); // ★ 只把该模块自身池补满到 cap
      inst._shieldSeq = ++shieldSeq;    // 记录激活顺序（先激活先使用）
    }
    syncShieldSummary(ship);
    return ship;
  }

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
      seedSpawnShields(ship); // 自带持续护盾首 tick 即满盾就位
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

  /* ---------- tick 结算（Pass 0 / Pass 1 行动遍历 / Pass 2 结算遍历） ---------- */

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
    seedSpawnShields(u); // 自带持续护盾首 tick 即满盾就位
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

  /* ---------- pending 记账 ----------
   * 每个存活单位一个 __pending，Pass 1 写入、Pass 2 统一结算：
   *   dmg:           本 tick 对该单位造成的伤害（主目标/爆炸波及条目，含反射来源信息）
   *                  每条 { actor, inst(来源模块), amount, blast, splash, gate? }
   *   shieldHeals:   对本单位自身池的 补盾(正)/汲取(负) 序列（shield_gain / shield_gain_target），
   *                  每条 { inst, amount }，用于 Pass2 顺序 poolShieldAdd。
   *   energyDeltas:  对本单位能量的直接增/减序列（energy_target），每条 { inst, amount }。
   *   hpDeltas:      对本单位血量的直接增/减序列（hp_target），负可致死，每条 { inst, amount }。
   *   selfDestruct:  { inst, amount }｜null —— self_destruct_damage（对本单位自身直接扣/回血，致死记 selfDestruct）。 */
  function freshPending() {
    return { dmg: [], shieldHeals: [], energyDeltas: [], hpDeltas: [], selfDestruct: null };
  }
  /** 惰性取某单位 pending（召唤新单位当 tick 被锁定命中时也能挂账） */
  function pendOf(u) {
    if (!u) return null;
    if (!u.__pending) u.__pending = freshPending();
    return u.__pending;
  }

  /** 单模块状态结构推进 + 有效贡献窗口累计（时长/冷却倒计时，时长结束→撤销自身加成并进冷却）。
   *  Pass1 单位遍历内、逐模块调用（先结构推进，再判定是否激活）。 */
  function advanceModuleState(ship, inst) {
    if (!inst.enabled) return; // 停用模块：冷却/持续/窗口全部冻结
    const fx = inst.cfg.effects;
    if (inst.durationLeft > 0) {
      inst.durationLeft -= 1;
      if (inst.durationLeft <= 0) {
        inst.durationLeft = 0;
        dropSourceMods(inst); // 时长结束 → 撤销其对目标护盾上限的影响
        recalcDerived(ship);  // 撤销自身时长加成（如自身护盾上限回落）
        if ((fx.cooldown_ticks || 0) > 0) inst.cooldown = fx.cooldown_ticks ?? 1; // 进入冷却
      }
    } else if (inst.cooldown > 0) {
      inst.cooldown -= 1;
    }
    // 有效贡献窗口累计（读本 tick 起始态，先于本模块激活）
    if (moduleActiveNow(ship, inst)) inst.stats.activeTicks += 1;
  }

  /** 单位判死瞬间就地清理其全局残留（原 cleanDeadEffects“对死者”部分，逐死就地执行、省去每 tick 全量循环）：
   *  - 撤销死者自身仍在持续的时长 buff；
   *  - 撤销它施加到其它目标上的 cap 影响(dropSourceMods → 受影响目标重算)；
   *  - 清除仍指向“该死者(作为被叠加目标，已死)”的 cap 叠加。 */
  function onDeath(ship) {
    for (const inst of ship.modules) {
      if (inst.durationLeft > 0) inst.durationLeft = 0; // 结束自身时长 buff
      dropSourceMods(inst); // 撤销其对其它目标护盾上限的影响（若无则无操作）
    }
    if (capOverlays.has(ship.id)) capOverlays.delete(ship.id); // 施加在死者身上的 cap 不再需要维持
  }

  /** 清理本存活单位指向“已判死目标”的引用并回落上游（原 dropDeadTargets 里“每存活单位清自身引用”部分）。
   *  Pass1 每单位开头执行：上一 tick 判死的目标，本 tick 行动前即时回落。 */
  function clearShipDeadRefs(ship) {
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

  /** 单位临时生命周期：Pass1 单位遍历末尾递减；到期就地判死并清理（日志 tempExpired） */
  function pass1TempLifespan(ship) {
    if (!ship.temp || !ship.alive) return;
    ship.tempLeft -= 1;
    if (ship.tempLeft <= 0) {
      ship.hull.hp = 0;
      ship.alive = false;
      battleLog('battle.log.tempExpired', { ship: uTok(ship) }, ['ship']);
      onDeath(ship); // 就地撤销其存续效果/cap 影响
    }
  }

  /**
   * Pass1 —— 模块激活（词条执行器判定段，不立即改目标数值）。
   * 只推进模块自身副作用（durationLeft/cooldown/_shieldSeq/自身护盾生池填池/召唤/上限叠加/粘性目标）
   * 并把对目标的数值影响写入 pending；目标值统一在 Pass2 结算。
   */
  function maybeActivate(ship, inst) {
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

    // —— 召唤类模块（fx.summon 存在）：走召唤执行（立即生成单位，属结构性副作用） ——
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

    // —— 非召唤模块：解析目标并做可行性判定（目标解析读 tick 起始快照，不受本 tick pending 影响）——
    const targets = moduleTargetList(ship, inst);
    // 自毁词条(self_destruct_damage)：即使无可命中目标也必须引爆自毁（始终触发）
    const isSuicide = (fx.self_destruct_damage || 0) !== 0;
    if (!isSuicide && !targets.length) return; // 无足够目标：本次不激活
    if (!isSuicide && !canImpact(targets, fx, inst)) return; // 无可生效目标：不激活不耗能

    ship.hull.energy -= cost; // 自身能量消耗：立即扣（单位自身资源，Pass1 内同一单位模块按序门控）
    if ((fx.duration_ticks || 0) > 0) {
      // 持续时间词条：先进入持续期并【先应用时长型加成（生成该模块的护盾池）】，
      // 持续结束后自动进冷却；瞬间量值词条改由 pending 在 Pass2 结算。
      inst.durationLeft = fx.duration_ticks;
      inst.cooldown = 0;
      if ((fx.shield_cap_bonus || 0) > 0) {
        inst._shieldSpent = false;        // 重新激活：清除上轮"已耗尽"标记 → 重新贡献独立池/回满
        recalcDerived(ship);              // 生成该模块的护盾池（空池，总上限即提高）
        fillModuleShieldPool(ship, inst); // ★ 只把该模块自身池补满到其 cap；本体/其它模块池保持现值
        inst._shieldSeq = ++shieldSeq;    // 记录激活顺序（先激活的先被使用）
      }
    } else {
      inst.cooldown = fx.cooldown_ticks ?? 1;
    }

    // —— 目标级 量值/上限 词条：对每个选定目标同时生效（shield/hp/energy 三类）——
    const co = coeff(ship, inst.cfg.category);
    const amtKeys = Object.keys(AMOUNT).filter((k) => (fx[k] || 0) !== 0);
    const capKeys = Object.keys(CAPFIELD).filter((k) => (fx[k] || 0) !== 0);
    if (capKeys.length) {
      // 上限类词条为"单次一次性、仅对当前所选目标"：
      // 每次触发先撤销上次施加在(旧)目标上的上限影响，再对本次解析目标重新施加——
      // 故不随多次触发累加；切换目标后于下一次触发时生效到新目标（旧目标影响随之消失），
      // 上限叠加属结构性(重算池/上限)，立即应用，以便 Pass2 承伤读到最新护盾池。
      // 携带者阵亡时由其判死点 onDeath 就地撤销（dropSourceMods）。
      dropSourceMods(inst);
      for (const target of targets) {
        for (const k of capKeys) setOverlay(target, inst, CAPFIELD[k], fx[k] * co);
      }
    }
    for (const target of targets) {
      const P = pendOf(target);
      if (!P) continue;
      for (const k of amtKeys) {
        const amt = fx[k] * co;
        const f = AMOUNT[k];
        if (f === 'shield') P.shieldHeals.push({ inst, amount: amt }); // 目标级护盾量值 → Pass2 作用到池
        else if (f === 'energy') P.energyDeltas.push({ inst, amount: amt });
        else P.hpDeltas.push({ inst, amount: amt }); // hp：正加血负扣血（直接机体，可致死）
      }
    }
    // fx.shield_gain（旧词条，作用于目标，如 alphaShield 自回盾）→ 同入 shieldHeals（Pass2 结算）
    if ((fx.shield_gain || 0) > 0) {
      for (const target of targets) {
        const P = pendOf(target);
        if (P) P.shieldHeals.push({ inst, amount: fx.shield_gain * co });
      }
    }

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
    // —— 主目标伤害（pending 记账，Pass2 结算实际吸收/扣血并判破盾/反射）——
    if ((fx.damage || 0) > 0) {
      for (const target of targets) {
        const P = pendOf(target);
        if (P) P.dmg.push({ actor: ship, inst, amount: effDmg, blast: isBlastMod, splash: false });
      }
      // —— 爆炸范围 blast_range：命中主目标后，对其所在队列"视觉顺序中的前后"各 blast_range 个位置内
      //    的存活单位同时造成同额爆炸伤害。目标在发射时锁定，爆炸不另行选目标、不随目标改变。 ——
      //    防爆护盾：若主目标命中被防爆池吸收(isBlastMod)，blast_range 被抑制（不再波及相邻单位）——
      //    Pass1 无法预知是否被防爆吸收，故一律按“条件爆炸(带 gate)”挂账，Pass2 按主目标结果决定是否跳过。
      const blastR = ((fx.blast_range || 0) | 0);
      if (blastR > 0) {
        const roster = ship.side === 'ally' ? enemies : allies; // 敌方队列（视觉顺序）
        const hitSet = new Set(targets.map((u) => u.id));       // 主目标已结算，不再重复受爆炸
        const actKey = `${ship.id}:${inst.id}`;                 // 每次激活唯一 gate（爆炸抑制按整次激活）
        for (const primary of targets) {
          const idx = roster.findIndex((u) => u.id === primary.id);
          if (idx < 0) continue;
          for (let k = 1; k <= blastR; k += 1) {
            for (const nb of [roster[idx - k], roster[idx + k]]) {
              if (!nb || !nb.alive || hitSet.has(nb.id)) continue;
              hitSet.add(nb.id);
              const P = pendOf(nb);
              if (P) {
                P.dmg.push({
                  actor: ship,
                  inst,
                  amount: effDmg,
                  blast: isBlastMod,
                  splash: true,
                  gate: isBlastMod ? actKey : null, // 仅爆炸型主模块可被防爆抑制
                });
              }
            }
          }
        }
      }
    }
    // —— 自毁词条 self_destruct_damage：对所属单位自身血量"正加负减"（负值即扣光机体死亡）；
    //    始终触发（锁定目标即使已阵亡也照常引爆），Pass2 在自身血量上结算。 ——
    if (isSuicide && ship.alive) {
      const P = pendOf(ship);
      if (P) P.selfDestruct = { inst, amount: fx.self_destruct_damage || 0 };
    }
    // 持久化自动目标（粘性）：无手动锁定时记住本次实际命中的目标，下次沿用存活者
    const autoLocked =
      !ship.targetId && (!inst.target || inst.target.mode === 'follow');
    if (autoLocked && targets.length) inst._stick = targets.map((t) => t.id);
    // 本次激活统计：activations / energy 立即记；damage/shield 实际量 Pass2 结算后累计到 _pendingAct
    inst._pendingAct = { dmg: 0, shield: 0 };
    inst.stats.activations += 1;
    inst.stats.energySpent += cost;
  }

  /** Pass1 —— 单位级行动遍历：对一个单位一次做完全部“行动”侧工作。
   *  （原分散的 闪标递减 / __pending 初始化 / 自身死目标引用清理 / 能量回充 /
   *    模块结构推进与窗口累计 / 模块激活记账 / 临时单位生命周期 归并到这里，Pass1 只对单位跑一次。）
   *  闪标/挂账只对本 tick 行动的存活单位有意义，故在此一并完成，不再单独全量循环。 */
  function pass1Unit(ship) {
    // —— 本 tick 起始：护盾/反射/同盟/防爆/受击闪标逐 tick 递减 ——
    if (ship._healFlash > 0) ship._healFlash -= 1;
    if (ship._reflectFlash > 0) ship._reflectFlash -= 1;
    if (ship._allyFlash > 0) ship._allyFlash -= 1;
    if (ship._bpFlash > 0) ship._bpFlash -= 1;
    if (ship._dmgFlash > 0) ship._dmgFlash -= 1;
    // （本 tick 挂账已在 Pass1 遍历前为全体存活单位一次性建好，见 step()；
    //   召唤新增单位由 pendOf 惰性创建，此处不再重置，以免冲掉排前单位记到其身上的记账。）
    // —— 清理自己指向“已判死目标”的引用（原 dropDeadTargets 中“每存活单位”部分）——
    clearShipDeadRefs(ship);
    // —— 把能量回充视作单位内建自行动 ——
    energyRegenTick(ship);
    // —— 模块：① 结构推进(时长/冷却递减、到期撤销、窗口累计) ② 判定激活(记账不改数值) ——
    for (const inst of ship.modules) advanceModuleState(ship, inst);
    for (const inst of ship.modules) maybeActivate(ship, inst);
    // —— 临时单位存在时间递减（到期就地判死并清理）——
    pass1TempLifespan(ship);
  }

  /* ---------------- Pass 2 结算 ---------------- */

  function applyEnergyTo(u, amount) {
    if (!u || !u.alive) return;
    u.hull.energy =
      amount > 0
        ? Math.min(u.hull.energyCap, u.hull.energy + amount)
        : Math.max(0, u.hull.energy + amount);
  }
  function applyHpTo(u, amount) {
    if (!u || !u.alive) return;
    u.hull.hp =
      amount > 0
        ? Math.min(u.hull.hpMax, u.hull.hp + amount)
        : Math.max(0, u.hull.hp + amount);
    if (u.hull.hp <= 0 && u.alive) {
      u.hull.hp = 0;
      u.alive = false;
      battleLog('battle.log.destroyed', { ship: uTok(u) }, ['ship']);
      onDeath(u); // 就地撤销死者残留效果/cap 影响
    }
  }

  /** Pass2 单单位：合并并应用本 tick 收到的 非伤害 数值 pending（补/汲取盾、能量、血量、自毁） */
  function settleNonDamage(u) {
    const P = u.__pending;
    if (!P || !u.alive) return;
    let drainedShield = false;
    for (const h of P.shieldHeals) {
      const act = poolShieldAdd(u, h.amount); // 实际作用量（正=补入，负=汲取）
      if (act < 0) drainedShield = true;      // 汲取(负)可能把池抽空 → 抽空即破盾
      if (act > 0) {
        u._healFlash = 40; // 回盾闪光标记（≈2s）
        if (h.inst && h.inst._pendingAct) h.inst._pendingAct.shield += act;
      }
    }
    for (const e of P.energyDeltas) applyEnergyTo(u, e.amount);
    for (const h of P.hpDeltas) applyHpTo(u, h.amount);
    if (drainedShield && u.alive) breakShieldOnDepletion(u); // 汲取抽空的池：就地破盾降 cap
    if (P.selfDestruct && u.alive) {
      const sdam = P.selfDestruct.amount;
      u.hull.hp =
        sdam > 0
          ? Math.min(u.hull.hpMax, u.hull.hp + sdam)
          : Math.max(0, u.hull.hp + sdam);
      if (u.hull.hp <= 0) {
        u.hull.hp = 0;
        u.alive = false;
        battleLog('battle.log.selfDestruct', { ship: uTok(u) }, ['ship']);
        onDeath(u); // 就地撤销死者残留效果/cap 影响
      }
    }
  }

  /** 单次伤害结算：护盾吸收 →（爆炸先防爆拦截）→ 自身池 → 同盟/防爆共享 → 扣血；反射记账。
   * 返回 { dealt, ally, bpAbsorbed, seg }：
   *   dealt      自身池吸收 + 扣血（供 “对目标造成伤害” 统计）；
   *   ally       同盟/防爆共享池吸收总量（含防爆拦截）；
   *   bpAbsorbed 其中进入防爆池的部分（含防爆拦截）；
   *   seg        逐吸收源明细（按引擎实际吸收顺序）：{k:'mod'|'base'|'alliance'|'blastproof'|'hull', inst?, amount}，
   *              供日志按承接者逐段成句。
   * noReflect=true 时该次伤害不再触发反射（用于反射返程的补打回，避免双方反射死循环）。 */
  function applyHit(target, amount, blast, actor, noReflect) {
    const zero = { dealt: 0, ally: 0, bpAbsorbed: 0, seg: [] };
    if (!target || !target.alive || amount <= 0) return zero;
    if (invincibleNow(target)) return zero; // 无敌：不受伤害、不阵亡
    let killed = false; // 本次命中有无把目标击毁（供调用方在“命中句之后”补记被击毁句）
    let rest = amount;
    let dealt = 0;        // 自身池吸收 + 扣血
    let ownAbs = 0;       // 自身池吸收量
    let allyAbs = 0;      // 共享(同盟/防爆)吸收总量
    let bpAbs = 0;        // 共享吸收中进入防爆池的部分
    const takes = [];     // 自身池逐池吸收明细（供反射核算）
    const seg = [];       // 逐吸收源明细（按引擎实际吸收顺序）：{k, inst?, amount}
    // ① 防爆拦截（仅爆炸型）：受防爆护盾保护时先用友方防爆池挡（即使目标自带护盾，爆炸也不伤目标）
    if (blast && rest > 0) {
      const bp = drainBlastproof(target, rest);
      const drained = rest - bp.rest;
      if (drained > 0) { allyAbs += drained; bpAbs += drained; seg.push({ k: 'blastproof', amount: drained }); }
      rest = bp.rest;
    }
    // ② 自身护盾池承伤：普通伤 base→非防爆模块池（防爆存在不再禁吃本体/其它模块盾）；
    //    爆炸伤可再吃防爆模块池（通常已在①被拦截耗尽）。
    if (rest > 0) {
      const before = rest;
      const own = absorbOwnPools(target, rest, !!blast);
      ownAbs = before - own.rest;
      if (ownAbs > 0) {
        dealt += ownAbs;
        takes.push(...own.takes);
        target._dmgFlash = 40; // 普通护盾受击：护盾条白色闪烁（≈2s；反射/同盟/防爆等各有其色，覆盖此白）
      }
      for (const t of own.takes) {
        if (t.take > 0) seg.push(t.pool.inst ? { k: 'mod', inst: t.pool.inst, amount: t.take } : { k: 'base', amount: t.take });
      }
      rest = own.rest;
    }
    // ③ 自身池耗尽且伤害将扣血：友方同盟/防爆护盾(施放者共享模块池)代为吸收；不够的部分才真正扣血
    if (rest > 0) {
      const beforeAlly = rest;
      const ar = absorbByAlliance(target, rest, !!blast);
      const ab = beforeAlly - ar.rest;
      allyAbs += ab;
      bpAbs += ar.bpAbsorbed;
      if (ar.bpAbsorbed > 0) seg.push({ k: 'blastproof', amount: ar.bpAbsorbed }); // 爆炸：③内防爆优先
      if (ab - ar.bpAbsorbed > 0) seg.push({ k: 'alliance', amount: ab - ar.bpAbsorbed });
      rest = ar.rest;
    }
    if (rest > 0) {
      target.hull.hp -= rest;
      dealt += rest;
      seg.push({ k: 'hull', amount: rest });
    }
    if (target.hull.hp <= 0 && target.alive) {
      target.hull.hp = 0;
      target.alive = false;
      killed = true; // 击毁句推迟：由调用方在本命中句之后补记（保证“开火先于被击毁”）
      onDeath(target); // 就地撤销死者残留效果/cap 影响
    }
    // —— 反射护盾（反馈式）：落在目标“反射护盾模块池”内被消耗的量按 shield_reflect 返还给攻击者。
    //    不在此递归/成句打回，而是把返程(含反射模块名)记入 reflectQueue，待本 tick 全部武器/爆炸
    //    命中结算完后统一补打回并组合成句；闪标即时发生。 ——
    if (!noReflect && actor && actor !== target && ownAbs > 0) {
      let reflected = 0;
      let reflectMod = null;
      for (const t of takes) {
        const pool = t.pool;
        const inst = pool && pool.inst;
        const fx = inst && inst.cfg && inst.cfg.effects;
        if (!fx || (fx.shield_reflect || 0) <= 0) continue;
        reflected += (fx.shield_reflect || 0) * t.take;
        if (!reflectMod) reflectMod = inst; // 反射模块名（通常唯一）
      }
      if (reflected > 0) {
        target._reflectFlash = 40; // 反射闪光标记（≈2s，UI 据此闪烁护盾条黄色）
        reflectQueue.push({ owner: target, attacker: actor, mod: reflectMod, amount: reflected });
      }
    }
    // 破盾就地结算：伤害把目标某“自身时长护盾池”抽空(value≤0)即在此处理（普通→结束持续；no_break→标已耗尽）。
    if (target.alive && ownAbs > 0) breakShieldOnDepletion(target);
    return { dealt, ally: allyAbs, bpAbsorbed: bpAbs, seg, killed };
  }

  /** 把单条伤害命中落地成句 + 累加来源模块统计（Pass2 内调用）。
   *  表头：主目标普通=开火命中 / 主目标爆炸=爆炸命中 / 波及=溅射到；
   *  后接按引擎实际吸收顺序的逐吸收段（舰载护盾/自身时长盾模块(绿)/共享同盟/共享防爆/舰体）。 */
  function landDamageApp(app, res) {
    if (app.inst && app.inst._pendingAct) {
      app.inst._pendingAct.dmg += res.dealt + res.ally; // 自身池吸收 + 扣血 + 共享吸收 = 总伤害
    }
    const seg = res && res.seg;
    if (!seg || !seg.length) return; // 0 伤害 / 无敌：不产出成句
    const headKey = app.splash
      ? 'battle.log.hit.splash'
      : app.blast
        ? 'battle.log.hit.blast'
        : 'battle.log.hit.fire';
    const dtypeTag = app.inst ? damageTypeTag(app.inst.cfg && app.inst.cfg.effects) : 'normal';
    emitHitLog(
      headKey,
      { actor: uTok(app.actor), weapon: app.inst ? modTok(app.inst) : null, target: uTok(app.target) },
      seg,
      dtypeTag
    );
    // 被击毁句紧跟在本命中句之后（保证“开火/溅射先于被击毁”的显示顺序）。
    if (res.killed) battleLog('battle.log.destroyed', { ship: uTok(app.target) }, ['ship']);
  }

  /** Pass2 相内子步 —— 结算本 tick 的全部武器/爆炸伤害命中（迭代的是“pending 命中条目”，非每 tick 全量单位）。
   * 主目标先行（确定防爆抑制），后爆炸波及；反射只在此记账(reflectQueue)，真·命中全部结算后由 step 统一返程。 */
  function settleHits(primaries, splashes) {
    // 主目标先行：若爆炸型主目标伤害被防爆池吸收，则其 blast_range 波及被抑制（跳过 gate 内波及）。
    const suppressedGates = new Set();
    for (const app of primaries) {
      if (!app.target.alive) continue; // 目标已判死：不结算该条命中（不重复、不落到已死单位）
      const res = applyHit(app.target, app.amount, app.blast, app.actor, false);
      landDamageApp(app, res);
      if (app.blast && res.bpAbsorbed > 0) {
        suppressedGates.add(`${app.actor.id}:${app.inst.id}`);
      }
    }
    for (const app of splashes) {
      if (!app.target.alive) continue; // 目标已判死：波及不落到已死亡单位
      if (app.gate && suppressedGates.has(app.gate)) continue; // 防爆已拦截主目标 → 不波及相邻
      const res = applyHit(app.target, app.amount, app.blast, app.actor, false);
      landDamageApp(app, res);
    }
  }

  /** 破盾机制（独立池模型）：每个“时长型大护盾”模块（duration_ticks>0 且 shield_cap_bonus>0 且持续中）
   *  贡献一个独立护盾池（cap = shield_cap_bonus × 护盾系数，与 recalcDerived 一致）。
   *  - 该模块池被打空(pool.value ≤ 0) ⇔ 该护盾层耗尽：
   *      · 普通模块（硬化/反射等，非 no_break）→ “破盾”→ 立即结束其持续并进入冷却；
   *      · no_break 模块（同盟/防爆等）→ 仅标记 inst._shieldSpent：不再贡献总 cap/独立池，
   *        但持续/冷却/日志不动，维持激活直到自然持续到期。
   *  - 与其它护盾/本体池是否打空无关。 */
  function breakShieldOnDepletion(ship) {
    if (!ship.alive) return;
    const broken = [];
    const spentNoBreak = [];
    for (const inst of ship.modules) {
      if (!inst.enabled || !(inst.durationLeft > 0)) continue;
      const fx = inst.cfg.effects || {};
      if (!((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0)) continue;
      const p = ship.hull.pools.get(inst.id);
      if (!p || p.value > 1e-6) continue; // 该模块池未被抽空
      if (isType(fx, 'no_break')) {
        // no_break：层被打空 → 只标记"已耗尽"，不再贡献总 cap；持续/冷却/日志均不动（走自然持续到期）。
        if (!inst._shieldSpent) spentNoBreak.push(inst);
      } else {
        broken.push(inst); // 普通破盾：结束持续 + 进冷却
      }
    }
    if (!broken.length && !spentNoBreak.length) return;
    for (const inst of broken) {
      inst.durationLeft = 0;
      inst.cooldown = inst.cfg.effects.cooldown_ticks ?? 1; // 破盾 → 进入冷却
      battleLog(
        'battle.log.shieldBreak',
        { module: i18n.t(inst.cfg.nameKey), ship: uTok(ship) },
        ['ship']
      );
    }
    for (const inst of spentNoBreak) inst._shieldSpent = true; // 不提前结束，仅停贡献
    recalcDerived(ship); // 移除已破盾模块的池（值丢弃）；no_break 已耗尽者的池也被 contributingShieldFx 排除 → 一并删除、cap 回落
  }

  /* （原 dropDeadTargets / cleanDeadEffects 的每 tick 全量循环已去除：
   *   - 存活单位清理“自身指向已死目标的引用” → Pass1 每单位开头 clearShipDeadRefs(ship)；
   *   - 死者撤销自身时长 buff / 其 cap 影响 / 施加在死者上的 cap → 各判死点就地 onDeath(ship)。） */

  /** Pass2 内、每单位一次：把本 tick 激活模块的结算统计写回（lastDmg/lastShield + 累计）。
   * 由 Pass2 收尾单遍单位 for 调用；在临时单位移出前执行以保证死去的召唤也能累计。 */
  function finalizeModules(ship) {
    for (const inst of ship.modules) {
      const pa = inst._pendingAct;
      if (!pa) continue;
      inst.lastDmg = pa.dmg;       // 本次激活实际造成的总伤害
      inst.lastShield = pa.shield; // 本次激活实际恢复的总护盾
      inst.stats.damageDealt += pa.dmg;
      inst.stats.shieldRestored += pa.shield;
      inst._pendingAct = undefined;
    }
  }

  function checkEnd() {
    const anyAlly = allies.some((s) => s.alive);
    const anyEnemy = enemies.some((s) => s.alive);
    if (!anyAlly && !anyEnemy) settle('draw'); // 同 tick 双方同归 → 判和
    else if (!anyEnemy) settle('win');
    else if (!anyAlly) settle('lose');
  }

  /** 每 tick 主入口：Pass 1 行动遍历（单遍单位 for）→ Pass 2 结算（单遍单位 for + 命中子步 + 收尾单遍）。 */
  function step() {
    if (phase !== 'running') return;
    runTicks += 1;
    activeAllies = allies; // 同盟护盾跨单位结算用的当前阵营引用
    activeEnemies = enemies;
    reflectQueue = []; // 每 tick 清空反射返程记账，避免跨 tick 残留/重复

    // 固定行动快照（tick 起始存活全体）＋一次性建好本 tick 挂账。
    // ★ 必须在任何记账(Pass1 激活把伤害/回盾写进目标 __pending)之前为全体建好，
    //   否则后处理单位 reset __pending 会冲掉排前面单位记到它身上的伤害（曾致“仅敌方能打伤害”）。
    // 召唤新增由 pendOf 惰性创建、下 tick 才开始行动。
    const pass1Units = [];
    for (const s of [...allies, ...enemies]) {
      if (!s.alive) continue;
      s.__pending = freshPending();
      pass1Units.push(s);
    }

    // ===== Pass 1 —— 行动遍历（单遍单位 for）=====
    // 对每个单位：闪标递减 + 清理自身死目标引用 + 能量回充 +
    // 模块结构推进(时长/冷却) + 模块激活记账 + 临时单位生命周期，一次完成。
    for (const ship of pass1Units) pass1Unit(ship);

    // ===== Pass 2 —— 结算 =====
    // Phase A（单遍单位 for，作用于本 tick 全体[含 Pass1 新召/已死者]）：
    //   ① 合并应用该单位收到的非伤害数值 pending（补/汲取盾、能量、血量、自毁）；
    //   ② 收集该单位收到的伤害命中(挂在 __pending.dmg) → 拆主目标/爆炸波及两组待结算。
    // 伤害命中记账挂在“被命中方”上：攻击方本 tick 开出的火/自爆即使它同 tick 自己已死也照常结算。
    const allNow = [...allies, ...enemies];
    const primaries = [];
    const splashes = [];
    for (const u of allNow) {
      const P = u.__pending;
      if (!P) continue; // 本 tick 未参与(无挂账)者跳过
      if (u.alive) settleNonDamage(u);
      for (const app of P.dmg) {
        const a = Object.assign({ target: u }, app);
        (app.splash ? splashes : primaries).push(a);
      }
    }
    // Phase B（相内子步：迭代 pending 命中条目）主目标先行(确定防爆抑制) → 后爆炸波及。
    settleHits(primaries, splashes);

    // Phase B2（反射返程，统一在真·武器/爆炸命中全部结算完之后）：
    // 把本 tick 记下的反射逐笔作为 noReflect=true 的伤害补打回原攻击方（返程不再触发反射），
    // 并把“谁(反射模块)反射多少给谁”表头与该返程落地的逐吸收段组合成句。
    // 攻击方已判死者：applyHit 因 !alive 自然返回 0（seg 空 → 仅表头无段；此处成句仍记反射来源）。
    for (const r of reflectQueue) {
      const land = applyHit(r.attacker, r.amount, false, null, true);
      emitHitLog(
        'battle.log.hit.reflect',
        {
          owner: uTok(r.owner),
          module: r.mod ? modTok(r.mod) : null,
          attacker: uTok(r.attacker),
          amount: Math.round(r.amount),
        },
        land.seg,
        'reflect'
      );
      if (land.killed) battleLog('battle.log.destroyed', { ship: uTok(r.attacker) }, ['ship']); // 反射返程致死：紧跟反射句
    }

    // Phase C（单遍单位 for 收尾）：统计写回 + 清 __pending + 收集待移除临时死者。
    // 破盾已在 applyHit(伤害抽空)/settleNonDamage(汲取抽空) 内就地触发，此处不再全量扫描。
    // finalize 在临时单位移出前执行，保证死去的召唤也能累计；清挂账防陈旧记账被下 tick 重复收集。
    const deadTemp = [];
    for (const u of allNow) {
      finalizeModules(u);
      u.__pending = undefined;
      if (!u.alive && u.temp) deadTemp.push(u);
    }
    for (const u of deadTemp) removeSummoned(u.side, u); // 临时单位阵亡/到期直接移出场景
    checkEnd();
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
