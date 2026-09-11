/* ===== systems/battle.js —— 战斗系统核心 =====
 * 战斗状态机：idle -> running -> settled（胜负结算）-> 可重新开始
 *
 * tick 结算顺序（两段式结算，见下方 step()）：
 *   Pass 1 —— 行动遍历（对 tick 起始存活全体【单遍单位 for】，每单位一次完成）**零数值变化**：
 *     闪标递减（纯表现）→ 清理自身指向已死目标的引用 → 回充/回能/消耗/护盾池填池/上限修改/
 *     到期撤销/临时寿命 一律**只记意图**进 __pending（能量门控用单位内运行计数）→ 模块时长/冷却
 *     等**模块私有计时器**就地推进（对单位数值无影响）。全部单位【先记录后】，同 tick 双方对等。
 *   Pass 2 —— 结算：
 *     Phase A（单遍单位 for 收集，不新增全量单位循环）：把各单位 __pending 的意图并入若干
 *       **记录数组**（伤害命中 / 上限修改 / 到期撤销 / 能量 / 非伤害数值 / 临时寿命）。
 *     结算步骤（迭代记录数组，跨单位统一顺序）：
 *       步骤 1 计时推进（模块私有计时器，其唯一跨单位影响“到期撤销/恢复”已记为意图）；
 *       步骤 2 上限与系数统一落地（到期撤销 + capOps + 系数修饰 coeffOps + 时间系数 timeOps
 *              + 潜行标记 stealthOps，**先于伤害结算**）；
 *       步骤 2b 强制目标统一落地（forceOps：把选定目标压入施放者的强制来源栈，只改目标指向）；
 *       步骤 3 能量统一落地（回充 → 模块消耗 → energy_target 量值）；
 *       步骤 4 护盾/模块池填充/血量/自毁/临时寿命统一落地。
 *     Phase B（相内子步，迭代命中条目）：按“普通/爆炸”吸收链结算真·武器/爆炸命中；
 *     Phase B2：反射返程统一在本 tick 命中全部结算完之后补打回（不递归、逐笔 noReflect）。
 *     Phase C（单遍单位 for 收尾）：统计写回 + 清 __pending + 临时单位移出。
 *     判死发生即就地撤销死者残留效果/cap(onDeath)，故不再需要 Pass0 的全量 dropDead/cleanDead。
 *
 * ★ 模块效果执行器（解耦，词条驱动）：
 *   模块在 data/modules.js 中用 effects 词条声明效果——
 *     damage     → 对每个选定目标造成伤害（×船类系数）
 *     shield_gain → **自身**恢复护盾（×船类系数；作用于模块所属自身）
 *     shield_gain_target → 对每个选定目标恢复/汲取护盾（目标级）
 *     force_target_self（`type` 标签）→ 把每个选定目标压入“强制来源栈”（栈顶＝最后激活者优先被集火；
 *       撤销只出栈，不恢复旧目标）
 *     include_self（`type` 标签）→ 效果**同时施加于自身**（与目标选择器无关；**标签补入的自身不产生
 *       blast 溅射**；若自身是被选择器正常解析出来的目标——`prefer_self` 默认/手动选中——则照常有溅射）
 *     prefer_self（`type` 标签）→ **优先自己**：自身可作为目标时，默认解析优先取自己（手动选择优先于它）
 *     lock_target_on_activate（`type` 标签）→ **激活后锁定目标**：持续期内目标固定为激活瞬间的解析结果，
 *       优先级高于强制目标与手动目标；持续期内玩家点选的目标只记录、下次激活才采用
 *     delayed_trigger（`type` 标签）→ **后触发**：效果**不在激活时产生**，而是把「作用集合 + 出伤数值」
 *       冻结在激活瞬间（`effectSetOf` → `inst._delayedRefs`），在**持续期到期结算的瞬间**才产生
 *       （Pass1 到期分支 `fireDelayedEffect` 按既有伤害记账写入目标 `__pending.dmg`）→ 走既有
 *       命中/护盾/防爆/溅射抑制/判死/战报链路，不新增伤害体系；提前结束持续期（停用/阵亡/离场）不触发
 *     hp_below_activate（词条，如 `0.2`）→ **低血触发门控**：仅当 `hull.hp / hull.hpMax ≤ 阈值` 时可激活；
 *       激活即打**结构标记** `inst._firedOnce`（Pass1 零数值变化），血量**回升过阈值**才清标记
 *       → 同一低血区间只触发一次，血量回升后可再次触发
 *     stealth（`type` 标签）→ **潜行**：把作用集合（`effectSetOf`：目标 ∪ 波及 ∪ `include_self` 自身）
 *       内的单位标记为“**不能成为主要攻击目标**”（`ship.stealthMods` + `ship.isStealth`，**零数值变化**）；
 *       仍受 `blast_range` 溅射、仍受既已锁定的目标（`lockTargetId` / `lock_target_on_activate`）约束；
 *       目标解析过滤的**唯一口径**＝`stealthBlocksTargeting`（`moduleTargetList` 与 `shipEffectiveTarget`
 *       同口径）；Pass1 只记账（`__pending.stealthOps`）→ **结算步骤 2** 与 capOps/coeffOps/timeOps 同批落地
 *       → 从**下一 tick 的目标解析**起体现；需搭配 `duration_ticks`（到期/停用/阵亡/移出场景/重新激活前撤销）
 *     attack_coeff_add → 类别系数**加性**修饰（**自身**词条，走 coeff() 唯一口径）
 *     hp_cap_bonus / energy_cap_bonus / energy_regen_bonus / shield_coeff_add / shield_cap_bonus →
 *       **自身【常驻静态加成】**（**增幅器类**，一律**无 `_target` 后缀** = 硬作用于模块所属自身）：
 *       血量上限 / 能量上限 / 能量恢复 / 类别系数加性 / 护盾容量。**无冷却、无持续、无耗能、不激活**——
 *       由**派生重算**落地（安装即生效、停用即失效），**不进** Pass1/Pass2 任何记账、**不产生战报**，
 *       故对 tick 而言零数值变化。唯一落地口径＝`ship.js syncSelfStatics`（三围上限与能量恢复：
 *       `基准 + Σ自身常驻×类别系数 + Σ目标级 cap 叠加`；类别系数加性写既有 `coeffMods`）与护盾池
 *       `permanentBonus`（护盾容量）；战斗内启停模块走 `recomputeCap`（合并目标级叠加，非累加），
 *       绝不复位到裸基准。常驻判据＝模块启用中 且 **无 `duration_ticks`**（与护盾池 permanentBonus 分支同源）。
 *     hp_regen_per_death → **按上一 tick 阵亡数回血**（**自身**词条，如「回收利用」）：
 *       恢复量 = `词条值 × 类别系数 × 上一 tick 阵亡数`（全场双方合计、**排除召唤/临时单位**，
 *       判据 `summonMod || isSummon`，与 soloConditionHolds 同一口径）。阵亡数由各判死点唯一出口
 *       `onDeath()` 累加 `deathsThisTick`、**tick 收尾**提交为 `lastTickDeaths`（Pass1 只读快照 →
 *       同一 tick 内无“死→回血”反馈环、遍历顺序无关、镜像对等）。回血为**真实 hp 恢复**：
 *       Pass1 只记 `__pending.hpDeltas`（带 `regen:true`），**结算步骤 4c** 与 `hp_target` 同批
 *       `applyHpTo`（钳制到 `hpMax`、正值不乘受伤减免）；`0 阵亡` → 不记账、零数值变化；
 *       仅“**实际回血 > 0**”时记 1 条低频战报 `battle.log.recycleRegen`（带模块拥有者）。
 *     damage_coeff_mul → **受伤减免系数**（**自身**词条，受击向）：该单位**受到的**一切伤害在落地时乘它
 *       （0.95 = 只承受 95%；唯一结算点＝`applyHit` 入口，故主目标命中/爆炸波及/反射返程等
 *       所有来源自动一并减免）；**豁免**：自毁 `self_destruct_damage`、能量削减、上限类 `*_cap_target`
 *     attack_coeff_add_target / damage_coeff_mul_target → 同上但作用于**每个解析目标**（目标级词条）
 *     time_coeff → **时间系数**（影响“**需求量**”，★ **不改每 tick 推进量**：每 tick 恒推进 1 tick）：
 *       作用对象的各类计时器需求量变为 `timeScaled(基础量, 系数)` ＝ `max(0, round(基础量 × (1 + 系数)))`，
 *       计时器**剩余 = 需求量 − 已推进 tick 数**（每个计时器各自记 `elapsed`，每 tick 恒 +1）→
 *       模块**冷却**、模块**持续时间**、临时单位**存在时间**都按新需求量走完。
 *       · 系数**为负＝加速**（`-0.1` → 需求量 ×0.9，更快走完；由「时间扭曲」模块给出）；
 *       · 系数**为正＝放缓**（`+0.1` → 需求量 ×1.1，更慢走完；由「放缓时间」模块给出）。
 *       作用集合＝目标选择器解析结果 ∪ `blast_range` 波及 ∪ `include_self` 标签补入的自身
 *       （与上限词条共用 `effectSetOf`）；Pass2 结算阶段落地 → **下一 tick 起**生效。
 *       ★ 系数在计时**中途**落地/撤销时，按已推进 tick 数反推剩余 → 总是“新需求 − 已推进”，
 *         需求变小剩余必变小（不会出现错向）；已推进的进度绝不回退。
 *       **战报低频**：仅在“从无→有”记 1 条（负系数＝`hastenStart`、正系数＝`slowStart`）、
 *       “从有→无”记 1 条（`hastenEnd`/`slowEnd`）（同一模块同 tick 内到期并重新激活则整体静默），
 *       **不逐次激活播报**。
 *     （后续词条如 heal / energyDrain 在此同一框架追加执行器）
 *   effects.type 仅用于"特殊模块的特殊效果"标记，且为【列表参数】，
 *   未来一个模块可同时携带多个特殊效果（type: ['...', '...']）。
 *   ★ **持续型一律由 `duration_ticks > 0` 判定**：`'duration'` 不是合法标签（不要写进 type 数组）。
 *
 * ★ 统一目标系统（详情/单位框/指挥栏共用同一解析）：
 *   目标可用对象 kinds（self/ally/enemy）+ 目标数量 countMode
 *   （single/multi/all，multi 数量上限 maxCount）
 *   解析链（单模块优先级，★ 唯一口径，与 `shipEffectiveTarget` 同源）：
 *     锁定单位 > 激活锁定(`lock_target_on_activate`·持续期内) > 强制目标 > 模块手动选择(单/多，互斥)
 *     > 优先自己(`prefer_self`) > 船指定目标 > 自动粘性 > 全队策略自动补足
 *   ★ **潜行过滤**（`type` 标签 `stealth`，唯一口径 `stealthBlocksTargeting`）：上述链中
 *     **除“锁定单位 / 激活锁定”外的全部来源**（强制目标 / 手动选择 / 优先自己 / 船指定目标 /
 *     自动粘性 / 全队策略）**一律跳过潜行单位**；`blast_range` 溅射**不受影响**。
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
  setCoeffMod,
  clearCoeffMod,
  setCoeffMulMod,
  clearCoeffMulMod,
  damageTakeMul,
  setDamageTakeMulMod,
  clearDamageTakeMulMod,
  // ★ 时间系的**唯一读口径/换算**都在 ship.js：`timeCoeffOf()`（单位时间系数）、
  //   `timeScaled(need, coeff)`（需求量整数化）；系数**来源读写**走 setTimeCoeffMod/clearTimeCoeffMod。
  setTimeCoeffMod,
  clearTimeCoeffMod,
  timeCoeffOf,
  timeScaled,
  // ★ 潜行（`type` 标签 `stealth`）的**唯一读口径** `isStealthed()` 与来源读写
  //   `setStealthMod/clearStealthMod` 都在 ship.js；引擎只做目标解析过滤，不复制判定逻辑。
  setStealthMod,
  clearStealthMod,
  isStealthed,
  clearAllSourceMods,
  recalcDerived,
  // ★ 自身【常驻静态加成】的唯一落地口径（增幅器类词条 hp_cap_bonus / energy_cap_bonus /
  //   energy_regen_bonus / X_coeff_add、以及护盾容量）：三围上限 = 基准 + Σ自身常驻 + Σ目标级叠加，
  //   类别系数加性写既有 coeffMods，统一在 ship.js `syncSelfStatics` 落地；
  //   战斗层只把 capOverlays 的聚合值传入（见 recomputeCap），不复制公式。
  syncSelfStatics,
  fillHullVitals,
  fillShieldPools,
  fillModuleShieldPool,
  syncShieldSummary,
  BASE_POOL_KEY,
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
/** 单位标签判定（供目标词条 exclude 排除；可扩展）：
 *  projectile = 召唤弹体类单位（火箭/导弹弹体，由召唤模块 summon.projectile 标记）。 */
function unitHasTag(u, tag) {
  if (!u) return false;
  if (tag === 'projectile') return !!u.isProjectile;
  return false;
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

  /* ---------- 死亡计数（"回收利用" 等按阵亡数结算的词条用）----------
   * ★ 口径：**全场（双方合计）**、**排除召唤/临时单位**（判据 `summonMod || isSummon`，与
   *   `soloConditionHolds` 的"召唤物不计入"完全同判据、不新造字段）、**按上一 tick 结算**。
   * ★ "上一 tick"语义（沿用既有"上一 tick 快照"范式，如 `_takeMulTick`/`_timeCoeffTick`）：
   *   - 判死发生在结算阶段（Phase 4c/4d/4e/B/B2）→ 各判死点经唯一出口 `onDeath()` 累加 `deathsThisTick`；
   *   - **tick 收尾**（Phase C 之后）把 `deathsThisTick` 提交为 `lastTickDeaths` 再清零；
   *   - Pass1 只读 `lastTickDeaths`（本 tick 内恒定）→ **同一 tick 内没有任何"死→回血"反馈环**，
   *     与遍历顺序无关、双方镜像对等；本 tick 新发生的死亡要等到**下一 tick** 才计入。 */
  let deathsThisTick = 0; // 本 tick 已判死的"非召唤"单位数（结算阶段累加，tick 收尾提交）
  let lastTickDeaths = 0; // **上一 tick** 的死亡数（Pass1 唯一读口径；tick 收尾赋值）

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
      startDuration(inst, timeCoeffOf(ship)); // 进入持续期：需求量按当前时间系数整数化、已推进归 0
      clearCooldown(inst);
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
      fillHullVitals(ship); // 满血/满能量登场（与满盾同体例；本体三围已含自身常驻加成）
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
    if (s.temp) {
      // 剩余存在 tick / 基础需求量 / 已推进 tick 数（仅临时单位使用；真正起点由 doSummon 的 startLife 写入）
      s.tempLeft = 0;
      s.tempLifeNeed = 0;
      s.tempLifeElapsed = 0;
    }
    seqCount[side] += 1;
    s.order = seqCount[side];    // #编号由出场顺序决定（整队统一递增）
    sidesOf(side).push(s);       // 排在列尾（显示在主力之后）；目标顺序由 orderedFoes 另行处理
    refreshSideSize(side);
    return s;
  }
  /** 把临时单位移出场景，并清理其各模块对本场其它单位施加的影响 */
  function removeSummoned(side, u) {
    for (const inst of u.modules) {
      if (inst.durationLeft > 0) endDuration(inst); // 移出场景：结束持续期（剩余/已推进一并归 0）
      dropSourceMods(inst);
      clearAllSourceMods(u, inst.id); // 移出场景 → 回退其施放方自身获得的修饰（系数加/乘 + 受伤减免）
      releaseCoeffRefs(inst); // 移出场景 → 撤销其施加在各被作用单位上的目标级修饰
      releaseTime(inst); // 移出场景 → 撤销其施加在各被作用单位上的时间系数
      releaseStealth(inst); // 移出场景 → 撤销其施加在各被作用单位上的潜行标记
      inst._coeffAdd = 0;
      inst._coeffMul = 1;
      inst._takeMul = 1;
      releaseForced(inst); // 移出场景 → 解除其施加的强制目标（被强制者按来源栈回落/回正常优先级）
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
   *  - 目标池：self → 自身；enemy → 敌方存活（按全队策略排序）；ally → 同阵营其它存活；any → 敌我任意（含自身）
   *  - 手动选择互斥（去重）；未手动覆盖的空位由上游自动补足
   *  - ★ **目标优先级链（唯一口径，与 `shipEffectiveTarget` 同源）**：
   *      **锁定单位(`lockTargetId`) > 激活锁定(`lock_target_on_activate`·持续期内) > 强制目标 >
   *        模块手动目标 > 优先自己(`prefer_self`) > 船 `targetId` > 自动粘性 > 全队策略/阵营顺序**
   *    （实现：给候选池打优先级桶后稳定排序，三个 countMode 分支同取这一条链）
   *  - ★ **潜行过滤**（`type` 标签 `stealth`，唯一口径 `stealthBlocksTargeting`）：在**两个锁定分支之后**
   *    过滤候选池 —— 锁定单位/激活锁定**豁免**，其余来源（含**玩家手动选定**）一律跳过潜行单位；
   *    过滤后为空 → 返回 []（按既有规则**不激活**）。
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
    const excl = Array.isArray(tgt.exclude) ? tgt.exclude : []; // 目标排除标签（如 projectile=召唤弹体）
    for (const u of pool) {
      if (!u.alive) continue;
      if (excl.length && excl.some((t) => unitHasTag(u, t))) continue;
      if (!uniq.some((x) => x.id === u.id)) uniq.push(u);
    }
    if (!uniq.length) return [];

    // —— ★ 激活锁定（`type` 标签 `lock_target_on_activate`）：目标在**激活瞬间**固定 ——
    //    优先级**高于强制目标与手动目标**（仅次于上面的“锁定单位”），且**只在本次持续期内生效**：
    //    · 持续期内完全按锁定集合返回 —— 玩家仍可点选目标，但那只是**记录**，下一次激活才采用；
    //    · 锁定目标阵亡 → 只返回其余存活的锁定目标（全部阵亡则返回空，**绝不**改选其它目标）；
    //    · 持续期结束（`durationLeft` 归 0）后自动回到下面的正常优先级链。
    //    ★ 读取的是 Pass1 记账时写入的 `inst._lockIds`（结构引用，非数值）→ 不破坏 Pass1 零数值变化。
    if (moduleTargetLocked(inst)) {
      const locked = [];
      for (const id of inst._lockIds) {
        const u = allies.find((x) => x.id === id) || enemies.find((x) => x.id === id);
        if (u && u.alive) locked.push(u);
      }
      return locked;
    }

    // —— ★ **目标优先级链（唯一口径）** ——
    //    激活锁定目标（上方已返回） > 强制目标 > 模块手动目标 > 优先自己(`prefer_self`) >
    //    船 `targetId` > 自动粘性 > 自然顺序（全队策略/阵营顺序）
    //    实现：对候选池每个单位打**优先级桶**（rank），桶内保持自然顺序 → 一次稳定排序得出结果；
    //    `all`/`multi`/`single` 三个分支都从这同一条有序链上取（`single` 取首位、`multi` 取前 N、`all` 取全部）。
    // ★ **潜行过滤（`type` 标签 `stealth`，唯一口径 `stealthBlocksTargeting`）**：
    //   放在**锁定分支之后** —— 上方的“锁定单位 / 激活锁定”属**激活瞬间已锁定**的目标，
    //   **豁免**本判据（潜行不推翻既有锁定）；其余全部来源（强制目标 / 模块手动目标 / 优先自己 /
    //   船 `targetId` / 自动粘性 / 全队策略）**一律跳过潜行单位**。
    //   若过滤后无可用目标 → 返回空（**按既有规则不激活**，不报错）。
    const selectable = uniq.filter((u) => !stealthBlocksTargeting(ship, u));
    if (!selectable.length) return [];
    const forced = forcedTopUnit(ship);
    const forcedIn = forced && selectable.some((u) => u.id === forced.id) ? forced : null;
    const selIds = new Set(
      inst.target && inst.target.mode === 'units' ? inst.target.ids || [] : []
    );
    const selId = inst.target && inst.target.mode === 'unit' ? inst.target.id : null;
    // ★ 优先自己（`prefer_self`）：自身**可作为目标**（kinds 允许 self/any → 自身在池中）时，
    //   默认解析**优先取自己**；玩家手动指定其它目标时手动优先（rank 1 < rank 2）。
    const preferSelf = isType(fx, 'prefer_self');
    // 自动粘性：仅在“无任何手动锁定（船 targetId / 模块 unit|units）”时生效（原有语义不变）
    const manualLocked = !!ship.targetId || (inst.target && inst.target.mode !== 'follow');
    const stickIds = new Set(!manualLocked && Array.isArray(inst._stick) ? inst._stick : []);
    const rankOf = (u) => {
      if (forcedIn && u.id === forcedIn.id) return 0;
      if (selIds.has(u.id) || (selId && u.id === selId)) return 1;
      if (preferSelf && u.id === ship.id) return 2;
      if (ship.targetId && u.id === ship.targetId) return 3;
      if (stickIds.has(u.id)) return 4;
      return 5;
    };
    const ordered = selectable
      .map((u, i) => ({ u, i }))
      .sort((a, b) => rankOf(a.u) - rankOf(b.u) || a.i - b.i)
      .map((x) => x.u);

    if (mode === 'all') return ordered; // 全员（不缩减 AoE 覆盖），仅按上述优先级排序
    if (mode === 'multi') return ordered.slice(0, maxN); // 前 N 位（强制/手动优先占位）
    return ordered.slice(0, 1); // single：优先级最高者
  }

  /** ★ 该模块当前是否处于**激活锁定**中（`type` 标签 `lock_target_on_activate` + 本次持续期未结束）。
   *  **UI 的唯一判据**（不产条件、不自算）：锁定中目标固定为本次激活的解析结果，
   *  玩家新点选的目标只**记录**、要等**下一次激活**才采用（UI 据此显示“已锁定 / 下次生效”）。
   *  ★ 需搭配 `duration_ticks`：没有持续期就无所谓“此次激活的固定目标”。 */
  function moduleTargetLocked(inst) {
    if (!inst) return false;
    const fx = (inst.cfg && inst.cfg.effects) || {};
    return (
      isType(fx, 'lock_target_on_activate') &&
      (inst.durationLeft || 0) > 0 &&
      Array.isArray(inst._lockIds) &&
      inst._lockIds.length > 0
    );
  }

  /* ---------- 潜行（`type` 标签 `stealth` · 目标选择向）----------
   * ★ 语义：被标记单位**不得被选为主要攻击目标**（其它单位的目标解析一律跳过它）。
   *   下列**唯一口径** `stealthBlocksTargeting` 同时被 `moduleTargetList`（模块目标优先级链）与
   *   `shipEffectiveTarget`（船级主要目标）使用 —— 两处同口径，避免“显示能打、实际不打”。
   * ★ **豁免（仍受“目标锁定”影响）**：`lockTargetId`（一次性火箭/导弹弹体）与
   *   `lock_target_on_activate` 的锁定集合 `inst._lockIds`（**激活瞬间已锁定**的目标）在各自分支
   *   **直接返回**、不经过本判据 → 潜行**不影响**这些既有锁定（潜行是“事后生效”，不推翻锁定）。
   * ★ **不影响溅射**：`blast_range` 波及（`effectSetOf` 与 `maybeActivate` 的爆炸循环）**不走**本判据，
   *   潜行单位照常被波及；`applyHit` 侧也没有任何潜行减免 —— “仍会受到溅射影响”由此天然成立。
   * ★ **不影响友方/自身**：潜行只挡“把对方当敌人打”，支援类模块（buff/回盾/时间系）解析到
   *   潜行单位（友军或自己）照常成立；自身永远可选（自指模块不受影响）。
   * ★ 读**tick 起始快照** `u._stealthTick`（Pass1 单位开头写入，见 `pass1Unit`；新召单位在
   *   `doSummon` 生成时写入）：本 tick 全体单位的目标解析按同一份 tick 起始状态进行；
   *   本 tick 结算阶段落地的潜行从**下一 tick 的目标解析**起体现（与系数/时间系数同一时序范式）。 */
  function tickStealthed(u) {
    if (u && typeof u._stealthTick === 'boolean') return u._stealthTick;
    return isStealthed(u); // 快照缺失（战斗外/异常路径）→ 唯一读口径现算兜底
  }
  /** u 是否因**潜行**而不可被 ship 选为“主要攻击目标”（潜行的**唯一判定口径**，UI 同源） */
  function stealthBlocksTargeting(ship, u) {
    if (!ship || !u) return false;
    if (u.id === ship.id) return false; // 自身永远可选（自指/自身单体模块不受潜行影响）
    const foes = ship.side === 'ally' ? enemies : allies;
    if (!foes.includes(u)) return false; // 只挡“对敌”目标：友方/支援类目标不受潜行影响
    return tickStealthed(u);
  }

  /** 船的"当前实际目标"（供 UI 显示单位主要目标/提示）：
   *  ★ 优先级链与 `moduleTargetList` **同口径**（船级视角）：
   *    **锁定单位 > 激活锁定(`lock_target_on_activate`·首个锁定中的攻敌模块) > 强制目标 >
   *      船手动目标 `targetId` > 首个能攻击敌方的模块的实时解析结果 > 全队策略队首**。
   *  ★ **潜行过滤同口径**（`stealthBlocksTargeting`）：**锁定单位与激活锁定豁免**，其余来源
   *    （强制目标 / 船 `targetId` / 模块解析结果 / 全队策略队首）一律跳过潜行单位。
   *  （模块内部的手动目标/`prefer_self` 由 `moduleTargetList` 自己按完整链解析，此处不再重复。）
   *  `shipEffectiveTarget` 是**船级“主要攻击目标”显示**：只返回**敌方**单位 ——
   *  支援类模块（如时间扭曲选中友军/自己）不得把船的主要目标显示成友方。 */
  function shipEffectiveTarget(ship) {
    const foes = ship.side === 'ally' ? enemies : allies;
    if (ship.lockTargetId) {
      const b = foes.find((f) => f.id === ship.lockTargetId && f.alive);
      return b || null; // 锁定单位不回落其他目标（即使锁定目标已阵亡也返回 null）
    }
    if (ship.modules && ship.modules.length) {
      for (const inst of ship.modules) {
        if (!moduleTargetLocked(inst)) continue;
        const list = moduleTargetList(ship, inst); // 锁定中：返回本次激活固定的目标
        const u = list.find((x) => foes.includes(x));
        if (u) return u; // 只可能是敌方；锁定到友军/自己则视为与该显示无关，继续下探
      }
    }
    const forced = forcedTopUnit(ship); // 被强制时 UI 与战斗解析必须显示同一目标
    // ★ 潜行同口径：被强制指向的单位若已潜行 → 不可作为主要攻击目标（继续下探正常链）
    if (forced && !stealthBlocksTargeting(ship, forced)) return forced;
    if (ship.targetId) {
      const u = foes.find((f) => f.id === ship.targetId && f.alive);
      if (u && !stealthBlocksTargeting(ship, u)) return u; // ★ 潜行 → 跳过，继续下探（targetId 本身不改写）
    }
    if (ship.modules && ship.modules.length) {
      for (const inst of ship.modules) {
        const fx = (inst.cfg && inst.cfg.effects) || {};
        const kinds = (inst.cfg && inst.cfg.target && inst.cfg.target.kinds) || [];
        // ★ “攻敌模块”判据：明确选敌，或**确实会造成伤害**的模块；
        //   仅“敌我任意(kinds:any)”**不足以**算攻敌（否则支援类模块会把主要目标显示成友军/自己）。
        const offensive = kinds.includes('enemy') || (fx.damage || 0) > 0;
        if (!offensive) continue; // 跳过纯增益/召唤等不攻敌的模块
        const list = moduleTargetList(ship, inst);
        // ★ 船级主要目标只能是敌方：支援/自指模块解析出的友军或自己一律不计入
        const u = list.find((x) => foes.includes(x));
        if (u) return u;
      }
    }
    // ★ 全队策略队首：同样跳过潜行单位（潜行不可作为主要攻击目标）
    return orderedFoes(foes, policyOf(ship)).find((f) => !stealthBlocksTargeting(ship, f)) || null;
  }

  /** 阵营策略预览：该阵营当前全队首个命中目标（★ 同口径跳过潜行单位） */
  function fleetPreview(side) {
    const foes = side === 'ally' ? enemies : allies;
    return orderedFoes(foes, policies[side]).find((u) => !tickStealthed(u)) || null;
  }

  /** ★ **共享的“作用集合（effect set）”计算** —— 供**上限类词条**与**时间加速**等
   *  “按集合成批落地”的非伤害词条组共用（避免各处重复实现同一套扩展规则）。
   *  作用集合 = 三个来源的**并集**（按单位 id 去重，冻结于本次激活瞬间）：
   *    ① 目标选择器解析出的目标（`moduleTargetList`，含 excludes/粘性/强制目标/激活锁定等全部既有语义）；
   *    ② `blast_range > 0` 时，**各目标所在队列**（该目标自己那一侧的视觉顺序队列）前后各 N 个存活单位；
   *    ③ `type` 标签 `include_self` 时，模块所属单位自身（★ **按标签识别**，与目标选择器无关：
   *       即使 `kinds` 不含 `self`/`any`，带该标签也一定作用于自身）。
   *  ★ **“自身是否产生溅射”取决于它是怎么进集合的（精确规则）**：
   *    · **由 `include_self` 标签补入的自身**（不进 `targets`，只在函数末尾 `set.set`）→ **不产生任何溅射**，
   *      只是精确作用于自己；
   *    · **目标选择器正常解析出的自身**（`kinds` 含 `self`/`any` 时经 `prefer_self` 默认取到自己，或玩家手动把自身
   *      选为目标）→ 它与任何别的目标**完全同权**，**照常对自身所在队列前后各 N 个存活单位产生溅射**。
   *    实现上不需要任何 `primary === ship` 特判：溅射循环只遍历 `targets`，标签补入发生在循环之后。
   *  ★ 用**目标自己的**队列做波及（而不是“施放方的敌方队列”）：对“选中友方/任意”的词条
   *    （如时间加速）才是正确语义；对 EMP 这类“选中敌方”的词条，二者**完全等价**（原有行为不变）。
   *  ★ 只用只读信息（存活状态 + 队列顺序），不修改任何数值 → 可在 Pass1 安全调用；
   *    返回的数组由结算阶段消费（并写入 `inst._xxxRefs` 作为撤销依据）。 */
  function effectSetOf(ship, targets, fx) {
    const set = new Map(); // id -> unit（去重）
    for (const t of targets) if (t && t.alive) set.set(t.id, t);
    const r = (fx && fx.blast_range) || 0;
    if (r > 0) {
      // ★ 溅射**只从 `targets`（目标选择器解析结果）出发** —— 不区分 primary 是不是施放者自己：
      //   若“自身”是被选择器**正常解析**出来的目标（`prefer_self` 默认取到自己，或玩家手动把自身选为目标），
      //   它就是一个普通 primary → **照常对自身所在队列前后各 N 个存活单位产生溅射**；
      //   反之，**由 `include_self` 标签补入的自身不进 `targets`**（见函数末尾），故**不产生任何溅射**。
      for (const primary of targets) {
        if (!primary) continue;
        const roster = primary.side === 'ally' ? allies : enemies; // 目标所在队列（视觉顺序）
        const idx = roster.findIndex((u) => u.id === primary.id);
        if (idx < 0) continue;
        for (let k = 1; k <= r; k += 1) {
          for (const nb of [roster[idx - k], roster[idx + k]]) {
            if (nb && nb.alive) set.set(nb.id, nb);
          }
        }
      }
    }
    // ★ `include_self` 标签补入的自身：**只并入集合、绝不作为溅射 primary**（两条规则由此自然同时成立）
    if (fx && isType(fx, 'include_self') && ship.alive) set.set(ship.id, ship);
    return [...set.values()];
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
  /** 类别系数加性修饰词条 → 系数类别（可扩展：加性增益词条名 → `coeff()` 的 category）
   *  如 `attack_coeff_add: 0.2` = **自身** attack 系数 +0.2（base 1.0 → 1.2）；
   *  `shield_coeff_add: 0.1` = **自身** shield 系数 +0.1（作用于护盾池容量，见 modulePoolCapOf）。
   *  ★ 本表服务于**结算阶段**的条件型/时长型路径（`coeffOps` → `applyCoeffOp`）；
   *    **常驻**（`passive`，无 `duration_ticks`）的同类词条由 ship.js `syncStaticCoeffs` 直接写
   *    同一张 `coeffMods` 表（安装/启停时），二者共用 `setCoeffMod` 与 `clearAllSourceMods` 撤销入口。 */
  const COEFF_ADD = { attack_coeff_add: 'attack', shield_coeff_add: 'shield' };
  /** 类别系数**乘性**修饰词条 → 系数类别（**预留扩展点，当前无任何词条映射**）。
   *  ★ 注意：`damage_coeff_mul` **不属于**本表 —— 它是**受伤减免系数**（见 DAMAGE_TAKE_MUL），
   *    作用于该单位**受到的**一切伤害、不参与 `coeff()`；本乘性表仅保留给未来“按类别乘性”的词条。 */
  const COEFF_MUL = {};
  /* —— 目标级（走目标选择器的）系数修饰词条 ——
   * ★ 命名铁律：**无 `_target` 后缀＝自身词条**（作用对象＝模块所属单位）；
   *   **带 `_target` 后缀＝目标词条**（作用对象＝`target` 选择器解析出的每个目标）。
   *   目标级记录同样记入 `__pending.coeffOps`（挂在施放方 pending 上），但 `rec.ship` ＝**被作用单位**（逐目标一条）。 */
  const COEFF_ADD_T = { attack_coeff_add_target: 'attack' };
  /** **受伤减免**词条（自身）→ `ship.damageTakeMulMods`：该单位受到的伤害统一乘积（0.95 = 只承受 95%）。
   *  与 `coeff()` 无关：不分类别、不影响护盾池/非伤害量值；结算步骤 2 落地、撤销同其它系数修饰。 */
  const DAMAGE_TAKE_MUL = { damage_coeff_mul: true };
  /** **受伤减免**词条（目标级，`_target` 后缀）：对每个解析目标写其自身的受伤减免 */
  const DAMAGE_TAKE_MUL_T = { damage_coeff_mul_target: true };
  /** **时间系数**词条 → 作用对象上的 `ship.timeCoeffMods`（来源 key → 系数，负=加速 / 正=放缓）。
   *  ★ 语义＝乘在“**需求量**”上（`timeScaled(基础量, 系数)`），**不改每 tick 推进量**（恒为 1）；
   *    多来源组合规则见 ship.js `refreshTimeCoeff()`（当前＝**加性求和**）。
   *  ★ 与 `coeff()`/`damageTakeMul()` 都无关：不改伤害、不改护盾池，只改**计时器的需求量**。 */
  const TIME = { time_coeff: true };
  /** 读回某单位当前已落地的某来源系数修饰值（用于**逐目标**记录的幂等判定：
   *  `_coeffAdd/_coeffMul` 只能记“自身”一条，逐目标必须从表回读）。 */
  function appliedCoeff(ship, key, category, mode) {
    const isMul = mode === 'mul';
    const m = isMul
      ? (ship.coeffMulMods instanceof Map ? ship.coeffMulMods.get(key) : null)
      : (ship.coeffMods instanceof Map ? ship.coeffMods.get(key) : null);
    if (!m || m.category !== category) return isMul ? 1 : 0;
    return isMul ? m.mul : m.add;
  }
  /** 读回某单位当前已落地的某来源**受伤减免系数**（逐目标记录幂等判定用；缺省 1） */
  function appliedTakeMul(ship, key) {
    const m = ship.damageTakeMulMods instanceof Map ? ship.damageTakeMulMods.get(key) : undefined;
    return typeof m === 'number' ? m : 1;
  }

  function ownerOf(inst) {
    for (const s of [...allies, ...enemies]) if (s.modules.includes(inst)) return s;
    return null;
  }

  /** 重算目标三围上限 = 自身(基础 + **常驻静态加成**) + Σ目标级 cap 增/减
   *  每次均从各自基础值(baseShieldCap/baseHpMax/baseEnergyCap)重算，
   *  保证非累加：撤销旧影响后新施加不会在已减值上再叠。
   *  护盾叠加(shield_cap_target)记入“本体池”的 capExtra（随本体池容量由 recalcDerived
   *  一并钳制/汇总）；血量/能量上限、能量恢复与**类别系数加性**（`X_coeff_add`）由 ship.js
   *  **唯一口径 `syncSelfStatics`** 落地（`基准 + Σ自身常驻词条 + 本次传入的目标级叠加`；
   *  系数加性写既有 `coeffMods`），本函数**不再自行复位到基准**
   *  —— 否则会把增幅器类常驻加成（`hp_cap_bonus`/`energy_cap_bonus`/`energy_regen_bonus`）一并抹掉。
   *  ★ 关键：此处只改本体池的 capExtra，绝不触碰护盾【池值】，
   *    且必须让 recalcDerived 以“正确 permanentBonus”统一重算 cap——
   *    若改用 baseShieldPoolOf(其内部 ensureBasePool(…,undefined)) 会把常驻护盾
   *    (如再生护盾)的 permanentBonus 当作 0 而把 cap 算小，ensureBasePool 的
   *    value=min(value,cap) 随即把真实池值钳掉，之后 cap 复原但池值已丢（EMP 清空再生护盾 BUG）。 */
  function recomputeCap(target) {
    const m = capOverlays.get(target.id);
    let sh = 0;
    let hp = 0;
    let en = 0;
    if (m) for (const v of m.values()) { sh += v.sh; hp += v.hp; en += v.en; }
    const pools = target.hull && target.hull.pools;
    let base = pools instanceof Map ? pools.get(BASE_POOL_KEY) : null;
    if (!base) {
      recalcDerived(target); // 本体池缺失：先按正确来源建池（含 permanentBonus）
      base = pools instanceof Map ? pools.get(BASE_POOL_KEY) : null;
    }
    if (base) base.capExtra = sh; // 非累加：仅重设目标级叠加，不动池值
    recalcDerived(target); // 护盾池同步（本体池=baseShieldCap+capExtra+permanentBonus、各模块池）并刷新汇总
    // ★ 自身常驻静态加成（系数加性 / 三围上限 / 能量恢复）与目标级叠加**合并重算**（唯一口径在 ship.js
    //   `syncSelfStatics`；非累加）；当前值只做钳制、不补齐（与护盾池“只加容量不白送”同口径）。
    syncSelfStatics(target, hp, en);
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

  /** 启用/停用模块（处理自身被动重算 + 移除其目标级 cap 影响）
   *  ★ 启停会改变【自身常驻静态加成】的合计（增幅器类词条：上限/能量恢复/类别系数加性）
   *    → 必须走 `recomputeCap`（= 护盾池重算 + 唯一口径 `syncSelfStatics`），而**不能**只调
   *    `recalcDerived`：后者不重算三围上限与系数，且若自行复位到基准会把该单位身上**仍在生效的
   *    目标级 cap 叠加**（如电磁脉冲）一并抹掉。`recomputeCap` 会把两者合并重算，非累加、口径唯一。 */
  function enableModule(inst) {
    inst.enabled = true;
    const o = ownerOf(inst);
    if (o) recomputeCap(o); // 重新计入自身常驻加成（含血量/能量上限、能量恢复）
  }
  function disableModule(inst) {
    inst.enabled = false;
    if (inst._ramp) inst._ramp = { key: '', count: 0 }; // 停用 → 逐步伤害成长归零
    dropSourceMods(inst); // 移除其施加在其它单位上的护盾上限影响
    // 时间系（时间系数）的撤销置于“施放方是否还在”判空**之前**：其作用集合挂在 `inst._timeRefs` 上、
    // 与被作用单位是否会随施放方一起离开无关，放前面可避免无主模块留下永不撤销的时间系数。
    releaseTime(inst); // 停用 → 撤销其施加在各被作用单位上的时间系数
    releaseStealth(inst); // 停用 → 撤销其施加在各被作用单位上的潜行标记
    const o = ownerOf(inst);
    if (!o) return;
    clearAllSourceMods(o, inst.id); // 停用 → 回退其施加在自身的修饰（系数加/乘 + 受伤减免）
    releaseCoeffRefs(inst); // 停用 → 撤销其施加在各被作用单位上的目标级修饰
    inst._coeffAdd = 0;
    inst._coeffMul = 1;
    inst._takeMul = 1;
    releaseForced(inst); // 停用 → 解除其施加的强制目标（被强制者按其来源栈回落/回到正常优先级）
    if (inst.durationLeft > 0) {
      endDuration(inst); // 停用 → 结束持续期（剩余/已推进一并归 0）
      startCooldown(inst, timeCoeffOf(o)); // 并进入冷却（需求量按当前时间系数、已推进归 0）
    }
    recomputeCap(o); // 结束自身常驻/自身时长加成（口径同 enableModule）
  }

  /** 进入战斗（开始 tick 结算） */
  function start() {
    if (phase !== 'idle') return;
    phase = 'running';
    result = null;
    deathsThisTick = 0; // 死亡计数从零起（首 tick 的"上一 tick 死亡数"＝0 → 不触发任何按阵亡数的词条）
    lastTickDeaths = 0;
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

  /** 本 tick 能量回充：**只记账不回写**（数值统一在 Pass2 结算阶段落地）。
   *  返回本次回充额度，供 Pass1 的“单位内运行计数”做门控。 */
  function energyRegenTick(ship, P) {
    const regen = ship.energyRegenPerSec / TPS;
    P.energyRegen += regen;
    return regen;
  }

  /** 模块此刻是否处于"有效贡献窗口"（窗口冻结 → DPS 冻结）。
   *  availEnergy：Pass1 单位内运行计数（tick 起始能量 + 本 tick 回充额度）；
   *  因能量已改为结算阶段落地，此处不能直接读 ship.hull.energy（那只是 tick 起始值）。 */
  function moduleActiveNow(ship, inst, availEnergy) {
    if (!ship.alive || !inst.enabled) return false;
    const fx = inst.cfg.effects;
    const hasDmg = (fx.damage || 0) > 0;
    const hasShield = (fx.shield_gain || 0) > 0;
    if (hasShield && !hasDmg) {
      // 纯回复类：须盾未满且能量足够（满盾/能量不足不算窗口）
      const avail = availEnergy === undefined ? ship.hull.energy : availEnergy;
      return ship.hull.shield < ship.hull.shieldCap && avail >= (fx.energy_cost || 0);
    }
    return true;
  }

  /** 召唤类模块执行：按 fx.summon 补召一个临时单位（携带模组数量不受该单位槽限约束）
   *  - 已达该阵营该单位的"最大召唤数" → 不召唤（保持待命，有空位即补召）
   *  - 能量不足 → 不召唤
   *  - 召唤单位存在 lifespan_ticks tick，到期自动死亡；临时单位阵亡/到期后直接移出场景 */
  /** Pass1 能量消耗：**只记账不回写能量**（结算步骤 3 统一落地），
   *  同时扣减“单位内运行计数”ctx.avail 以便同单位后续模块按序门控。
   *  返回是否支付成功（能量足够）。 */
  function payEnergy(ctx, inst, cost) {
    if (ctx.avail < cost) return false;
    ctx.avail -= cost;
    ctx.P.energySpends.push({ inst, amount: cost });
    return true;
  }

  function doSummon(ship, inst, fx, boundId, ignoreCap, ctx) {
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
    if (!payEnergy(ctx, inst, cost)) return; // 能量不足（用单位内运行计数门控，消耗记账到结算）
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
    // 临时单位存在时间：基础需求量（未缩放）记在 `tempLifeNeed` 上，需求量按**当时**时间系数整数化，
    // 已推进 tick 数归 0（见 startLife / applyTempTick）。
    if (isTemp) startLife(u, (sum.lifespan_ticks || 0) > 0 ? sum.lifespan_ticks : 60, timeCoeffOf(u));
    u.summonIcon = A.icon || inst.cfg.icon || ''; // 召唤单位图标：attrs.icon 优先，其次模块 icon
    if (sum.projectile) u.isProjectile = true; // 弹体类召唤单位（火箭/导弹）：可被目标词条 exclude 排除
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
    fillHullVitals(u);  // 满血/满能量登场（同 spawnList 逻辑）：三围已含自身常驻加成（installModule 时重算）
    seedSpawnShields(u); // 自带持续护盾首 tick 即满盾就位
    u._takeMulTick = damageTakeMul(u); // 本 tick 受伤减免快照（新召单位不在本 tick 的 Pass1 名单里）
    u._timeCoeffTick = timeCoeffOf(u); // 同上：本 tick 单位时间系数快照（新召单位同理）
    u._stealthTick = isStealthed(u);   // 同上：本 tick 潜行快照（新召单位同理；唯一读口径 isStealthed）
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
    startCooldown(inst, tickTimeCoeff(ship)); // 召唤后进入冷却（需求量按当前时间系数、已推进归 0）
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

  /** 激活前可行性：时长型加盾模块（未在持续期即可激活）；纯增益须对某目标生效。
   *  `ship` ＝施放方自身（自身词条的判定对象），`targets` ＝本次解析出的目标（目标级词条的判定对象）。 */
  function canImpact(ship, targets, fx, inst) {
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
    // 目标级系数/受伤减免修饰词条（`*_target` 后缀）：恒可影响（对每个解析目标施加）
    for (const k of Object.keys(COEFF_ADD_T)) if ((fx[k] || 0) !== 0) return true;
    for (const k of Object.keys(DAMAGE_TAKE_MUL_T)) if ((fx[k] || 0) > 0) return true;
    // `force_target_self` 为 `type` 标签（不是词条）：按标签恒可影响（作用集合由目标选择器给出）
    if (isType(fx, 'force_target_self')) return true;
    // 时间系数词条（`time_coeff`）：恒可影响（作用集合＝目标 ∪ 波及 ∪ 自身，见 effectSetOf）
    //  ★ 系数可正可负（加速/放缓皆是有效效果），故判定用 `!== 0` 而非 `> 0`。
    for (const k of Object.keys(TIME)) if ((fx[k] || 0) !== 0) return true;
    // `shield_gain` 为**自身词条** → 按施放方自身是否缺盾判定（不再看目标）
    if ((fx.shield_gain || 0) > 0 && ship && ship.hull.shield < ship.hull.shieldCap) {
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
   *   shieldHeals:   对本单位自身池的 补盾(正)/汲取(负) 序列（`shield_gain_target`＝目标级：记在被作用目标上；
   *                  `shield_gain`＝**自身词条**：记在施放方自己的 pending 上，即作用于自身），
   *                  每条 { inst, amount }，用于 Pass2 顺序 poolShieldAdd。
   *   energyDeltas:  对本单位能量的直接增/减序列（energy_target），每条 { inst, amount }。
   *   hpDeltas:      对本单位血量的直接增/减序列（`hp_target`），负可致死，每条 { inst, amount }。
   *                  ★ 常驻被动「回收利用」的按阵亡回血（`hp_regen_per_death`）**复用本序列**
   *                  （每条另带 `regen:true` 仅用于结算阶段记低频战报）：Pass1 只读上一 tick 阵亡数
   *                  快照 `lastTickDeaths` 记账，结算步骤 4c 与 hp_target 同批 `applyHpTo` 落地。
   *   selfDestruct:  { inst, amount }｜null —— self_destruct_damage（对本单位自身直接扣/回血，致死记 selfDestruct）。
   *   capOps:        本 tick 由本单位模块产生的“上限修改意图”（Pass1 只记账，结算步骤 2 统一落地）：
   *                   { inst, actor, ops:[[field, value]…], targets:[单位引用…], paralyze:bool }。
   *   expiries:      本 tick 到期的“时长撤销/恢复意图”（Pass1 只记账，结算步骤 2 统一落地）：
   *                   { ship, inst, cancelled }；cancelled=该模块当 tick 又重新激活（到期被覆盖）。
   *   energyRegen:   本 tick 能量回充额度（Pass1 只记账，结算步骤 3 统一落地）。
   *   energySpends:  本 tick 模块能量消耗序列（每激活一次记一条；结算步骤 3 按序落地）：
   *                   每条 { inst, amount }。
   *   poolFills:     本 tick“模块护盾池创建+填满意图”（时长型护盾重新激活；结算步骤 4a 落地）：每条 { inst }。
   *   tempTick:      本 tick 临时单位寿命递减意图（结算步骤 4e 落地，到期即判死）。
   *   coeffOps:      本 tick 的**系数/受伤减免修饰意图**（Pass1 记账或激活时记账，结算步骤 2 落地）：
   *                   每条 { inst, ship, category?, mode:'add'|'mul'|'takeMul', value, want, self? }；
   *                   `mode:'add'|'mul'`＝**类别系数**修饰（`category` 必填，写 `coeffMods/coeffMulMods`）；
   *                   `mode:'takeMul'`＝**受伤减免系数**修饰（不分类别，写 `damageTakeMulMods`＝该单位受伤统乘）；
   *                   `ship`＝**被作用单位**：自身词条＝模块所属单位（`self:true`，幂等读 `inst._coeffAdd/_coeffMul/_takeMul`）；
   *                   目标级词条（`*_target` 后缀）＝**逐目标一条**（`self` 缺省 false，幂等从对应表回读）。
   *                   `want`=期望生效（状态型读 tick 起始条件；时长型激活时恒 true、到期时由 expiries 撤销）。
   *   forceOps:      本 tick 的**强制目标意图**（`type` 标签 `force_target_self` 激活时记账，结算步骤 2b 落地）：
   *                   每条 { inst, actor, targets:[单位引用…] } —— 把各目标压入“强制来源栈”（施放者＝actor）。
   *   timeOps:       本 tick 的**时间系数意图**（`time_coeff` 激活时记账，结算步骤 2 与上限/系数同批落地）：
   *                   每条 { inst, targets:[单位引用…]（＝effectSetOf 的作用集合）, coeff } —— 写各单位的
   *                   `ship.timeCoeffMods`（多来源组合规则见 ship.js refreshTimeCoeff），
   *                   供其**下一 tick 起**的计时器需求量（timeScaled）使用。
   *   stealthOps:    本 tick 的**潜行意图**（`type` 标签 `stealth` 激活时记账，结算步骤 2 与
   *                   上限/系数/时间系数同批落地）：每条 { inst, targets:[单位引用…]（＝effectSetOf 的作用集合） }
   *                   —— 给各单位的 `ship.stealthMods` 打来源 key（潜行＝不可作为主要攻击目标），
   *                   供其**下一 tick 起**的目标解析（`stealthBlocksTargeting`）使用；**零数值变化**。 */
  function freshPending() {
    return {
      dmg: [],
      shieldHeals: [],
      energyDeltas: [],
      hpDeltas: [],
      selfDestruct: null,
      capOps: [],
      expiries: [],
      energyRegen: 0,
      energySpends: [],
      poolFills: [],
      tempTick: false,
      coeffOps: [],
      forceOps: [],
      timeOps: [],
      stealthOps: [],
    };
  }
  /** 惰性取某单位 pending（召唤新单位当 tick 被锁定命中时也能挂账） */
  function pendOf(u) {
    if (!u) return null;
    if (!u.__pending) u.__pending = freshPending();
    return u.__pending;
  }

  /* ---------- 计时器通用口径（★ 每 tick 恒推进 1 tick；时间系数只改“需求量”）----------
   * 每个计时器各自记录**已推进 tick 数**（模块：`inst.durElapsed`/`inst.cdElapsed`；临时单位：`u.tempLifeElapsed`），
   * **剩余 = 需求量 − 已推进**，其中 `需求量 = timeScaled(基础量, 单位时间系数)`（整数 tick，见 ship.js）。
   * 因此系数在计时**中途**落地/撤销时也能正确生效：已推进数不回退，剩余始终随需求量**同向**变化
   * （需求变小 → 剩余必然变小，绝不出现错向）。
   * 计时器**启动/重置**（进入持续期、进入冷却、召唤临时单位）时必须把对应的已推进数归 0。 */
  /** 启动/重置模块**持续期**计时：需求量按**当前**时间系数整数化，已推进数归 0。 */
  function startDuration(inst, coeff) {
    const fx = inst.cfg.effects || {};
    inst.durElapsed = 0;
    inst.durationLeft = timeScaled(fx.duration_ticks || 0, coeff);
  }
  /** 结束模块**持续期**（不进入冷却）：剩余与已推进数一并归 0。
   *  ★ `delayed_trigger` 的待触发载荷随持续期一并撤销：唯一触发时机是**自然到期结算的瞬间**
   *    （`advanceModuleState` 的到期分支），提前结束（停用/阵亡/移出场景/破盾）不产生效果。 */
  function endDuration(inst) {
    inst.durationLeft = 0;
    inst.durElapsed = 0;
    inst._delayedRefs = null;
    inst._delayedDmg = 0;
    inst._delayedPrimary = null;
    inst._delayedBlast = false;
  }
  /** 启动/重置模块**冷却**计时：需求量按**当前**时间系数整数化，已推进数归 0。 */
  function startCooldown(inst, coeff) {
    const fx = inst.cfg.effects || {};
    inst.cdElapsed = 0;
    inst.cooldown = timeScaled(fx.cooldown_ticks ?? 1, coeff);
  }
  /** 清空模块**冷却**（激活进入持续期）：剩余与已推进数一并归 0。 */
  function clearCooldown(inst) {
    inst.cooldown = 0;
    inst.cdElapsed = 0;
  }
  /** 启动/重置**临时单位存在时间**计时：需求量按**当前**时间系数整数化，已推进数归 0。 */
  function startLife(u, baseNeed, coeff) {
    u.tempLifeNeed = baseNeed; // 基础需求量（未缩放，供后续每 tick 按当时系数重算）
    u.tempLifeElapsed = 0;
    u.tempLeft = timeScaled(baseNeed, coeff);
  }

  /** ★ `type` 标签 `delayed_trigger`（**后触发**）的落地点：**效果在持续期结束（到期结算）时才触发**。
   *  在 `advanceModuleState` 的**自然到期分支**调用（仍在 Pass1：**只记账、零数值变化**）：
   *  · 按既有伤害记账方式把伤害写入**激活瞬间冻结的作用集合**内各存活单位的 `__pending.dmg`
   *    （主目标 `splash:false`；`blast_range` 波及 `splash:true` 且带 `gate`，与 `maybeActivate`
   *    的即时爆炸**同一条目格式**）→ 随后由 Phase A 收集、Phase B `settleHits` 统一结算：
   *    护盾池吸收 / 防爆拦截（`blast` 标签）/ 溅射抑制（gate）/ 反射 / 判死 / 战报**全部沿用既有链路**，
   *    **不新增任何伤害体系**。
   *  · 出伤数值与作用集合都在**激活瞬间**冻结（`inst._delayedDmg` / `inst._delayedRefs`），
   *    故持续期内的类别系数变化不影响本次引爆；作用集合内已阵亡/离场者跳过（结算侧还会再复核）。
   *  · 载荷在触发时一并清空（`endDuration` 的提前结束路径同样清空 → 停用/阵亡/移出场景不产生效果）。 */
  function fireDelayedEffect(ship, inst) {
    const refs = inst._delayedRefs;
    const dmg = inst._delayedDmg || 0;
    const blast = !!inst._delayedBlast;
    const primary = inst._delayedPrimary;
    inst._delayedRefs = null;
    inst._delayedDmg = 0;
    inst._delayedPrimary = null;
    inst._delayedBlast = false;
    if (!ship || !refs || !refs.length || dmg <= 0) return;
    // 本次触发的伤害统计项（结算阶段 `landDamageApp` 回填 → Phase C `finalizeModules` 写回
    // lastDmg / 累计 damageDealt；激活本身已在 `maybeActivate` 计入 activations）
    inst._pendingAct = { dmg: 0, shield: 0 };
    const actKey = `${ship.id}:${inst.id}`; // 溅射抑制 gate（与即时爆炸同一 key 口径）
    for (const u of refs) {
      if (!u || !u.alive) continue; // 已阵亡/移出场景者跳过
      const P = pendOf(u);
      if (!P) continue;
      const isPrimary = !!(primary && primary.has(u.id));
      P.dmg.push({
        actor: ship,
        inst,
        amount: dmg,
        blast,
        splash: !isPrimary,
        gate: !isPrimary && blast ? actKey : null, // 仅爆炸型可被防爆抑制
      });
    }
  }

  /** 单模块状态结构推进 + 有效贡献窗口累计（时长/冷却倒计时）。
   *  Pass1 单位遍历内、逐模块调用（先结构推进，再判定是否激活）。
   *  ★ 计时器（durationLeft/cooldown）与窗口累计就地完成：它们是**模块私有计时器**，不对任何
   *    单位数值产生可见影响，也不会波及其它单位；真到期的**撤销/恢复**（dropSourceMods +
   *    recalcDerived，会改上限）才是有跨单位影响的数值修改 —— 故只记“到期撤销意图”，
   *    由结算步骤 2 与上限修改一起统一落地（同 tick 双方一致）。 */
  function advanceModuleState(ship, inst, ctx) {
    if (!inst.enabled) return; // 停用模块：冷却/持续/窗口全部冻结
    const fx = inst.cfg.effects;
    // ★ 本 tick 的单位**时间系数**（读 Pass1 快照）→ 决定本 tick 各类计时器的需求量；
    //   每 tick **推进量恒为 1**（不再随系数变化），只有“需要多少 tick 才走完”随系数变化。
    const coeff = tickTimeCoeff(ship);
    if (inst.durationLeft > 0) {
      inst.durElapsed = (inst.durElapsed || 0) + 1; // 已推进恒 +1
      inst.durationLeft = Math.max(0, timeScaled(fx.duration_ticks || 0, coeff) - inst.durElapsed);
      if (inst.durationLeft <= 0) {
        inst.durationLeft = 0;
        inst.durElapsed = 0;
        // ★ `delayed_trigger`（后触发）：**持续期结算到期的瞬间才产生效果** —— 就在此处按既有伤害
        //   记账方式写入各作用单位的 `__pending.dmg`（仍是 Pass1：只记账、零数值变化），
        //   由 Phase A 收集、Phase B 统一按既有命中链路结算（护盾/防爆/判死/战报）。
        if (isType(fx, 'delayed_trigger')) fireDelayedEffect(ship, inst);
        if ((fx.cooldown_ticks || 0) > 0) startCooldown(inst, coeff); // 进入冷却（需求量按当前系数）
        // ★ 到期撤销/恢复不再即时执行：只记账（携带 inst 与所属单位），结算步骤 2 统一落地
        const rec = { ship, inst, cancelled: false };
        ctx.P.expiries.push(rec);
        inst._expiryRec = rec; // 若本 tick 又重新激活 → 在 maybeActivate 里标记 cancelled
      }
    } else if (inst.cooldown > 0) {
      inst.cdElapsed = (inst.cdElapsed || 0) + 1; // 已推进恒 +1
      inst.cooldown = Math.max(0, timeScaled(fx.cooldown_ticks ?? 1, coeff) - inst.cdElapsed);
      if (inst.cooldown <= 0) inst.cdElapsed = 0;
    }
    // 有效贡献窗口累计（读本 tick 起始态 + 单位内运行计数，先于本模块激活）
    if (moduleActiveNow(ship, inst, ctx.avail)) inst.stats.activeTicks += 1;
  }

  /** 条件型自身增益（type 含 `solo`）：**仅当“非召唤的友方存活单位”只有自己一个**时生效。
   *  ★ 召唤物不计入：以 `summonMod`（`doSummon` 对召唤单位打的模块标记）或 `isSummon`
   *    （`spawnSummoned` 打的召唤标记）为准 —— 临时单位/弹体类单位天然被覆盖，
   *    即“自己召唤出单位**不会**让本效果失效”。仅统计本阵营的非召唤存活单位数 ≤ 1（含自己）。
   *  读 tick 起始存活状态即可（本 tick 的判死全部延后到结算阶段 → Pass1 内该计数稳定，
   *  且与单位遍历位置无关）。 */
  function soloConditionHolds(ship) {
    let n = 0;
    for (const u of sidesOf(ship.side)) {
      if (!u.alive) continue;
      if (u.summonMod || u.isSummon) continue; // 排除召唤物（临时单位/弹体亦被覆盖）
      n += 1;
    }
    return n <= 1;
  }

  /** ★ 状态型模块（`type` 含条件标签，如 `solo`；或常驻被动 `passive`）**当前是否生效**的**唯一权威判据**
   *  ——供 UI 读取。
   *  · `solo`：判据 = 结算阶段落地的实际生效值（加性系数 `inst._coeffAdd`（0 = 未生效）/ 受伤减免
   *    `inst._takeMul`（1 = 未生效））；
   *  · `passive`（常驻增幅器）：判据 = **模块启用中**（静态加成在开战前就已计入派生值，与战斗阶段无关）。
   *  **UI 不得自行重算条件**（避免两套口径）。
   *  返回：`true` = 生效中；`false` = 条件未满足/未生效；`null` = 非状态型模块
   *  （UI 走原有 就绪/冷却/持续 逻辑，故其它模块显示不回归），或战斗未进行中（尚无结算结果）。 */
  function moduleEffective(inst) {
    const fx = inst && inst.cfg && inst.cfg.effects;
    if (!fx) return null;
    // ★ **常驻被动**（`type` 标签 `passive`，如增幅器类）：装上即生效、无“激活-触发”流程，
    //   生效判据 = 模块启用中；**与战斗阶段无关**（静态加成在开战前就已计入派生值）
    //   → 不返回 null（UI 据此显示「生效中」/「已停用」，且不显示倒计时徽标与就绪脉动）。
    if (isType(fx, 'passive')) return inst.enabled !== false;
    if (!isType(fx, 'solo')) return null;
    const hasTerm =
      Object.keys(COEFF_ADD).some((k) => (fx[k] || 0) !== 0) ||
      Object.keys(DAMAGE_TAKE_MUL).some((k) => (fx[k] || 0) > 0);
    if (!hasTerm) return null;
    if (phase !== 'running') return null; // 未开战/已结束：无结算结果，交给原有中性显示
    const on = !!inst._coeffAdd || (inst._takeMul || 1) !== 1;
    return !!on && inst.enabled !== false;
  }

  /** ★ **触发门控（`hp_below_activate`）当前是否满足**的**唯一权威判据**——供 UI 读取。
   *  与 `moduleEffective`（状态型 `solo` 的生效判据）**同一个思路**：UI 只读引擎判据、**绝不自算条件**。
   *  判据（与引擎 `maybeActivate` 顶部的门控判定**完全同源**）：
   *    · 无该词条 / 无门控（`hp_below_activate <= 0`）→ `null`（**非门控型**，UI 走原有状态逻辑）；
   *    · 战斗未进行中（`running` 之外）→ `null`（无运行期状态，交给原有中性显示）；
   *    · `inst._firedOnce`（**本次低血区间已触发过**、血量回升过阈值才清标记）→ `false`（条件未满足）；
   *    · 否则比较**血量比例** `hull.hp / hull.hpMax ≤ hp_below_activate` → `true/false`。
   *  返回：`true` = 门控满足（可激活）；`false` = **条件未满足**（UI 据此显示「条件未满足」，**不得显示“就绪”**）；
   *  `null` = 非门控型 / 战斗未进行中。 */
  function moduleGateMet(inst) {
    const fx = inst && inst.cfg && inst.cfg.effects;
    if (!fx) return null;
    const need = fx.hp_below_activate || 0;
    if (!(need > 0)) return null; // 无门控词条：非门控型模块
    if (phase !== 'running') return null; // 未开战/已结束：无运行期门控状态
    const holder = ownerOf(inst);
    if (!holder) return null;
    if (inst._firedOnce) return false; // 本低血区间已触发过（血量回升过阈值才清标记）
    const hpMax = holder.hull.hpMax || 0;
    const ratio = hpMax > 0 ? holder.hull.hp / hpMax : 0;
    return ratio <= need;
  }

  /** Pass1 —— 条件型自身增益：**只记“期望生效状态”**（零数值变化）。
   *  与“激活-触发”流程无关（状态型：无冷却/耗能/持续期），故不进 maybeActivate；
   *  真正的加减由结算步骤 2 `applyCoeffOp` 统一落地（系数加性 → `coeffMods`；受伤减免 → `damageTakeMulMods`）。 */
  function pass1CoeffState(ship, inst, ctx) {
    const fx = inst.cfg.effects;
    if (!fx) return;
    const key = Object.keys(COEFF_ADD).find((k) => (fx[k] || 0) !== 0);
    const dmgKey = Object.keys(DAMAGE_TAKE_MUL).find((k) => (fx[k] || 0) > 0);
    if (!key && !dmgKey) return;
    const want = !!inst.enabled && isType(fx, 'solo') && soloConditionHolds(ship);
    if (key) {
      ctx.P.coeffOps.push({
        inst,
        ship, // 自身词条：作用对象＝模块所属单位
        category: COEFF_ADD[key],
        mode: 'add',
        value: fx[key],
        want,
        self: true, // 幂等读 inst._coeffAdd（同时供 UI 判据 moduleEffective 使用）
      });
    }
    if (dmgKey) {
      ctx.P.coeffOps.push({
        inst,
        ship, // 自身词条：作用对象＝模块所属单位
        mode: 'takeMul',
        value: fx[dmgKey],
        want,
        self: true, // 幂等读 inst._takeMul（同时供 UI 判据 moduleEffective 使用）
      });
    }
  }

  /** Pass1 —— **常驻被动**（`type` 标签 `passive`）：**只记账、零数值变化**。
   *  · 静态加成类词条（`hp_cap_bonus` / `energy_cap_bonus` / `energy_regen_bonus` / `X_coeff_add`）：
   *    **本函数无任何 tick 动作** —— 其数值在“安装 / 启停”时由 ship.js `syncSelfStatics` 派生落地
   *    （非“激活-触发”流程：无冷却、无耗能、无持续期、不产生战报）。
   *  · 按**上一 tick 阵亡数**结算的词条（`hp_regen_per_death`，如「回收利用」）：读快照 `lastTickDeaths`
   *    （本 tick 内恒定）→ 记 `__pending.hpDeltas`，与 `hp_target` **同一落地路径**（结算步骤 4c 统一
   *    `applyHpTo`：**真实回血**、钳制到 `hpMax`、正值不乘受伤减免、可致死者只有负值路径）；
   *    `regen:true` 仅为结算阶段“实际回血>0 时记一条低频战报”的标记。
   *    ★ **0 阵亡 → 不记任何账**（本 tick 零数值变化、无战报）。 */
  function pass1Passive(ship, inst, ctx) {
    if (!inst.enabled) return; // 停用：不生效（静态加成部分已由 disableModule → recomputeCap 回退）
    const fx = inst.cfg.effects;
    if (!fx) return;
    const per = fx.hp_regen_per_death || 0;
    if (!(per > 0)) return; // 无该词条：常驻被动无 tick 动作
    const n = lastTickDeaths; // ★ 上一 tick（双方合计、排除召唤物）的阵亡数快照
    if (!(n > 0)) return; // 0 阵亡：不回血
    ctx.P.hpDeltas.push({
      inst,
      amount: per * coeff(ship, inst.cfg.category) * n, // 词条值 × 类别系数 × 上一 tick 阵亡数
      regen: true,
    });
  }

  /** 结算步骤 2 —— 统一落地一条“修饰意图”：仅在**生效状态/数值发生变化**时写入/撤销。
   *  `inst._coeffAdd`（加性，0=未生效）与 `inst._coeffMul`（乘性，1=未生效）记录本模块当前已生效值，作幂等判据。
   *  `mode:'takeMul'`（受伤减免）改写 `ship.damageTakeMulMods`，幂等值记在 `inst._takeMul`（自身）/ 单位表（目标级）。
   *  与上限修改同属“上限/系数类”，故与 capOps 同批（先于伤害结算），跨单位顺序一致。 */
  function applyCoeffOp(rec) {
    const ship = rec.ship;
    const inst = rec.inst;
    const isMul = rec.mode === 'mul';
    const isTake = rec.mode === 'takeMul';
    const offVal = isMul || isTake ? 1 : 0;
    const on = !!rec.want && !!inst.enabled && !!ship && ship.alive;
    const val = on ? rec.value : offVal;
    // 幂等判据：自身记录读模块实例上的已生效值；**目标级记录逐目标从对应表回读**
    //（`_coeffAdd/_coeffMul/_takeMul` 只能记一条，无法代表“同一模块对不同单位”各自的状态）。
    const cur = rec.self
      ? isTake
        ? inst._takeMul || 1
        : isMul
          ? inst._coeffMul || 1
          : inst._coeffAdd || 0
      : isTake
        ? appliedTakeMul(ship, inst.id)
        : appliedCoeff(ship, inst.id, rec.category, rec.mode);
    if (val === cur) return; // 状态未变：不写不改（幂等）
    if (rec.self) {
      if (isTake) inst._takeMul = val;
      else if (isMul) inst._coeffMul = val;
      else inst._coeffAdd = val;
    }
    if (!on) {
      if (isTake) clearDamageTakeMulMod(ship, inst.id);
      else if (isMul) clearCoeffMulMod(ship, inst.id);
      else clearCoeffMod(ship, inst.id);
      return;
    }
    if (isTake) setDamageTakeMulMod(ship, inst.id, val);
    else if (isMul) setCoeffMulMod(ship, inst.id, rec.category, val);
    else setCoeffMod(ship, inst.id, rec.category, val);
    // 护盾类别系数会参与模块护盾池容量（modulePoolCapOf → coeff(ship,'shield')）：
    // 若某词条修饰 shield 类别（自身或目标级），此处同步重算该单位的派生池；attack 类别不涉及派生值。
    // （受伤减免不参与 coeff()，无需重算派生值。）
    if (rec.category === 'shield' && ship.alive) recalcDerived(ship);
  }

  /* ---------- 受伤减免系数（`damage_coeff_mul` 系列）----------
   * ★ 口径（受击向）：**该单位受到的伤害全部乘上它**（0.95 = 只承受 95%）。
   * ★ **唯一结算点**＝`applyHit(target, amount, …)` 的入口（`amount * tickTakeMul(target)`，
   *   在吸入护盾/舰体之前）——故主目标命中、爆炸/波及、反射返程、负值扣血·削盾量值
   *   等**所有来源**自动一并减免，出伤侧无需逐点相乘。
   * ★ 豁免：自毁 `self_destruct_damage`（`applySelfDestruct` 独立路径）、能量削减、上限类 `*_cap_target`。 */
  /** 本 tick 该单位的受伤减免系数（唯一读取入口）：取 Pass1 单位开头写下的**快照** `u._takeMulTick`，
   *  保证同一 tick 内“受伤按 tick 起始值算”，本 tick 结算阶段落地的减免从**下一 tick** 才体现（镜像对等）；
   *  Pass1 内新召单位（弹体/无人机）在其生成时即写下快照，无快照者现算兜底。 */
  function tickTakeMul(u) {
    if (u && typeof u._takeMulTick === 'number') return u._takeMulTick;
    return damageTakeMul(u);
  }

  /* ---------- 时间系数（`time_coeff` 词条 · 影响“需求量”，不改每 tick 推进量）----------
   * ★ 口径：作用对象的**时间系数**（负＝加速、正＝放缓）只改各计时器的**需求量**：
   *     `需求量 = timeScaled(基础量, 系数)`（＝`max(0, round(基础量 × (1 + 系数)))`，整数 tick）；
   *     每个计时器各自记**已推进 tick 数**，**剩余 = 需求量 − 已推进**，且**每 tick 推进恒为 1**。
   *   作用于三处（均在 battle.js）：
   *     · `advanceModuleState` 的模块**持续时间** `inst.durationLeft`（elapsed＝`inst.durElapsed`）；
   *     · 同函数的模块**冷却** `inst.cooldown`（elapsed＝`inst.cdElapsed`；剩余钳到 0）；
   *     · 结算步骤 4e `applyTempTick` 的临时单位**存在时间** `u.tempLeft`（elapsed＝`u.tempLifeElapsed`）。
   * ★ **中途变更系数**：需求量每 tick 按快照系数重算、已推进数不回退 → 剩余总是“新需求 − 已推进”，
   *   需求变小则剩余必变小（不可能出现错向）；系数被撤销后需求量回到基础值，剩余随之回到未加速的进度。
   * ★ 多来源组合规则见 ship.js `refreshTimeCoeff()`（当前＝**加性求和**；切换点在该函数一行内）。
   * ★ 落地与撤销都在**结算阶段**（激活＝结算步骤 2；到期/停用/阵亡/移出场景＝各自既有撤销路径），
   *   且一律读 Pass1 快照 `u._timeCoeffTick` → **下一 tick 起**生效、跨单位顺序一致。
   * ★ 战报低频：负系数＝加速（`hastenStart`/`hastenEnd`），正系数＝减速（`slowStart`/`slowEnd`）。 */
  /** 本 tick 该单位的**时间系数**（唯一读取入口）：取 Pass1 快照 `u._timeCoeffTick`，
   *  无快照者（Pass1 内新召单位已在其生成时写入；异常兜底）现算 `timeCoeffOf`。 */
  function tickTimeCoeff(u) {
    if (u && typeof u._timeCoeffTick === 'number') return u._timeCoeffTick;
    return timeCoeffOf(u);
  }

  /** 时间系数 → 该模块的低频战报键（**符号决定加速/减速侧**）：负系数＝加速、正系数＝减速。
   *  由 `applyTimeOp` 落地时记在 `inst._timeLog` 上，撤销时沿用同一对键（保证“开始/结束”成对）。 */
  function timeLogKeys(coeff) {
    return (Number(coeff) || 0) > 0
      ? { start: 'battle.log.slowStart', end: 'battle.log.slowEnd' }
      : { start: 'battle.log.hastenStart', end: 'battle.log.hastenEnd' };
  }

  /** 结算步骤 2 —— 落地一条**时间系数意图**（与上限/系数同批，先于伤害结算）：
   *  **单次一次性、仅对当前作用集合**：先撤上一批（旧集合上的系数立即失效），再对本次集合重新写入。
   *  ★ 战报（低频，**不逐次激活播报**）：仅当该模块的时间系数**从无→有**时记 1 条
   *    「开始加速/开始减速：{n}个单位」（文案由系数符号决定）。 */
  function applyTimeOp(rec) {
    const inst = rec.inst;
    const wasActive = !!inst._timeActive; // 撤销前先记下“之前是否已生效”（用于 0→有 判定）
    releaseTime(inst, true); // 先撤上一批（切换作用集合后旧单位按剩余来源重新组合）；此处恒静默
    const applied = [];
    for (const u of rec.targets) {
      if (!u || !u.alive) continue; // 结算时复核存活（集合内可能有本 tick 已判死/离场者）
      setTimeCoeffMod(u, inst.id, rec.coeff);
      applied.push(u);
    }
    inst._timeRefs = applied.length ? applied : null; // 供各撤销路径精确回退
    inst._timeActive = applied.length > 0; // 模块级“时间系数生效中”标记（战报聚合用）
    inst._timeLog = timeLogKeys(rec.coeff); // 记录本次的加速/减速侧战报键（撤销沿用）
    // 仅 **0 → 有** 记一条“开始加速/开始减速”；n＝本次**真正写入**的单位数（结算复核存活后的数量）
    if (!wasActive && inst._timeActive) {
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      battleLog(inst._timeLog.start, { owner, module: modTok(inst), n: applied.length }, ['owner']);
    }
  }
  /** 撤销某模块施加在**其作用集合**上的时间系数（到期/停用/阵亡/移出场景/重新激活前）。
   *  ★ 作用集合 `inst._timeRefs` 由**结算阶段**在记录落地后写入（Pass1 不写），
   *    保证撤销时拿到的是“上一次真正落地的集合”，不会因覆盖而漏撤销。
   *  ★ 战报（低频，**不逐次播报**）：仅当**从有→无**且 `silent` 为假时记 1 条
   *    「加速结束/减速结束：{n}个单位」（侧别沿用 `inst._timeLog`）。
   *    `silent`＝本 tick 该模块到期后又重新激活（撤销与重建同 tick 完成）：既不记“结束”，
   *    **也不清 `_timeActive`** → 紧随其后的 `applyTimeOp` 判定为“延续”，因此**不会**再记一条“开始”
   *    ⇒ 同 tick 重激活**完全静默**、不产生成对刷屏（与 `releaseForced(inst, silent)` 同一套做法）。 */
  function releaseTime(inst, silent) {
    if (!inst) return;
    const refs = Array.isArray(inst._timeRefs) ? inst._timeRefs : null;
    const n = refs ? refs.filter(Boolean).length : 0;
    if (refs) {
      for (const u of refs) if (u) clearTimeCoeffMod(u, inst.id);
      inst._timeRefs = null;
    }
    if (silent) return; // 同上：延续场景不动 _timeActive、不记战报
    if (inst._timeActive && n) {
      // 效果结束类战报一律带**模块拥有者**（形如「XX的{模块}加速结束/减速结束：{n}个单位」）
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      const keys = inst._timeLog || timeLogKeys(inst.cfg && inst.cfg.effects ? inst.cfg.effects.time_coeff : 0);
      battleLog(keys.end, { owner, module: modTok(inst), n }, ['owner']);
    }
    inst._timeActive = false;
  }

  /** 撤销某模块施加在**其本次激活作用集合**上的目标级修饰（系数修饰 + 受伤减免）：
   *  逐被作用单位清掉该来源 key 的加性/乘性系数修饰与受伤减免（护盾类别顺带重算派生池）。
   *  ★ 作用集合 `inst._coeffRefs` 由**结算阶段**在记录落地后写入（Pass1 不写），保证撤销时拿到的是
   *    “上一次真正落地的集合”，重复激活不会因覆盖而漏撤销。 */
  function releaseCoeffRefs(inst) {
    if (!inst || !Array.isArray(inst._coeffRefs)) return;
    for (const u of inst._coeffRefs) {
      if (!u) continue;
      clearAllSourceMods(u, inst.id);
      if (u.alive && inst._coeffShield) recalcDerived(u);
    }
    inst._coeffRefs = null;
  }

  /* ---------- 强制目标（`type` 标签 `force_target_self`）----------
   * ★ 结构：**每单位一个有序强制来源栈** `u.forceStack = [{ instId, actorId, seq }]`
   *   - 顺序＝来源**激活先后**（`seq` 单调递增，数组恒按 seq 升序）→ **栈顶＝最后激活仍生效的来源**，
   *     即“后激活者优先被集火”：集火顺序 C → B → A。
   *   - 派生标签：`u.forcedTargetId`＝栈顶来源的施放者单位 id、`u.forcedBy`＝栈顶模块实例 id。
   *     （旧版 `forceSrcs` Map 已升级为本有序栈；Map 结构不再使用。）
   * ★ 目标优先级（见 `moduleTargetList`）：**激活锁定(`lock_target_on_activate`) > 强制目标 >
   *   模块手动目标 > 优先自己(`prefer_self`) > 船 `targetId` > 自动粘性 > 全队策略**。
   *   强制**不改写**被强制单位的 `targetId`——玩家/既有选定的主要目标保持原样，
   *   故所有来源失效后该单位自然**按正常优先级**继续解析（不恢复任何“被强制前的快照”）。
   * ★ 回落链：某来源提前取消/到期/停用/阵亡/离场时，把它从各被强制单位的栈中移除；
   *   若移除的是栈顶 → 其**集火对象回落到下一个仍生效的来源**（C 消失 → B）；
   *   栈空 → 该单位回到正常优先级解析（A）。 */
  let forceSeq = 0; // 强制来源激活序号（单调递增；保证栈恒按激活先后排序）
  function refreshForcedTags(u) {
    const st = u.forceStack;
    if (Array.isArray(st) && st.length) {
      const top = st[st.length - 1];
      u.forcedBy = top.instId;
      u.forcedTargetId = top.actorId;
    } else {
      u.forcedBy = null;
      u.forcedTargetId = null;
    }
  }
  /** 压入一条强制来源（结算步骤 2b 落地）：同一来源重复激活 → 先移除旧条目再入栈顶（后激活者优先） */
  function pushForce(u, inst, actor) {
    if (!Array.isArray(u.forceStack)) u.forceStack = [];
    const i = u.forceStack.findIndex((e) => e.instId === inst.id);
    if (i >= 0) u.forceStack.splice(i, 1);
    forceSeq += 1;
    u.forceStack.push({ instId: inst.id, actorId: actor.id, seq: forceSeq });
    refreshForcedTags(u);
  }
  /** 从 u 的强制栈中移除某来源；返回 'none'（无此来源）/ 'unchanged'（非栈顶，集火对象不变）/
   *  'fallback'（回落到下一来源）/ 'cleared'（栈空，回到正常优先级） */
  function popForceByInst(u, instId) {
    if (!u || !Array.isArray(u.forceStack) || !u.forceStack.length) return 'none';
    const before = u.forceStack[u.forceStack.length - 1].instId;
    const i = u.forceStack.findIndex((e) => e.instId === instId);
    if (i < 0) return 'none';
    u.forceStack.splice(i, 1);
    refreshForcedTags(u);
    const after = u.forceStack.length ? u.forceStack[u.forceStack.length - 1].instId : null;
    if (before === after) return 'unchanged';
    return after ? 'fallback' : 'cleared';
  }
  /** 该单位当前被强制攻击的目标单位（栈顶来源的施放者，需存活；栈顶施放者不存在时向下回退）；
   *  返回 null ＝当前无有效强制（走正常优先级）。单位自身阵亡返回 null。 */
  function forcedTopUnit(ship) {
    const st = ship.forceStack;
    if (!Array.isArray(st) || !st.length || !ship.alive) return null;
    const foes = ship.side === 'ally' ? enemies : allies;
    for (let i = st.length - 1; i >= 0; i -= 1) {
      const u = foes.find((f) => f.id === st[i].actorId && f.alive);
      if (u) return u;
    }
    return null;
  }
  /** 撤销某模块对**其本次激活作用集合**的全部强制（到期/停用/阵亡/移出场景统一走这里）。
   *  战报按“本次撤销事件”聚合一条（不逐单位刷屏）：仅统计**栈顶变化**的单位。
   *  `silent`=本 tick 该模块到期后又重新激活（撤销与新施加同 tick 完成，不单独记“解除/回落”，避免刷屏）。 */
  function releaseForced(inst, silent) {
    if (!inst || !Array.isArray(inst._forcedRefs)) return;
    let fell = 0;
    let cleared = 0;
    for (const u of inst._forcedRefs) {
      const r = popForceByInst(u, inst.id);
      if (r === 'fallback') fell += 1;
      else if (r === 'cleared') cleared += 1;
    }
    inst._forcedRefs = null;
    if (silent) return;
    // 效果结束类战报一律带**模块拥有者**（形如「XX的{模块}{效果}结束」）：owner＝施放方单位（红/蓝）、
    // module＝模块名（绿）。ownerOf 在各撤销路径（到期/停用/阵亡/移出场景）都能取到持模块的单位。
    const holder = ownerOf(inst);
    const owner = holder ? uTok(holder) : { side: null, label: '—' };
    if (cleared) {
      battleLog('battle.log.forceRelease', { owner, module: modTok(inst), n: cleared }, ['owner']);
    }
    if (fell) {
      battleLog('battle.log.forceFallback', { owner, module: modTok(inst), n: fell }, ['owner']);
    }
  }
  /** 结算步骤 2b —— 统一落地一条“强制目标意图”：把各目标的强制目标切换为施放者。
   *  · 目标已死者跳过；不强制自己；
   *  · **锁定单位（`lockTargetId`：一次性火箭/导弹弹体）跳过**——其目标在召唤时固定、永不可改
   *    （`moduleTargetList` 对锁定单位直接返回锁定目标）；
   *  · 施放方本 tick 已死其意图照常落地（与伤害/上限修改一致）。 */
  function applyForceOp(rec) {
    const actor = rec.actor;
    if (!actor) return;
    const pushed = [];
    for (const t of rec.targets) {
      if (!t || !t.alive || t === actor) continue;
      if (t.lockTargetId) continue; // 锁定单位：跳过
      pushForce(t, rec.inst, actor);
      pushed.push(t);
    }
    // 结算侧记账：本次**真正落地**的强制作用集合（供撤销时精确出栈；Pass1 不写，避免重复激活覆盖丢失）
    rec.inst._forcedRefs = pushed;
    if (pushed.length > 0) {
      battleLog(
        'battle.log.forceTarget',
        { actor: uTok(actor), module: modTok(rec.inst), n: pushed.length },
        ['actor']
      );
    }
  }

  /* ---------- 潜行落地与撤销（`type` 标签 `stealth`）----------
   * ★ 落地：`applyStealthOp`（**结算步骤 2**，与 capOps/coeffOps/timeOps 同批、先于伤害结算）——
   *   先撤上一批（切换作用集合后旧单位按剩余来源重新组合，故必须镜像 `applyTimeOp` 的“先撤后建”），
   *   再对本次集合内的**存活**单位写入来源 key（`setStealthMod`，来源 key＝模块实例 id，可多来源并存）。
   * ★ 撤销：`releaseStealth(inst, silent)` —— 到期（`expiries`）/ 停用 / 阵亡 / 移出场景 / 重新激活前统一走它；
   *   `inst._stealthRefs`（结算阶段写入的“上一次真正落地的作用集合”）保证重复激活不会漏撤销；
   *   `silent=true`（同 tick 到期后又重新激活：`expiries` 记录带 `cancelled`）→ 既不记“结束”也**不清
   *   `_stealthActive`** → 紧随其后的 `applyStealthOp` 判为“延续”、不再记“开始” ⇒ **整体静默、不刷屏**
   *   （与 `releaseForced`/`releaseTime` 同一套做法）。
   * ★ 战报（低频聚合，遵循《战报日志开发要点》§3「效果结束类必须带模块拥有者」铁律）：
   *   仅“从无→有”记 1 条「{owner}的{module}生效：{n}个单位进入潜行」、“从有→无”记 1 条
   *   「{owner}的{module}潜行结束：{n}个单位」；**不逐次激活播报**、不逐单位播报（标记类无高频播报）。 */
  function releaseStealth(inst, silent) {
    if (!inst) return;
    const refs = Array.isArray(inst._stealthRefs) ? inst._stealthRefs : null;
    const n = refs ? refs.filter(Boolean).length : 0;
    if (refs) {
      for (const u of refs) if (u) clearStealthMod(u, inst.id); // 唯一撤销口径（ship.js）
      inst._stealthRefs = null;
    }
    if (silent) return; // 同 tick 到期并重新激活：不动 _stealthActive、不记战报（延续场景）
    if (inst._stealthActive && n) {
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      battleLog('battle.log.stealthEnd', { owner, module: modTok(inst), n }, ['owner']);
    }
    inst._stealthActive = false;
  }

  /** 结算步骤 2 —— 统一落地一条“潜行意图”（与上限/系数/时间系数同批，先于伤害结算）：
   *  **单次一次性、仅对当前作用集合**：先撤上一批，再对本次集合内的存活单位重新打标；
   *  作用集合 `inst._stealthRefs` 由**结算阶段**写入（Pass1 不写），供各撤销路径精确回退。 */
  function applyStealthOp(rec) {
    const inst = rec.inst;
    const wasActive = !!inst._stealthActive; // 撤销前先记下“之前是否已生效”（用于 0→有 判定）
    releaseStealth(inst, true); // 先撤上一批（此处恒静默）
    const applied = [];
    for (const u of rec.targets) {
      if (!u || !u.alive) continue; // 结算时复核存活（集合内可能有本 tick 已判死/离场者）
      setStealthMod(u, inst.id);
      applied.push(u);
    }
    inst._stealthRefs = applied.length ? applied : null;
    inst._stealthActive = applied.length > 0; // 模块级“潜行生效中”标记（战报聚合用，非数值）
    // 仅 **0 → 有** 记一条“进入潜行”；n＝本次**真正写入**的单位数（结算复核存活后的数量）
    if (!wasActive && inst._stealthActive) {
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      battleLog('battle.log.stealthStart', { owner, module: modTok(inst), n: applied.length }, ['owner']);
    }
  }

  /** 单位判死瞬间就地清理其全局残留（原 cleanDeadEffects“对死者”部分，逐死就地执行、省去每 tick 全量循环）：
   *  - 撤销死者自身仍在持续的时长 buff；
   *  - 撤销它与“其它单位”之间的双向影响：它施加的 cap 影响 / 目标级系数修饰 / 强制目标来源，
   *    以及它自身获得的自身词条系数修饰；强制目标只解除来源（被强制者按来源栈回落或回正常优先级）；
   *  - 清除仍指向“该死者(作为被叠加目标，已死)”的 cap 叠加。 */
  function onDeath(ship) {
    // ★ 死亡计数（唯一出口）：排除召唤/临时单位（判据与 soloConditionHolds 的"召唤物不计入"同一口径）。
    //   结算阶段累加、tick 收尾提交为 lastTickDeaths → 供**下一 tick** 的 Pass1 读取（"按上一 tick 死亡数"）。
    if (!ship.summonMod && !ship.isSummon) deathsThisTick += 1;
    for (const inst of ship.modules) {
      if (inst.durationLeft > 0) endDuration(inst); // 结束自身时长 buff（剩余/已推进一并归 0）
      dropSourceMods(inst); // 撤销其对其它目标护盾上限的影响（若无则无操作）
      clearAllSourceMods(ship, inst.id); // 撤销其自身获得的修饰（系数加/乘 + 受伤减免，阵亡即回退）
      releaseCoeffRefs(inst); // 撤销其施加在各被作用单位上的目标级修饰
      releaseTime(inst); // 撤销其施加在各被作用单位上的时间系数（携带者阵亡）
      releaseStealth(inst); // 撤销其施加在各被作用单位上的潜行标记（携带者阵亡）
      inst._coeffAdd = 0;
      inst._coeffMul = 1;
      inst._takeMul = 1;
      releaseForced(inst); // 撤销其强制目标来源（被强制者按来源栈回落或回正常优先级）
    }
    if (capOverlays.has(ship.id)) capOverlays.delete(ship.id); // 施加在死者身上的 cap 不再需要维持
    // 死者自身的强制来源栈不再有意义（它已无法行动）→ 清空，避免残留标签
    if (Array.isArray(ship.forceStack)) {
      ship.forceStack.length = 0;
      refreshForcedTags(ship);
    }
  }

  /** 清理本存活单位指向“已判死目标”的引用并回落上游（原 dropDeadTargets 里“每存活单位清自身引用”部分）。
   *  Pass1 每单位开头执行：上一 tick 判死的目标，本 tick 行动前即时回落。 */
  function clearShipDeadRefs(ship) {
    const foes = ship.side === 'ally' ? enemies : allies;
    // ★ **两个存活判据必须分开**（曾经的 BUG 根因）：
    //   · `ship.targetId`（船级目标）**只可能是敌方**（由全队策略/自动选敌产生）→ 用 `aliveFoeId`；
    //   · 模块**手动目标**（`inst.target`）范围由该模块的 `target.kinds` 决定，**可以是任意单位**
    //     （`self`/`ally`/`any`：例如“时间扭曲”选中自己或友军）→ 必须用 `aliveUnitId` 在全场单位里找。
    //     若统一按敌方队列判定，则选中自己/友军的模块手动目标会被**误判为已阵亡**，
    //     在下一个 tick 被清成 `{mode:'follow'}`（并误写一条“回落”战报）→ 表现为**手动目标改不动**。
    const aliveFoeId = (id) => {
      const u = foes.find((f) => f.id === id);
      return !!(u && u.alive);
    };
    const aliveUnitId = (id) => {
      const u = allies.find((f) => f.id === id) || enemies.find((f) => f.id === id);
      return !!(u && u.alive);
    };
    if (ship.targetId && !ship.lockTargetId && !aliveFoeId(ship.targetId)) {
      ship.targetId = null;
      battleLog('battle.log.autoTarget', { ship: uTok(ship) }, ['ship']);
    }
    for (const inst of ship.modules) {
      const t = inst.target;
      if (!t) continue;
      if (t.mode === 'unit') {
        if (!aliveUnitId(t.id)) {
          inst.target = { mode: 'follow' };
          battleLog(
            'battle.log.moduleFollow',
            { ship: uTok(ship), module: i18n.t(inst.cfg.nameKey) },
            ['ship']
          );
        }
      } else if (t.mode === 'units') {
        const kept = (t.ids || []).filter(aliveUnitId);
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

  /** 单位临时生命周期：Pass1 只记“本 tick 寿命递减意图”（结算步骤 4e 落地，到期判死记 tempExpired）。
   *  不再在 Pass1 就地判死：判死会撤销 cap 影响，属数值修改，须与其它数值一样归到结算阶段。 */
  function pass1TempLifespan(ship, ctx) {
    if (!ship.temp || !ship.alive) return;
    ctx.P.tempTick = true;
  }

  /**
   * Pass1 —— 模块激活（词条执行器判定段，不立即改目标数值）。
   * 只推进模块自身副作用（durationLeft/cooldown/_shieldSeq/自身护盾生池填池/召唤/上限叠加/粘性目标）
   * 并把对目标的数值影响写入 pending；目标值统一在 Pass2 结算。
   */
  function maybeActivate(ship, inst, ctx) {
    const fx = inst.cfg.effects;
    if (!fx) return;
    // ★ 低血触发门控（`hp_below_activate`，如 `0.2` = **仅当单位血量 ≤ 20% 时**才可激活一次）：
    //   · 只读写**结构标记** `inst._firedOnce`（非数值）→ 符合 Pass1“零数值变化”约定；
    //   · 血量比例 = `hull.hp / hull.hpMax`（`hpMax` 已含上限类词条的运行期增减）；
    //   · **标记生命周期**：本次真正激活时打标（见下方 payEnergy 之后）→ 该低血区间内不再激活；
    //     血量**回升过阈值**（比例 > 阈值）即在此清除标记 → 下次跌破阈值可再次触发；
    //   · 判定且标记清扫都在 Pass1、读 tick 起始血量（本 tick 的判死/回血均在结算阶段落地，
    //     Pass1 内血量恒定 → 判定与遍历位置无关、跨单位对等）。
    const hpNeed = fx.hp_below_activate || 0; // 0 = 无门控（既有模块行为不变）
    let hpRatio = 1;
    if (hpNeed > 0) {
      hpRatio = ship.hull.hpMax > 0 ? ship.hull.hp / ship.hull.hpMax : 0;
      if (hpRatio > hpNeed) inst._firedOnce = false; // 血量回升过阈值 → 清标记（可再次触发）
    }
    if (!inst.enabled) return;
    // 低血门控：未进入低血区间 / 本低血区间已触发过（标记未清）→ 本次不激活（不耗能、不进冷却）
    if (hpNeed > 0 && (hpRatio > hpNeed || inst._firedOnce)) return;
    if (inst.cooldown > 0) return;
    if (inst.durationLeft > 0) return; // 持续效果进行中不可重复触发
    const cost = fx.energy_cost || 0;
    // ★ 能量门控用“单位内运行计数”（tick 起始能量 + 本 tick 回充 − 本 tick 已记账消耗），
    //   而非 ship.hull.energy（能量已改为结算阶段落地）。保证同单位多模块的依次门控结果与旧即时语义一致，
    //   且该计数是单位局部、不跨单位，故不引入新的顺序差。
    if (ctx.avail < cost) {
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
        for (const t of aimList) doSummon(ship, inst, fx, t.id, true, ctx); // ignoreCap：本次齐射不受在场上限限制
        return;
      }
      if (fx.summon.bind_target) {
        const boundId = aimList.length ? aimList[0].id : undefined;
        if (boundId) doSummon(ship, inst, fx, boundId, false, ctx); // 有目标才召唤并锁定
        return;
      }
      doSummon(ship, inst, fx, null, false, ctx);
      return;
    }

    // —— 非召唤模块：解析目标并做可行性判定（目标解析读 tick 起始快照，不受本 tick pending 影响）——
    const targets = moduleTargetList(ship, inst);
    // 自毁词条(self_destruct_damage)：即使无可命中目标也必须引爆自毁（始终触发）
    const isSuicide = (fx.self_destruct_damage || 0) !== 0;
    if (!isSuicide && !targets.length) return; // 无足够目标：本次不激活
    if (!isSuicide && !canImpact(ship, targets, fx, inst)) return; // 无可生效目标：不激活不耗能

    // ★ 激活锁定（`type` 标签 `lock_target_on_activate`）：把**本次解析结果**记为锁定集合 ——
    //   · 持续期内 `moduleTargetList` 直接返回该集合（优先级高于强制目标与手动目标）；
    //   · 玩家在持续期内点选的目标只被**记录**在 `inst.target`，下一次激活时按正常链采用；
    //   · 只写“结构引用”（单位 id 列表），不产生任何数值变化 → 符合 Pass1 零数值变化约定；
    //   · 持续期结束（`durationLeft` 归 0）锁定自动失效，无需额外撤销。
    if (isType(fx, 'lock_target_on_activate')) inst._lockIds = targets.map((t) => t.id);

    // 自身能量消耗：只记账（结算步骤 3 统一落地），并在 Pass1 扣减单位内运行计数以做后续门控
    payEnergy(ctx, inst, cost);
    // ★ 低血触发（`hp_below_activate`）：本次**真正激活**（目标/可行性/能量门控均已通过）→ 打标记；
    //   该标记只在“血量回升过阈值”时被清除（见函数顶部）→ 每个低血区间只触发一次。
    if (hpNeed > 0) inst._firedOnce = true;
    if ((fx.duration_ticks || 0) > 0) {
      // 持续时间词条：先进入持续期（需求量＝timeScaled(duration_ticks, 本 tick 时间系数)，已推进归 0）；
      // 时长型护盾池的“创建+填满”改为意图（结算步骤 4a 落地，使池值变化与其它数值修改同样归到结算阶段）。
      // 持续结束后自动进冷却；瞬间量值词条走 pending。
      startDuration(inst, tickTimeCoeff(ship));
      clearCooldown(inst);
      if (inst._expiryRec) inst._expiryRec.cancelled = true; // 本 tick 到期后又重新激活 → 覆盖该次到期撤销
      if ((fx.shield_cap_bonus || 0) > 0) ctx.P.poolFills.push({ inst, ship });
      // 受伤减免词条（damage_coeff_mul）：持续期内生效 → 激活时记“置位”意图，
      // 由结算步骤 2 落地（写施放方自身的 damageTakeMulMods）；到期撤销由 expiries 统一处理。
      const mulKey = Object.keys(DAMAGE_TAKE_MUL).find((k) => (fx[k] || 0) > 0);
      if (mulKey) {
        ctx.P.coeffOps.push({
          inst,
          ship, // 自身词条（无 `_target` 后缀）：作用对象＝模块所属单位（自身获得受伤减免）
          mode: 'takeMul',
          value: fx[mulKey],
          want: true,
          self: true,
        });
      }
    } else {
      startCooldown(inst, tickTimeCoeff(ship)); // 瞬时模块：激活后进入冷却（需求量按当前时间系数）
    }

    // —— 目标级受伤减免词条（`damage_coeff_mul_target`）：对**每个解析目标**写其自身的受伤减免 ——
    //   ★ 逐目标一条记录（`rec.ship` ＝被作用单位，与自身词条区分）；与自身词条同批在结算步骤 2 落地，
    //     故同样**下一 tick 生效**。
    //   ★ 与自身受伤减免同规则：**必须搭配 `duration_ticks`**（时长型）——离开持续期才有唯一的撤销时机
    //     （到期/停用/阵亡/移出场景）；无 `duration_ticks` 的瞬时模块不施加，避免“施加后永不撤销”。
    const tMulKey = Object.keys(DAMAGE_TAKE_MUL_T).find((k) => (fx[k] || 0) > 0);
    const tAddKey = Object.keys(COEFF_ADD_T).find((k) => (fx[k] || 0) !== 0);
    if ((tMulKey || tAddKey) && (fx.duration_ticks || 0) > 0) {
      for (const t of targets) {
        if (!t.alive) continue; // 目标已死：不施加（结算时还会按 alive 复核）
        if (tMulKey) {
          ctx.P.coeffOps.push({
            inst,
            ship: t,
            mode: 'takeMul',
            value: fx[tMulKey],
            want: true,
          });
        }
        if (tAddKey) {
          ctx.P.coeffOps.push({
            inst,
            ship: t,
            category: COEFF_ADD_T[tAddKey],
            mode: 'add',
            value: fx[tAddKey],
            want: true,
          });
        }
      }
      // 作用集合 `inst._coeffRefs` 由**结算阶段**在记录落地后统一写入（Pass1 不写）：
      // 一次激活一“批”，重复激活不会覆盖掉上一批而漏撤销（撤销时机＝到期/停用/阵亡/移出场景）。
    }

    // —— 强制目标（`type` 标签 `force_target_self`）：把**目标选择器解析出的每个目标**的
    //     强制目标切换为施放者 ——
    //   ★ 引擎按**标签**识别（不按模块 id 硬编码）；受影响单位＝ `moduleTargetList` 的结果
    //   （可被 blast_range/exclude 等影响）。与上限修改同理，Pass1 只记账（结算步骤 2b 统一落地，
    //   跨单位顺序一致）。**作用集合 `inst._forcedRefs` 由结算阶段写入**（见 applyForceOp），
    //   供到期/停用/阵亡时精确出栈撤销.
    //   ★ 与系数修饰同规则：**必须搭配 `duration_ticks`** —— 持续期结束是唯一的自动撤销时机；
    //     无时长的瞬时模块不施加（否则“施加后永不撤销”，且重复激活会丢掉上一批作用集合）。
    if (isType(fx, 'force_target_self') && (fx.duration_ticks || 0) > 0) {
      const fTargets = targets.filter((t) => t !== ship);
      ctx.P.forceOps.push({ inst, actor: ship, targets: fTargets });
    }

    // —— ★ 潜行（`type` 标签 `stealth`）：把**作用集合**内的单位标记为“潜行”（不可作为主要攻击目标）——
    //   · 引擎按**标签**识别（不按模块 id 硬编码）；作用集合＝**共享 helper** `effectSetOf`
    //     （解析到的目标 ∪ `blast_range` 波及 ∪ `include_self` 自身），与上限类/时间系数词条同源
    //     （“潜行”模块 kinds:['self'] → 集合即自身；将来若要“给友军上潜行”只需改选择器，引擎无需改动）。
    //   · 与其它时长型修饰同规则：**必须搭配 `duration_ticks`** —— 持续期结束是唯一的自动撤销时机
    //     （到期 / 停用 / 阵亡 / 移出场景 / 重新激活前统一走 `releaseStealth`）；无时长的瞬时模块不施加。
    //   · Pass1 只记账（`__pending.stealthOps`，**零数值变化**），结算步骤 2 与 capOps/coeffOps/timeOps
    //     **同批**统一落地（先于伤害结算）→ 从**下一 tick 的目标解析**起体现。
    //   · **不改任何数值**：仍受 `blast_range` 溅射、仍受既已锁定的目标（`lockTargetId` /
    //     `lock_target_on_activate` 锁定集合）约束。
    if (isType(fx, 'stealth') && (fx.duration_ticks || 0) > 0) {
      const P = pendOf(ship);
      if (P) P.stealthOps.push({ inst, targets: effectSetOf(ship, targets, fx) });
    }

    // —— 目标级 量值/上限 词条：对每个选定目标同时生效（shield/hp/energy 三类）——
    const co = coeff(ship, inst.cfg.category);
    const amtKeys = Object.keys(AMOUNT).filter((k) => (fx[k] || 0) !== 0);
    const capKeys = Object.keys(CAPFIELD).filter((k) => (fx[k] || 0) !== 0);
    if (capKeys.length) {
      // 上限类词条为"单次一次性、仅对当前所选目标"：
      // 每次触发先撤销上次施加在(旧)目标上的上限影响，再对本次解析目标重新施加——
      // 故不随多次触发累加；切换目标后于下一次触发时生效到新目标（旧目标影响随之消失）。
      // ★ 对等性：上限修改**不在 Pass1 即时生效**，而是与伤害/数值一样归到 Pass2 结算阶段统一落地
      //   （见 applyCapOps：Phase A2，先于伤害结算）。否则本 tick 排前的施放方会即时压掉排后单位
      //   的能量/血量/护盾上限，使其判定/耗能/回能吃新上限，而镜像局面不吃 → 同 tick 双方不对等。
      //   这里只把“上限意图”记入施放方 __pending.capOps。
      // 携带者阵亡时由其判死点 onDeath 就地撤销（dropSourceMods）。
      // ★ 作用集合（激活瞬间确定并冻结）：由**共享 helper** `effectSetOf` 计算
      //   ＝ 解析到的目标 ∪ `blast_range` 波及 ∪ `include_self` 自身（时间加速等词条组共用同一实现）。
      const capTargets = effectSetOf(ship, targets, fx);
      const P = pendOf(ship);
      if (P) {
        P.capOps.push({
          inst,
          actor: ship, // 施放方引用（结算落地/战报用；施放方本 tick 已死也照常落地）
          ops: capKeys.map((k) => [CAPFIELD[k], fx[k] * co]), // 数值在激活瞬间按系数冻结
          targets: capTargets,
          paralyze: (fx.energy_cap_target || 0) < 0, // EMP 语义：能量上限被压到 0 →“瘫痪”
        });
      }
    }

    // —— 「时间系数」词条（`time_coeff`）：把**作用集合**内的单位各计时器**需求量**乘上 (1 + 系数) ——
    //   · 作用集合＝**共享 helper** `effectSetOf`（目标 ∪ blast_range 波及 ∪ include_self 自身），
    //     与上限类词条同源，故“选中友方 + 波及 + 自身”一次算清；**不新增任何作用集合逻辑**。
    //   · 与其它时长型修饰同规则：**必须搭配 `duration_ticks`**（离开持续期才有唯一的撤销时机）。
    //   · 与上限修改同批：Pass1 只记账（`__pending.timeOps`），结算步骤 2 统一落地
    //     → 落地/撤销都跨单位顺序一致，且从**下一 tick 的需求量**起体现
    //     （本 tick 的计时已按 tick 起始的快照系数推进完毕）。
    //   · 系数**不经类别系数缩放**（时间系语义：`-0.1` 就是需求量 ×0.9）；可正可负，故判定用 `!== 0`。
    const timeKey = Object.keys(TIME).find((k) => (fx[k] || 0) !== 0);
    if (timeKey && (fx.duration_ticks || 0) > 0) {
      const P = pendOf(ship);
      if (P) {
        P.timeOps.push({
          inst,
          targets: effectSetOf(ship, targets, fx),
          coeff: fx[timeKey], // 时间系数（负=加速 / 正=放缓）
        });
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
    // fx.shield_gain（**自身词条**：无 `_target` 后缀 → 作用于模块所属自身，如 alphaShield 自回盾）
    //   同入自身 shieldHeals（Pass2 结算）。要作用到目标请用 `shield_gain_target`。
    if ((fx.shield_gain || 0) > 0) {
      const Ps = pendOf(ship);
      if (Ps) Ps.shieldHeals.push({ inst, amount: fx.shield_gain * co });
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
    const effDmg = effRaw * coeff(ship, inst.cfg.category); // 出伤侧到此为止：受伤减免在 applyHit 入口按**受击方**结算
    const isBlastMod = isType(fx, 'blast'); // 爆炸型伤害（如火箭/导弹爆炸）
    // ★ `delayed_trigger`（`type` 标签，**后触发**）：本模块的伤害**不在激活时开出**，
    //   而是把「作用集合 + 出伤数值」冻结在激活瞬间，待**持续期到期结算的瞬间**才记账并走既有伤害链路
    //   （见 `fireDelayedEffect`）。注意：与 `blast`/`explosive` 等标签相互独立、可叠加。
    const isDelayedTrigger = isType(fx, 'delayed_trigger');
    // —— 主目标伤害（pending 记账，Pass2 结算实际吸收/扣血并判破盾/反射）——
    //   ★ 后触发模块（`delayed_trigger`）在此**不开出伤害**，只冻结载荷（见下方延迟块）。
    if ((fx.damage || 0) > 0 && !isDelayedTrigger) {
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
    // —— ★ `delayed_trigger`（后触发）的**载荷冻结**：激活瞬间只记结构引用与数值，不产生任何效果 ——
    //   · 作用集合＝**共享 helper** `effectSetOf`（解析到的目标 ∪ `blast_range` 波及 ∪ `include_self`），
    //     与上限类/时间系数词条同一实现，**激活瞬间冻结**（持续期内新入场/离场单位不受影响）；
    //   · 出伤数值＝`effDmg`（已按**激活瞬间**的类别系数折算，持续期内系数变化不影响本次引爆）；
    //   · 主目标 id 集合另存：引爆时用于区分“主目标命中”与“`blast_range` 溅射”（与即时爆炸同一口径，
    //     波及条目带 `gate` → 主目标被防爆池吸收时波及被抑制）；
    //   · 载荷全部为**结构引用/数值缓存**，Pass1 零数值变化；真正落地在持续期到期分支（`fireDelayedEffect`）。
    if (isDelayedTrigger && (fx.damage || 0) > 0) {
      inst._delayedRefs = effectSetOf(ship, targets, fx);
      inst._delayedPrimary = new Set(targets.map((t) => t.id));
      inst._delayedDmg = effDmg;
      inst._delayedBlast = isBlastMod;
    }
    // —— 自毁词条 self_destruct_damage：对所属单位自身血量"正加负减"（负值即扣光机体死亡）；
    //    始终触发（锁定目标即使已阵亡也照常引爆），Pass2 在自身血量上结算。 ——
    if (isSuicide && ship.alive) {
      const P = pendOf(ship);
      if (P) P.selfDestruct = { inst, amount: fx.self_destruct_damage || 0 };
    }
    // 持久化自动目标（粘性）：无手动锁定时记住本次实际命中的目标，下次沿用存活者。
    // ★ 被强制顶到首位的目标**不写入粘性**：强制是有时限的外部约束，不是本模块“自己选定”的目标；
    //   若记入粘性，强制结束（来源栈空）后仍会被粘性继续锁着 → 违背“全部来源失效后按正常优先级重新解析”。
    const autoLocked =
      !ship.targetId && (!inst.target || inst.target.mode === 'follow');
    if (autoLocked && targets.length) {
      const fr = forcedTopUnit(ship);
      const keep = fr ? targets.filter((t) => t.id !== fr.id) : targets;
      inst._stick = keep.length ? keep.map((t) => t.id) : undefined;
    }
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
    // —— 本 tick 起始：护盾/反射/同盟/防爆/受击闪标逐 tick 递减（纯表现，可即时） ——
    if (ship._healFlash > 0) ship._healFlash -= 1;
    if (ship._reflectFlash > 0) ship._reflectFlash -= 1;
    if (ship._allyFlash > 0) ship._allyFlash -= 1;
    if (ship._bpFlash > 0) ship._bpFlash -= 1;
    if (ship._dmgFlash > 0) ship._dmgFlash -= 1;
    // （本 tick 挂账已在 Pass1 遍历前为全体存活单位一次性建好，见 step()；
    //   召唤新增单位由 pendOf 惰性创建，此处不再重置，以免冲掉排前单位记到其身上的记账。）
    // —— 清理自己指向“已判死目标”的引用（结构引用清理，非数值修改）——
    clearShipDeadRefs(ship);
    // —— 本 tick 的**受伤减免系数快照**（damage_coeff_mul 系列，受击向）：Pass1 单位开头取一次，
    //    供本 tick 的全部受伤/减伤判定统一使用 →
    //    “本 tick 受伤按 tick 起始值算，本 tick 结算阶段落地的修饰从下一 tick 才体现”，
    //    与其它系数的生效时序一致（且不引入任何数值修改，仅只读缓存）。 ——
    ship._takeMulTick = damageTakeMul(ship);
    // —— 本 tick 的**单位时间系数快照**（`time_coeff`）：Pass1 单位开头取一次，
    //    供本 tick 的三类计时器需求量换算（模块持续/冷却、临时单位存在时间）统一使用 →
    //    “本 tick 的计时需求量按 tick 起始的系数算，本 tick 结算阶段落地的系数/撤销从下一 tick 才体现”，
    //    与受伤减免/系数完全同一范式（且不引入任何数值修改，仅只读缓存）。
    //    ★ 唯一口径 timeCoeffOf(ship)；每 tick 推进量恒为 1，只有“需求量”随系数变化。 ——
    ship._timeCoeffTick = timeCoeffOf(ship);
    // —— 本 tick 的**潜行快照**（`type` 标签 `stealth`）：Pass1 单位开头取一次，供本 tick 全部
    //    目标解析（`moduleTargetList` / `shipEffectiveTarget` → `stealthBlocksTargeting`）统一使用 →
    //    “本 tick 的目标解析按 tick 起始的潜行状态进行，本 tick 结算阶段落地的潜行从下一 tick 起体现”，
    //    与受伤减免/时间系数完全同一范式（且不引入任何数值修改，仅只读缓存）。
    //    ★ 唯一读口径 isStealthed(ship)。 ——
    ship._stealthTick = isStealthed(ship);
    const P = pendOf(ship);
    if (!P) return;
    // —— 能量回充：只记账（数值统一在结算步骤 3 落地）——
    const regen = energyRegenTick(ship, P);
    // ★ 单位内运行计数：本 tick 起始能量 + 本 tick 回充额度 —— 供本 tick 门控/窗口判定使用。
    //   能量本身不改（Pass1 零数值变化）；该计数是单位局部，同单位多模块依次门控结果与旧即时语义一致。
    const ctx = { ship, P, avail: Math.min(ship.hull.energyCap, ship.hull.energy + regen) };
    // —— 模块：① 结构推进(时长/冷却递减、窗口累计、到期只记撤销意图) ② 判定激活(只记账不改数值)
    //          ③ 条件型自身增益(状态型，只记期望生效状态) ④ 常驻被动(无“激活-触发”流程) ——
    for (const inst of ship.modules) advanceModuleState(ship, inst, ctx);
    for (const inst of ship.modules) {
      if (isType(inst.cfg.effects, 'solo')) pass1CoeffState(ship, inst, ctx);
      // ★ 常驻被动（`type` 标签 `passive`，如增幅器类 hp_cap_bonus/energy_cap_bonus/energy_regen_bonus、
      //   回收利用 hp_regen_per_death）：**不进“激活-触发”流程**（无冷却/耗能/持续期、无目标）。
      //   纯静态加成由派生重算落地（安装/启停时 ship.js `syncSelfStatics`）；按上一 tick 阵亡数结算的
      //   词条只在此记账（`__pending.hpDeltas`，Pass1 零数值变化），由结算步骤 4c 统一落地。
      else if (isType(inst.cfg.effects, 'passive')) pass1Passive(ship, inst, ctx);
      else maybeActivate(ship, inst, ctx); // 状态型模块不进“激活-触发”流程（无冷却/耗能/持续期）
    }
    // —— 临时单位存在时间：只记“寿命递减意图”（结算步骤 4e 落地，到期判死）——
    pass1TempLifespan(ship, ctx);
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

  /* ---- 结算步骤 4 的子步（按类别跨单位统一落地，迭代的是“记录数组”而非全量单位） ---- */

  /** 4a 模块护盾池“创建+填满”（时长型护盾重新激活）：结算阶段落地，池值变化不作为 Pass1 副作用。 */
  function applyPoolFill(rec) {
    const inst = rec.inst;
    const o = rec.ship; // 所属单位（记账时携带，避免结算期再做全量单位查找）
    if (!o || !o.alive) return; // 目标(自身)已死者跳过
    if (inst._expiryRec) inst._expiryRec.cancelled = true; // 重新激活覆盖本 tick 的到期撤销
    inst._shieldSpent = false;        // 重新激活：清除上轮"已耗尽"标记 → 重新贡献独立池/回满
    recalcDerived(o);                 // 生成该模块的护盾池（空池，总上限即提高）
    fillModuleShieldPool(o, inst);    // ★ 只把该模块自身池补满到其 cap；本体/其它模块池保持现值
    inst._shieldSeq = ++shieldSeq;    // 记录激活顺序（先激活的先被使用）
  }

  /** 4b 护盾补/汲取（含“汲取抽空 → 就地破盾降 cap”）
   *  ★ 负值（对目标的**削盾**＝伤害类削减）乘该单位的**受伤减免系数**（与 applyHit 同一口径）；
   *    正值（回盾/增益）不减免；能量削减不做减免（见 applyEnergyDeltas）。 */
  function applyShieldHeals(u, P) {
    let drainedShield = false;
    const takeMul = tickTakeMul(u);
    for (const h of P.shieldHeals) {
      const amt = h.amount < 0 ? h.amount * takeMul : h.amount;
      const act = poolShieldAdd(u, amt); // 实际作用量（正=补入，负=汲取）
      if (act < 0) drainedShield = true;      // 汲取(负)可能把池抽空 → 抽空即破盾
      if (act > 0) {
        u._healFlash = 40; // 回盾闪光标记（≈2s）
        if (h.inst && h.inst._pendingAct) h.inst._pendingAct.shield += act;
      }
    }
    if (drainedShield && u.alive) breakShieldOnDepletion(u); // 汲取抽空的池：就地破盾降 cap
  }

  /** 4d 自毁（self_destruct_damage）：直接改机体血量，负值扣光即判死。
   *  ★ **受伤减免系数对它无效**（自伤，不是“受到的伤害”；走本独立路径即天然豁免）。 */
  function applySelfDestruct(u, P) {
    if (!P.selfDestruct || !u.alive) return;
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

  /** 4e 临时单位寿命：**需求量**＝`timeScaled(lifespan, 时间系数)`、**已推进恒 +1**、剩余 = 需求 − 已推进；
   *  剩余归 0 即到期判死（并就地撤销其 cap/存续影响）。
   *  ★ 系数只改“需要多少 tick 才到期”（加速＝需求变少、放缓＝需求变多），不改每 tick 推进量。 */
  function applyTempTick(u) {
    if (!u.temp || !u.alive) return;
    const need = timeScaled(u.tempLifeNeed || 0, tickTimeCoeff(u));
    u.tempLifeElapsed = (u.tempLifeElapsed || 0) + 1; // 已推进恒 +1
    u.tempLeft = Math.max(0, need - u.tempLifeElapsed);
    if (u.tempLeft <= 0) {
      u.hull.hp = 0;
      u.alive = false;
      battleLog('battle.log.tempExpired', { ship: uTok(u) }, ['ship']);
      onDeath(u); // 就地撤销其存续效果/cap 影响
    }
  }

  /** 单次伤害结算：护盾吸收 →（爆炸先防爆拦截）→ 自身池 → 同盟/防爆共享 → 扣血；反射记账。
   * 返回 { dealt, ally, bpAbsorbed, seg }：
   *   dealt      自身池吸收 + 扣血（供 “对目标造成伤害” 统计）；
   *   ally       同盟/防爆共享池吸收总量（含防爆拦截）；
   *   bpAbsorbed 其中进入防爆池的部分（含防爆拦截）；
   *   seg        逐吸收源明细（按引擎实际吸收顺序）：{k:'mod'|'base'|'alliance'|'blastproof'|'hull', inst?, amount}，
   *              供日志按承接者逐段成句。
   * noReflect=true 时该次伤害不再触发反射（用于反射返程的补打回，避免双方反射死循环）。
   * ★ `damage_coeff_mul`（受伤减免）唯一的结算点就在本函数**入口**：先把 `amount` 按**受击方**的
   *   减免系数缩小，再走下述吸收/扣血 —— 因此所有来源（主命中/波及/反射返程）天然一致。 */
  function applyHit(target, amount, blast, actor, noReflect) {
    const zero = { dealt: 0, ally: 0, bpAbsorbed: 0, seg: [] };
    if (!target || !target.alive || amount <= 0) return zero;
    if (invincibleNow(target)) return zero; // 无敌：不受伤害、不阵亡
    // ★★ **受伤减免系数的唯一结算点**（`damage_coeff_mul` 系列，受击向）：
    //    在任何吸收（防爆拦截/护盾池/同盟/舰体）之前，把本次伤害乘上**受击方**的减免系数
    //    → 主目标命中 / 爆炸波及 / 反射返程等**所有来源**自动一并减免，出伤侧无需逐点相乘。
    //    取本 tick 快照 `_takeMulTick`（Pass1 单位开头写入）→ 本 tick 落地的减免**下一 tick**才体现。
    //    豁免：自毁 self_destruct_damage 走 applySelfDestruct 独立路径，根本不经过本函数。
    const takeMul = tickTakeMul(target);
    amount = takeMul === 1 ? amount : amount * takeMul;
    if (amount <= 0) return zero; // 减免到 0（或负）：等效未命中（不产生成句，仍按 0 伤害处理）
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

  /** 结算步骤 2 —— 统一落地一条“上限修改意图”（Phase A 收集，伤害结算之前应用）。
   *  · 施放方本 tick 已判死也照常落地（与“已死攻击方开出的伤害照常结算”一致，收集不受 alive 门控）；
   *  · 目标已死者跳过：其 onDeath 已撤销 capOverlays/清池，再施加会留残留叠加；
   *  · 先 dropSourceMods(inst)（撤销本模块上次施加的上限影响）再逐目标 setOverlay（非累加；
   *    多条记录之间顺序无关，因 recomputeCap 按目标级总和重算）；
   *  · EMP 附加（瘫痪战报 + ramp 成长清零）与上限应用同处同批执行，保证同 tick 同时生效；
   *    每次激活、每个受影响单位仍只记一条战报（记录本身即“本次激活”，持续期内不会重复触发）。 */
  function applyCapOps(rec) {
    if (!rec || !rec.inst) return;
    dropSourceMods(rec.inst);
    for (const t of rec.targets) {
      if (!t || !t.alive) continue;
      for (const [field, value] of rec.ops) setOverlay(t, rec.inst, field, value);
    }
    if (!rec.paralyze) return;
    const actor = rec.actor || ownerOf(rec.inst);
    if (!actor) return; // 无施放方引用（理论不会）：上限已落地，仅省略战报
    const actorTok = uTok(actor);
    for (const t of rec.targets) {
      if (!t || !t.alive) continue;
      battleLog(
        'battle.log.empParalyze',
        { actor: actorTok, module: modTok(rec.inst), target: uTok(t) },
        ['actor', 'target']
      );
      for (const tinst of t.modules || []) {
        const tfx = tinst.cfg && tinst.cfg.effects;
        if (tfx && (tfx.ramp_per_hit || 0) > 0 && tinst._ramp) tinst._ramp = { key: '', count: 0 }; // 成长清零（同“能量不足/停用”那套）
      }
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
      endDuration(inst); // 破盾 → 结束持续期（剩余/已推进一并归 0）
      startCooldown(inst, timeCoeffOf(ship)); // 破盾 → 进入冷却（需求量按当前时间系数）
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
    // Phase A（单遍单位 for 收集，作用于本 tick 全体[含 Pass1 新召/已死者]）：把各单位 __pending 上的
    //   各类意图并入若干**记录数组**（不新增全量单位循环）：
    //   ①伤害命中(拆主目标/爆炸波及) ②上限修改意图 ③到期撤销意图 ④能量意图 ⑤非伤害数值意图 ⑥临时寿命意图。
    // 记账挂在“受影响/施放方”上：攻击方/施放方本 tick 已死其意图仍照常落地（收集不受其 alive 门控）。
    const allNow = [...allies, ...enemies];
    const primaries = [];
    const splashes = [];
    const capOps = [];
    const expiries = [];
    const poolFills = [];
    const energyRecs = [];
    const nonDamageRecs = [];
    const tempRecs = [];
    const coeffOps = [];
    const forceOps = [];
    const timeOps = [];
    const stealthOps = [];
    for (const u of allNow) {
      const P = u.__pending;
      if (!P) continue; // 本 tick 未参与(无挂账)者跳过
      for (const app of P.dmg) {
        const a = Object.assign({ target: u }, app);
        (app.splash ? splashes : primaries).push(a);
      }
      if (P.capOps.length) capOps.push(...P.capOps);
      if (P.expiries.length) expiries.push(...P.expiries);
      if (P.poolFills.length) poolFills.push(...P.poolFills);
      if (P.energyRegen || P.energySpends.length || P.energyDeltas.length) energyRecs.push({ u, P });
      if (P.shieldHeals.length || P.hpDeltas.length || P.selfDestruct) nonDamageRecs.push({ u, P });
      if (P.tempTick) tempRecs.push(u);
      if (P.coeffOps.length) coeffOps.push(...P.coeffOps);
      if (P.forceOps.length) forceOps.push(...P.forceOps);
      if (P.timeOps.length) timeOps.push(...P.timeOps);
      if (P.stealthOps.length) stealthOps.push(...P.stealthOps);
    }

    // ── 结算步骤 1：计时推进（全单位模块时长/冷却递减、窗口累计）──
    //   本引擎把“时长/冷却递减 + 窗口累计”保留在 Pass1 就地完成：它们是**模块私有计时器**，
    //   不对任何单位数值产生可见影响、也不波及其它单位；其中唯一有跨单位影响的部分
    //   ——**到期撤销/恢复**（dropSourceMods + recalcDerived，会改上限）——已改为纯意图
    //   （见 pass1Unit → expiries），故在此直接进入步骤 2 统一次序落地。

    // ── 结算步骤 2：上限与系数统一落地（到期撤销 + 上限修改 + 系数修改），**必须先于伤害结算** ──
    //   到期撤销：模块时长结束 → 撤销其施加的上限影响 + 系数修饰 + 强制目标标签 + 自身时长加成回落（含删池）。
    //   注：系数/强制目标的撤销**先于** `cancelled` 判定执行（本 tick 到期后又重新激活＝先撤后建，
    //   避免旧作用集合的标签残留；重建由本 tick 的 coeffOps/forceOps 完成）。
    for (const e of expiries) {
      clearAllSourceMods(e.ship, e.inst.id); // 自身词条：撤销该来源在施放方自身的修饰（系数 + 受伤减免）
      releaseCoeffRefs(e.inst); // 目标级词条（*_target）：撤销其施加在各被作用单位上的修饰
      releaseTime(e.inst, !!e.cancelled); // 时间系数：撤销其施加在各被作用单位上的系数（计时需求量回落；同 tick 重激活则静默）
      e.inst._coeffAdd = 0;
      e.inst._coeffMul = 1;
      e.inst._takeMul = 1;
      releaseForced(e.inst, !!e.cancelled); // 强制来源出栈（本 tick 又重新激活则不单记“解除/回落”，避免刷屏）
      releaseStealth(e.inst, !!e.cancelled); // 潜行标记撤销（同 tick 重激活则静默：不记“结束”、保留 _stealthActive）
      if (e.cancelled) continue; // 本 tick 到期后又重新激活：该次撤销被覆盖（重新激活已重建并填满池）
      dropSourceMods(e.inst);
      if (e.ship && e.ship.alive) recalcDerived(e.ship);
    }
    //   上限修改：逐记录 dropSourceMods(inst) → 逐存活目标 setOverlay（非累加，记录间顺序无关）
    for (const rec of capOps) applyCapOps(rec);
    //   时间系数落地（`time_coeff`）：与上限同批（“作用集合”类），**先于**伤害结算
    //   → 本 tick 的计时已在 Pass1 按快照需求量算完，故系数从**下一 tick** 起体现（撤销同理）。
    for (const rec of timeOps) applyTimeOp(rec);
    //   系数/受伤减免修改（条件型自身增益 / 时长型修饰 / 目标级修饰）：与上限修改同属“上限/系数类”，
    //   同批落地、跨单位顺序一致；只在状态变化时写入/撤销（幂等）。此后本 tick 的伤害结算不使用它们
    //   （见 Phase B 说明），故生效时序 = **下一 tick 的激活/受伤**才体现
    //   （Pass1 单位开头快照 `_takeMulTick` 与 Pass1 读到的系数都是结算后的最新值）。
    //   ★ 目标级记录（`!rec.self`）的**被作用单位集合**在落地后写入 `inst._coeffRefs`（撤销依据）。
    const coeffRefsByInst = new Map(); // inst -> { units: [被作用单位…], shield: bool }
    for (const rec of coeffOps) {
      applyCoeffOp(rec);
      if (rec.self || !rec.ship) continue;
      let b = coeffRefsByInst.get(rec.inst);
      if (!b) {
        b = { units: [], shield: false };
        coeffRefsByInst.set(rec.inst, b);
      }
      if (!b.units.includes(rec.ship)) b.units.push(rec.ship);
      if (rec.category === 'shield') b.shield = true;
    }
    for (const [inst, b] of coeffRefsByInst) {
      inst._coeffRefs = b.units;
      inst._coeffShield = b.shield; // 护盾类别 → 撤销时顺带 recalcDerived
    }

    //   潜行标记落地（`type` 标签 `stealth`）：与上限/系数/时间系数**同批**（“作用集合类”），
    //   **先于**伤害结算 —— 结构性、**零数值变化** → 本 tick 的目标解析已在 Pass1 完成，
    //   故从**下一 tick 的目标解析**起体现（撤销同理）。
    for (const rec of stealthOps) applyStealthOp(rec);

    // ── 结算步骤 2b：强制目标统一落地（控制类，跨单位顺序一致）──
    //   放在系数之后、能量/伤害之前：只改各单位的目标指向（结构性），不影响本 tick 已收集的数值；
    //   其效果从**下一 tick 的目标解析**（Pass1 moduleTargetList）开始体现。
    for (const rec of forceOps) applyForceOp(rec);

    // ── 结算步骤 3：能量统一落地（回充 → 模块消耗 → 能量量值词条），规则对所有单位一致 ──
    for (const { u, P } of energyRecs) {
      if (!u.alive) continue;
      if (P.energyRegen) u.hull.energy = Math.min(u.hull.energyCap, u.hull.energy + P.energyRegen);
      for (const s of P.energySpends) u.hull.energy = Math.max(0, u.hull.energy - s.amount);
      // energy_target 量值词条：**不做受伤减免**（能量削减不是血/盾伤害），与 applyHit 的减免口径分开
      for (const e of P.energyDeltas) applyEnergyTo(u, e.amount);
    }

    // ── 结算步骤 4：护盾 / 模块池填充 / 血量 / 自毁 / 临时寿命统一落地 ──
    for (const rec of poolFills) applyPoolFill(rec);            // 4a 模块护盾池创建+填满
    for (const { u, P } of nonDamageRecs) if (u.alive) applyShieldHeals(u, P); // 4b 补/汲取盾(+破盾)
    for (const { u, P } of nonDamageRecs) {                     // 4c 血量
      if (!u.alive) continue;
      const takeMul = tickTakeMul(u); // 负值(hp_target 扣血)＝受到的伤害 → 乘受伤减免；正值加血不减免
      for (const h of P.hpDeltas) {
        const before = u.hull.hp;
        applyHpTo(u, h.amount < 0 ? h.amount * takeMul : h.amount);
        // ★ 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：**若实际回血 > 0** 才记 1 条低频战报
        //   （区别于目标级 `hp_target`：那类走既有命中/量值战报措辞；本词条按“模块拥有者 + 实际回血”
        //    成句，每 tick 每模块至多 1 条，且必须有阵亡才会出现 → 天然低频）。
        if (h.regen && u.hull.hp > before) {
          battleLog(
            'battle.log.recycleRegen',
            { owner: uTok(u), module: modTok(h.inst), n: lastTickDeaths, amount: Math.round(u.hull.hp - before) },
            ['owner']
          );
        }
      }
    }
    for (const { u, P } of nonDamageRecs) applySelfDestruct(u, P); // 4d 自毁
    for (const u of tempRecs) applyTempTick(u);                    // 4e 临时单位寿命递减/到期判死

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
    // 破盾已在 applyHit(伤害抽空)/applyShieldHeals(汲取抽空) 内就地触发，此处不再全量扫描。
    // finalize 在临时单位移出前执行，保证死去的召唤也能累计；清挂账防陈旧记账被下 tick 重复收集。
    const deadTemp = [];
    for (const u of allNow) {
      finalizeModules(u);
      u.__pending = undefined;
      if (!u.alive && u.temp) deadTemp.push(u);
    }
    for (const u of deadTemp) removeSummoned(u.side, u); // 临时单位阵亡/到期直接移出场景
    // ★ 死亡计数提交（tick 收尾，Phase C 之后）：本 tick 的死亡数 → `lastTickDeaths`，供**下一 tick**
    //   的 Pass1 读取（"按上一 tick 的死亡数结算"）；随后清零本 tick 计数。放在收尾处保证同一 tick 内
    //   的死亡绝不反馈给本 tick 的 Pass1（无反馈环、与遍历顺序无关、镜像对等）。
    lastTickDeaths = deathsThisTick;
    deathsThisTick = 0;
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
    moduleTargetLocked, // ★ “激活锁定中”的唯一判据（UI 用：显示 已锁定 / 下次生效）
    shipEffectiveTarget,
    fleetPreview,
    enableModule,
    disableModule,
    moduleEffective, // 状态型模块“当前是否生效”的唯一判据（UI 用；非状态型返回 null）
    moduleGateMet, // ★ 触发门控（`hp_below_activate`）“当前是否满足”的唯一判据（UI 用；非门控型返回 null）
    targetableBy: (ship, u) => !stealthBlocksTargeting(ship, u), // ★ 目标可选口径（唯一）：u 能否被 ship 选为主要攻击目标
    start,
    stop,
  };
}

export default createBattle;
