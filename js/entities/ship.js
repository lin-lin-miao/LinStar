/* ===== entities/ship.js —— 船实体（HP/护盾/能量/模块/系数） =====
 * ship.hull 内数值以浮点累计，显示层负责取整。
 *
 * ★ 护盾模型（用户定稿：独立池，仅 UI 统一显示）：
 *   船的护盾不再聚合成 hull.shield 单个标量来承伤，而是按“护盾来源”各自一池：
 *     ship.hull.pools: Map
 *       - 'base'（长期/本体池）：cap = baseShieldCap + 目标级叠加(base.capExtra，由战斗
 *         shield_cap_target 维护) + Σ(常驻/长期护盾模块并入量，如再生护盾)；value = 该长期池现值。
 *         —— 长期池在吸收时**最低优先级**（各时长护盾池用尽后才轮到它）。
 *       - inst.id（模块池）：每个“当前贡献护盾上限的**时长型**护盾模块”(duration_ticks>0，
 *         硬化/反射/同盟/防爆等，持续中)一个独立池；cap = shield_cap_bonus × 类别系数；
 *         value = 该模块当前护盾值；blastproof/alliance 标记取自 effects.type。
 *         —— 吸收顺序 = 激活顺序(_shieldSeq 先激活先使用)。
 *   hull.shield / hull.shieldCap 只是【派生汇总】= Σ 各池 value/cap（UI/策略/行动提示
 *   仍读这两个数，语义不变：显示总和）。每次池变化后由本文件 syncShieldSummary 刷新。
 *   池生命周期：
 *     - 安装(被动常驻模块)/激活(时长型模块) → 该模块池出现（新建池值为 0）；
 *     - 激活时长型大护盾 → fillModuleShieldPool 只把该模块自己的池补满；
 *     - 持续结束/停用/破盾/移除 → 该池整体消失（值丢弃），本体与其它模块池不受影响；
 *     - 满盾（战斗开场/召唤登场）→ fillShieldPools 把全部池补满。
 *
 * ★ 自身【常驻静态加成】词条：`hp_cap_bonus` / `energy_cap_bonus` / `energy_regen_bonus` /
 *   `cargo_cap_bonus` / `ore_cap_bonus` / `X_coeff_add`（如 `shield_coeff_add`）+ 既有 `shield_cap_bonus`。
 *   **无冷却/无持续/无耗能/不激活**——装上即生效、停用即失效，由**派生重算**落地（安装 / 启停时），
 *   不逐 tick 参与任何结算，故不破坏 Pass1 零数值变化。统一入口＝`syncSelfStatics`：
 *   · 三围上限与能量恢复 → `syncHullCaps`（基准 + Σ常驻 + Σ目标级叠加）；
 *   · 类别系数加性 → `syncStaticCoeffs`（写既有 `coeffMods`，由 `coeff()` 求和）；
 *   · 护盾容量 `shield_cap_bonus` → 既有护盾池本体池 `permanentBonus`（见 syncShieldPools）；
 *   · 货舱/矿物容量 `cargo_cap_bonus`/`ore_cap_bonus` → **按需读取口径** `cargoCapacityOf`/`oreCapacityOf`
 *     （本体容量 + Σ各来源×对应船级系数后取整；不缓存、不逐 tick，见下方“货舱/矿物容量”块）。
 *   上限提升**不补当前值**（只做 `min(当前, 上限)` 钳制），满血/满能量只在**登场**时由 `fillHullVitals` 给予。
 *
 * ★ 四套“乘性/系数”别混（详情见本文件 coeff() / damageTakeMul() / timeCoeffOf() / timeScaled() 的注释）：
 *   - `coeff(ship, category)`：**类别系数**（`(基础 + Σ加性) × Π乘性`，按 category 精确匹配）；
 *   - `damageTakeMul(ship)`：**受伤减免系数**（`ship.damageTakeMul`，缺省 1）——作用于**该单位受到的一切伤害**
 *     （血量/护盾），唯一结算点在 battle.js `applyHit` 入口；不分类别、不参与护盾池/非伤害量值。
 *   - `timeCoeffOf(ship)`：**时间系数**（`ship.timeCoeff`，缺省 0，多来源**加性求和**）——它**不改每 tick 推进量**
 *     （每 tick 恒推进 1 tick），而是**乘在“需求量”上**：`需求量 = timeScaled(基础量, 系数)`
 *     ＝`max(0, round(基础量 × (1 + 系数)))`。系数**为负＝加速**（需求变少、更快走完）、**为正＝放缓**
 *     （需求变多、更慢走完）。作用于模块持续/冷却、临时单位存在时间三类计时器（见 battle.js）。
 * ★ 另有一套**非数值**的结构状态（不走乘算、改“能不能被选中”）：
 *   `isStealthed(ship)`：**潜行**（`type` 标签 `stealth`，来源表 `ship.stealthMods`）——被标记单位
 *   **不能成为主要攻击目标**，但**仍受溅射**、**仍受既已锁定的目标约束**（详见下方 isStealthed 注释）。
 *
 * ★ 船型【等级系统】（与模块等级模型完全同构，唯一口径＝`data/ships/index.js resolveShipAtLevel`）：
 *   · 船型定义（`data/ships/<id>.js`）顶层字段＝**Lv1 基准值**，另有 `maxLevel` + `levels[]` **逐级绝对表**；
 *     某级未填的条目**回退上一级**（递归向上，最终以 Lv1 兜底）；可覆写**任意条目**
 *     （`base.*` / `coefficients.*` / `slots` / `nameKey` / `icon` …）。
 *   · **解析时机＝创建实例时解析一次**（`createShip(..., level)` → `resolveShipAtLevel`），
 *     解析结果即该实例的**基准值**（`ship.typeCfg`），此后所有派生（护盾池 cap、`hpMax/energyCap`、
 *     常驻加成 `syncSelfStatics` 等）**全部基于它** → 引擎与 UI 同口径、无第二套等级合并。
 *   · 实例字段：`ship.level`（默认 1）、`ship.slots`（该等级的槽位数）、`ship.typeCfg`（该等级的完整配置）。
 *   · 等级可在建单位后调整：`applyShipLevel(ship, level)`（重解析基准 + 重算派生；当前无 UI 调用）。
 */
import { SHIPS, resolveShipAtLevel } from '../data/ships.js';
import { uid } from '../core/utils.js';
import { createModuleInstance } from './module.js';

/** 该船对某模块类别的**有效系数** = （船型基础系数 + 该类别上的全部**加性修饰**）× 该类别上的全部**乘性修饰**
 *  （缺失类别基础按 1）。加性/乘性两表都按 category 精确匹配 → 只影响对应类别。
 *  ★ 唯一口径：战斗结算（battle.js `maybeActivate` 的伤害/效果量）、护盾池容量（modulePoolCapOf）
 *    与 UI 明细（battleView `perActText`）都必须走本函数，避免“两套口径”。 */
export function coeff(ship, category) {
  const mods = ship.coeffMods;
  const muls = ship.coeffMulMods;
  const hasAdd = mods instanceof Map && mods.size > 0;
  const hasMul = muls instanceof Map && muls.size > 0;
  if (!hasAdd && !hasMul) return ship.coefficients[category] ?? 1; // 零开销快路径
  return coeffParts(ship, category).value;
}

/** `coeff()` 的内部实现（同一个算式，供 `coeff()` 与 UI 分项展示共用，**不重复计算逻辑**）。 */
function coeffParts(ship, category) {
  const base = ship.coefficients[category] ?? 1;
  let add = 0;
  if (ship.coeffMods instanceof Map) {
    for (const m of ship.coeffMods.values()) if (m.category === category) add += m.add;
  }
  let mul = 1;
  if (ship.coeffMulMods instanceof Map) {
    for (const m of ship.coeffMulMods.values()) if (m.category === category) mul *= m.mul;
  }
  return { base, add, mul, value: (base + add) * mul };
}

/** **分项明细**（UI 系数栏用）：`{ base, add, mul, value }` ——
 *  `value` 与 `coeff()` 完全同源（同一次算式），故 UI 只需展示、**不得**在调用处重算。
 *  `add`＝该类别加性修饰合计（0 表示无），`mul`＝该类别乘性修饰连乘（1 表示无）。 */
export function coeffDetail(ship, category) {
  return coeffParts(ship, category);
}

/** 写入/覆盖一条**加性**类别系数修饰（来源 key 通常＝模块实例 id）。
 *  同一 key **覆盖式**写入（非累加）；不同 key 之间**叠加**（由 coeff() 求和）。
 *  与护盾池/时长逻辑完全无关：不参与 syncShieldPools，也不会被时长到期/破盾清掉。 */
export function setCoeffMod(ship, key, category, add) {
  if (!ship || !key || !category) return;
  if (!(ship.coeffMods instanceof Map)) ship.coeffMods = new Map();
  const cur = ship.coeffMods.get(key);
  if (cur && cur.category === category && cur.add === add) return; // 无变化
  ship.coeffMods.set(key, { category, add });
}

/** 撤销某来源（模块实例 id）的**加性**类别系数修饰 */
export function clearCoeffMod(ship, key) {
  if (ship && ship.coeffMods instanceof Map) ship.coeffMods.delete(key);
}

/** 写入/覆盖一条**乘性**类别系数修饰（来源 key 通常＝模块实例 id；`mul` 如 0.95 = ×0.95）。
 *  同一 key 覆盖式写入；不同 key 之间**相乘**（由 coeff() 连乘）。乘性表独立于加性表，互不覆盖。 */
export function setCoeffMulMod(ship, key, category, mul) {
  if (!ship || !key || !category) return;
  if (!(ship.coeffMulMods instanceof Map)) ship.coeffMulMods = new Map();
  const cur = ship.coeffMulMods.get(key);
  if (cur && cur.category === category && cur.mul === mul) return; // 无变化
  ship.coeffMulMods.set(key, { category, mul });
}

/** 撤销某来源（模块实例 id）的**乘性**类别系数修饰 */
export function clearCoeffMulMod(ship, key) {
  if (ship && ship.coeffMulMods instanceof Map) ship.coeffMulMods.delete(key);
}

/** 一次性撤销某来源的**全部**系数修饰（加性 + 乘性）：
 *  用在“时长到期 / 条件失效 / 模块停用 / 携带者阵亡 / 移出场景”等既有撤销路径上。 */
export function clearCoeffMods(ship, key) {
  clearCoeffMod(ship, key);
  clearCoeffMulMod(ship, key);
}

/* ---------- 受伤减免系数（`damage_coeff_mul` 系列词条 · 受击向）----------
 * ★ 与类别系数**不同**：受伤减免不区分类别，作用对象是“该单位**受到的**一切伤害”——
 *   主目标命中 / 爆炸波及 / 反射返程 / 负值扣血·削盾量值等，**所有来源**的伤害在落地时都乘它。
 *   **唯一结算点**：battle.js `applyHit(target, amount, …)` 的**入口**（在吸入护盾/舰体之前）：
 *   `amount * damageTakeMul(target)` —— 因此出伤侧无需逐点相乘。
 *   **豁免**：自毁 `self_destruct_damage`（自伤，走独立路径）、能量削减（`energy_target` 负值）、
 *   上限类 `*_cap_target`（控制效果，不是血/盾伤害）。
 *   `0.95` = 只承受 95% 伤害（即减免 5%）。
 *   结构：`ship.damageTakeMulMods: Map<来源key, mul>`（key＝模块实例 id，覆盖式；不同 key 之间**相乘**），
 *   `ship.damageTakeMul` 为其连乘结果（每次写入/撤销后由 refreshDamageTakeMul 重算，缺省 1）。
 *   不参与 `coeff()`（不影响护盾池容量、也不影响护盾/能量等非伤害量值）。 */
function refreshDamageTakeMul(ship) {
  let mul = 1;
  if (ship && ship.damageTakeMulMods instanceof Map) {
    for (const v of ship.damageTakeMulMods.values()) mul *= v;
  }
  if (ship) ship.damageTakeMul = mul;
  return mul;
}

/** 该单位当前的**受伤减免系数**（缺省 1；`applyHit` 入口必须乘它）——唯一口径，UI 明细同源。 */
export function damageTakeMul(ship) {
  if (!ship) return 1;
  return typeof ship.damageTakeMul === 'number' ? ship.damageTakeMul : 1;
}

/** 写入/覆盖一条受伤减免系数（来源 key 通常＝模块实例 id；`mul` 如 0.95 = 只承受 95%） */
export function setDamageTakeMulMod(ship, key, mul) {
  if (!ship || !key) return;
  if (!(ship.damageTakeMulMods instanceof Map)) ship.damageTakeMulMods = new Map();
  if (ship.damageTakeMulMods.get(key) === mul) return; // 无变化
  ship.damageTakeMulMods.set(key, mul);
  refreshDamageTakeMul(ship);
}

/** 撤销某来源的受伤减免系数 */
export function clearDamageTakeMulMod(ship, key) {
  if (ship && ship.damageTakeMulMods instanceof Map && ship.damageTakeMulMods.has(key)) {
    ship.damageTakeMulMods.delete(key);
    refreshDamageTakeMul(ship);
  }
}

/** 一次性撤销某来源的**全部**系数修饰 + 受伤减免 + 时间系数 + 潜行标记（撤销路径统一入口） */
export function clearAllSourceMods(ship, key) {
  clearCoeffMod(ship, key);
  clearCoeffMulMod(ship, key);
  clearDamageTakeMulMod(ship, key);
  clearTimeCoeffMod(ship, key);
  clearStealthMod(ship, key); // ★ 潜行（`type` 标签 `stealth`）：撤销该来源的“不可被选为主要目标”标记
}

/* ---------- 时间系数（`time_coeff` 词条 · 影响“需求量”）----------
 * ★ 语义（★ 不改每 tick 推进量：每 tick 恒推进 **1** tick）：
 *   该单位各类计时器的**需求量** = `timeScaled(基础量, 时间系数)` —— 即
 *   `需求量 = max(0, round(基础量 × (1 + 时间系数)))`，**取整数 tick**；
 *   计时器**剩余 = 需求量 − 已推进 tick 数**（见 battle.js，每 tick elapsed += 1）。
 *   · 系数 **为负＝加速**（如 `-0.1` → 需求量 ×0.9，更快走完）；
 *   · 系数 **为正＝放缓**（如 `+0.1` → 需求量 ×1.1，更慢走完）。
 *   作用于三类计时器（均在 battle.js）：模块**持续时间** `inst.durationLeft`、
 *   模块**冷却** `inst.cooldown`、临时单位**存在时间** `u.tempLeft`。
 * ★ **多来源组合＝加性求和**：`ship.timeCoeffMods: Map<来源key, 系数>`，派生值
 *   `ship.timeCoeff = 负向最强 + 正向最强`（缺省 0）——**正、负两向各取一个绝对值最大的来源后求和**：
 *   同向多来源**不叠加**（-0.1 与 -0.2 → -0.2），异向各取最强后相抵（-0.2 与 +0.1 → -0.1）。
 *   ★ **切换点**：组合规则只写在 `refreshTimeCoeff()` 内（见该函数内 `★ 组合规则` 注释）。
 *   撤销某个来源后按**剩余来源重新组合**。
 * ★ 与 `coeff()`/`damageTakeMul()` 都无关：不分类别、不影响伤害与护盾池，只改**计时器的需求量**。 */
function refreshTimeCoeff(ship) {
  let bestNeg = 0; // 负向（加速）中绝对值最大者
  let bestPos = 0; // 正向（放缓）中绝对值最大者
  if (ship && ship.timeCoeffMods instanceof Map) {
    // ★ 组合规则：**正、负两向各取一个「绝对值最大」的来源，然后把两者相加**
    //   （即同向多来源不叠加、只有最强的那一个生效；异向各取最强后相抵，如 -0.2 与 +0.1 → -0.1）
    for (const v of ship.timeCoeffMods.values()) {
      if (v < 0) { if (-v > -bestNeg) bestNeg = v; } else if (v > bestPos) bestPos = v;
    }
  }
  const sum = bestNeg + bestPos;
  if (ship) ship.timeCoeff = sum;
  return sum;
}

/** 该单位当前的**时间系数**（缺省 0；负＝加速、正＝放缓）——唯一口径：battle.js 计时需求量与 UI 系数栏同源。 */
export function timeCoeffOf(ship) {
  if (!ship) return 0;
  return typeof ship.timeCoeff === 'number' ? ship.timeCoeff : 0;
}

/** ★ **需求量整数化**（唯一口径）：`max(0, round(基础量 × (1 + 时间系数)))`，单位＝tick（整数）。
 *  `need`＝基础需求量（如 `duration_ticks`/`cooldown_ticks`/`lifespan_ticks`），`coeff`＝时间系数。
 *  battle.js 的三类计时器**全部**经本函数换算需求量，**不得各自硬编码**；每 tick 推进量恒为 1。
 *  下限 0（系数 ≤ -1 时需求量归 0 ＝“立即走完”），绝不出现负需求量。 */
export function timeScaled(need, coeff) {
  const n = Number(need) || 0;
  const c = Number(coeff) || 0;
  return Math.max(0, Math.round(n * (1 + c)));
}

/** 写入/覆盖一条时间系数来源（来源 key 通常＝模块实例 id；`coeff` 为负＝加速、为正＝放缓） */
export function setTimeCoeffMod(ship, key, coeff) {
  if (!ship || !key) return;
  if (!(ship.timeCoeffMods instanceof Map)) ship.timeCoeffMods = new Map();
  if (ship.timeCoeffMods.get(key) === coeff) return; // 无变化
  ship.timeCoeffMods.set(key, coeff);
  refreshTimeCoeff(ship);
}

/** 撤销某来源的时间系数（其余来源仍在 → 派生值按剩余来源重新组合） */
export function clearTimeCoeffMod(ship, key) {
  if (ship && ship.timeCoeffMods instanceof Map && ship.timeCoeffMods.has(key)) {
    ship.timeCoeffMods.delete(key);
    refreshTimeCoeff(ship);
  }
}

/** 本体池在 ship.hull.pools 中的固定 key */
export const BASE_POOL_KEY = 'base';

/* ---------- 潜行标记（`type` 标签 `stealth` · 目标选择向）----------
 * ★ 语义：被标记的单位**不能成为主要攻击目标**（其它单位的目标解析一律跳过它）；但
 *   · **仍会被 `blast_range` 溅射**波及（波及 / `applyHit` 侧不做任何潜行过滤或减免）；
 *   · **仍受“目标锁定”约束**：`lockTargetId`（一次性火箭/导弹弹体）与 `lock_target_on_activate`
 *     的锁定集合（激活瞬间已锁定的目标）照常有效 —— 潜行是“事后生效”，不推翻既有锁定；
 *   · **不影响友方/自身**：只挡“把对方当敌人打”，支援类模块解析到潜行单位（友军/自身）照常。
 * ★ 结构：`ship.stealthMods: Set<来源key>`（key 通常＝模块实例 id，多来源并存、去重）→
 *   派生 `ship.isStealth`（来源非空即潜行；撤销某来源后按剩余来源重算）。
 * ★ **唯一读口径**＝本文件的 `isStealthed(ship)`（battle.js 的目标解析与 UI 都只能读它）。
 * ★ 与 `coeff()` / `damageTakeMul()` / `timeCoeffOf()` 都无关：**不改任何数值**，只改“可被选为主要目标”
 *   这一**结构状态**；落地/撤销都在战斗结算阶段（`__pending.stealthOps` / 各既有撤销路径），
 *   与其它修饰同一套时序（下一 tick 起体现）。 */
function refreshStealth(ship) {
  const on = !!(ship && ship.stealthMods instanceof Set && ship.stealthMods.size > 0);
  if (ship) ship.isStealth = on;
  return on;
}

/** 该单位当前是否处于**潜行**（缺省 false）——唯一读口径：battle.js 目标解析与 UI 同源，UI 不得自算 */
export function isStealthed(ship) {
  if (!ship) return false;
  if (typeof ship.isStealth === 'boolean') return ship.isStealth;
  return refreshStealth(ship); // 派生值缺失（异常/老存档）→ 按来源表现算
}

/** 写入/覆盖一条**潜行**标记来源（来源 key 通常＝模块实例 id；重复写入幂等） */
export function setStealthMod(ship, key) {
  if (!ship || !key) return;
  if (!(ship.stealthMods instanceof Set)) ship.stealthMods = new Set();
  if (ship.stealthMods.has(key)) return; // 无变化
  ship.stealthMods.add(key);
  refreshStealth(ship);
}

/** 撤销某来源的**潜行**标记（其余来源仍在 → 仍处于潜行） */
export function clearStealthMod(ship, key) {
  if (ship && ship.stealthMods instanceof Set && ship.stealthMods.has(key)) {
    ship.stealthMods.delete(key);
    refreshStealth(ship);
  }
}

/** 模块当前是否“贡献护盾池容量”（与旧 shield_cap_bonusOf 同一判据）：
 *  启用；无时长或持续中；shield_cap_bonus>0。返回其 effects 引用；不贡献返回 null。 */
function contributingShieldFx(inst) {
  const fx = inst && inst.cfg && inst.cfg.effects;
  if (!fx || !inst.enabled) return null;
  if (inst._shieldSpent) return null; // 已耗尽(no_break 层被打空)：不再贡献独立池/并入 cap
  if ((fx.shield_cap_bonus || 0) <= 0) return null;
  if ((fx.duration_ticks || 0) > 0 && inst.durationLeft <= 0) return null; // 持续期外不生效
  return fx;
}

/** 某模块池容量 = shield_cap_bonus × 类别系数（与旧叠层量一致） */
export function modulePoolCapOf(ship, inst) {
  const fx = inst && inst.cfg && inst.cfg.effects;
  return ((fx && fx.shield_cap_bonus) || 0) * coeff(ship, inst.cfg.category);
}

/* ---------- 自身【常驻静态加成】词条（增幅器类）----------
 * 词条（一律**无 `_target` 后缀** = 硬作用于模块所属自身，命名铁律同 `shield_cap_bonus`）：
 *   · `hp_cap_bonus`        —— 自身**血量上限**加成
 *   · `energy_cap_bonus`    —— 自身**能量上限**加成（**可取负值**＝常驻削减上限）
 *   · `energy_regen_bonus`  —— 自身**能量恢复**加成（单位：每秒，与 `base.energyRegen` 同口径）
 *   · `X_coeff_add`（如 `shield_coeff_add`）—— 自身**类别系数加性**加成（X＝类别名，见 syncStaticCoeffs）
 *   · `shield_cap_bonus`    —— 自身**护盾容量**加成（既有词条，由本文件护盾池体系承载：
 *                              无 `duration_ticks` → 并入【本体池】permanentBonus，见 syncShieldPools）
 * ★ 常驻判据（与护盾池的 permanentBonus 分支**完全同源**）：模块**启用中** 且 **无 `duration_ticks`**。
 *   带 `duration_ticks` 的模块不走本路径（时长型由“激活/到期撤销”的既有机制承载）——
 *   故本词条在数据里**不得**与 `duration_ticks` 搭配使用。
 * ★ 数值一律乘**模块类别系数** `coeff(ship, inst.cfg.category)`——与 `modulePoolCapOf` 同一口径
 *   （★ 例外：`X_coeff_add` 本身就是往 `coeff()` 里加项，故**不再乘自身类别系数**）。
 * ★ 落地时机：**只在“结构变化”时重算**（建单位 / 安装 / 启停），由 `syncSelfStatics` 统一落地；
 *   属**派生重算**，不逐 tick 执行、不产生任何逐 tick 数值变化（Pass1 零数值变化铁律）。 */

/** **自身常驻静态加成合计**（唯一口径）：Σ(启用中 且 无 `duration_ticks` 的模块的该词条 × 其系数)。
 *  `key` 取自身常驻词条之一（`hp_cap_bonus` / `energy_cap_bonus` / `energy_regen_bonus` /
 *  `cargo_cap_bonus` / `ore_cap_bonus` …）。
 *  `coeffCategory` 可选：**指定用哪个类别系数缩放**（缺省 ＝ 模块自身类别 `inst.cfg.category`）。
 *  货舱/矿物容量用**对应船级系数**（`transport` / `mining`）而非模块自身类别系数，见 `cargoCapPartsOf`。
 *  ★ **每个来源分别乘系数后再求和**（不是先求和再乘；单船只有一个系数故二者数学等价，此处按逐来源写法）。
 *  仅作“派生重算/按需读取”的取值来源，不写任何数值；战斗层的目标级 cap 叠加（capOverlays）在调用处另行传入。 */
export function selfStaticBonus(ship, key, coeffCategory = null) {
  if (!ship || !Array.isArray(ship.modules)) return 0;
  let sum = 0;
  for (const inst of ship.modules) {
    if (!inst || !inst.enabled) continue; // 停用不生效（与护盾池 contributingShieldFx 同判据）
    const fx = inst.cfg && inst.cfg.effects;
    if (!fx) continue;
    const v = fx[key] || 0;
    if (!v) continue;
    if ((fx.duration_ticks || 0) > 0) continue; // 时长型不属常驻（由激活/到期撤销机制承载）
    sum += v * coeff(ship, coeffCategory || inst.cfg.category);
  }
  return sum;
}

/** ★ **三围上限 / 能量恢复的唯一落地口径**：
 *     hpMax       = baseHpMax        + Σ自身常驻(`hp_cap_bonus`)        + 目标级叠加 overlayHp
 *     energyCap   = baseEnergyCap    + Σ自身常驻(`energy_cap_bonus`)    + 目标级叠加 overlayEnergy
 *     energyRegen = baseEnergyRegen  + Σ自身常驻(`energy_regen_bonus`)
 *  · **每次从各自基准重算**（与 battle.js `recomputeCap` 的“非累加”语义一致）：撤销旧来源后
 *    新施加不会叠在旧值上；
 *  · 目标级叠加（上限类 `*_cap_target`，如电磁脉冲）由**调用方传入聚合值**，本函数不持有其来源状态
 *    —— 与 `ensureBasePool(ship, permanentBonus)` 同一分工方式；
 *  · 只改“上限”，当前值**只做钳制**（`hp = min(hp, hpMax)`、`energy = min(energy, energyCap)`），
 *    **绝不补齐**：与护盾池“只加容量、不白送盾量”（`pool.value = min(value, cap)`）**同一口径**；
 *    满血/满能量只在**登场**时由 `fillHullVitals` 统一给予。 */
export function syncHullCaps(ship, overlayHp = 0, overlayEnergy = 0) {
  const h = ship && ship.hull;
  if (!h) return ship;
  const selfHp = selfStaticBonus(ship, 'hp_cap_bonus');
  const selfEn = selfStaticBonus(ship, 'energy_cap_bonus');
  const selfRg = selfStaticBonus(ship, 'energy_regen_bonus');
  h.hpMax = Math.max(1, (h.baseHpMax || 0) + selfHp + (overlayHp || 0));
  h.energyCap = Math.max(0, (h.baseEnergyCap || 0) + selfEn + (overlayEnergy || 0));
  ship.energyRegenPerSec = Math.max(0, (ship.baseEnergyRegen || 0) + selfRg);
  h.hp = Math.min(h.hp, h.hpMax);
  h.energy = Math.min(h.energy, h.energyCap);
  return ship;
}

/** 满血 + 满能量：登场时令当前值 = 上限（与 `fillShieldPools` 满盾**同体例**）。
 *  ★ 仅“登场（开战布阵 / 召唤）”调用 —— 安装模块、上限变化时**不**补当前值（见 syncHullCaps 注释）。 */
export function fillHullVitals(ship) {
  const h = ship && ship.hull;
  if (!h) return ship;
  h.hp = h.hpMax;
  h.energy = h.energyCap;
  return ship;
}

/** `type` 标签判定（与 `battle.js isType` **同一口径**：`type` 必须是**数组**） */
function fxHasTag(fx, tag) {
  return Array.isArray(fx && fx.type) && fx.type.includes(tag);
}

/** 常驻自身【类别系数加性】词条（`X_coeff_add`，**无 `_target` 后缀**＝作用于自身）的唯一落地口径。
 *  对每个 **启用中 且 无 `duration_ticks` 且 未标 `solo`** 的模块：把其 `X_coeff_add` 写入
 *  `ship.coeffMods`（来源 key ＝ 模块实例 id），由既有 `coeff()` 求和（多来源叠加、同 key 覆盖式）——
 *  与结算阶段 `applyCoeffOp` **同一张表、同一撤销入口** `clearAllSourceMods(单位, inst.id)`。
 *  词条 → 类别由**词条名**直接给出（`shield_coeff_add` → `shield`，`attack_coeff_add` → `attack`…），
 *  无需另建映射表；`X_coeff_add_target`（目标级）不属本路径。
 *  ★ 与既有 `attack_coeff_add` 的条件型（`solo`）路径的区别：条件型由结算阶段**逐 tick** 写入/撤销
 *    **同一张表**（如「单枪匹马」按友军数量决定是否生效），故此处**必须排除 `solo` 模块**——否则会把
 *    条件增益无条件写死（回归）。
 *  ★ 撤销：停用/阵亡/移出场景走既有 `clearAllSourceMods`；本函数只做“该生效就写”（幂等），**不清理**
 *    （避免误删条件型路径写入的同 key 记录）。
 *  ★ `shield` 类别参与模块护盾池容量（`modulePoolCapOf` → `coeff(ship,'shield')`）→ 系数真变化后
 *    同步 `recalcDerived`（与 `applyCoeffOp` 同一条重算路径）；无变化不重算。
 *  ★ 只在“结构变化”（安装/启停）时调用：**不逐 tick 写值**（Pass1 零数值变化铁律）。 */
const COEFF_ADD_SUFFIX = '_coeff_add';
export function syncStaticCoeffs(ship) {
  if (!ship || !Array.isArray(ship.modules)) return ship;
  const before = coeff(ship, 'shield');
  for (const inst of ship.modules) {
    if (!inst || !inst.cfg) continue;
    const fx = inst.cfg.effects;
    if (!fx) continue;
    if (!inst.enabled) continue; // 停用不生效
    if ((fx.duration_ticks || 0) > 0) continue; // 时长型由“激活/到期撤销”承载，非常驻
    if (fxHasTag(fx, 'solo')) continue; // 条件型：由结算阶段 coeffOps 承载（同一张表）
    for (const k of Object.keys(fx)) {
      if (!k.endsWith(COEFF_ADD_SUFFIX)) continue;
      if (k.endsWith(`_target${COEFF_ADD_SUFFIX}`)) continue; // 目标级词条（带 `_target`）走另一条路径
      const add = fx[k] || 0;
      if (!add) continue;
      setCoeffMod(ship, inst.id, k.slice(0, -COEFF_ADD_SUFFIX.length), add);
    }
  }
  if (coeff(ship, 'shield') !== before) recalcDerived(ship); // 护盾池容量随护盾系数变化
  return ship;
}

/** ★ 自身【常驻静态加成】的**统一落地入口**（唯一口径）：
 *    ① 类别系数加性 `X_coeff_add`            → `syncStaticCoeffs`（写 `coeffMods`）
 *    ② 三围上限 / 能量恢复（`hp_cap_bonus` / `energy_cap_bonus` / `energy_regen_bonus`）→ `syncHullCaps`
 *  （护盾容量 `shield_cap_bonus` 仍由既有护盾池路径 `syncShieldPools`/`permanentBonus` 承载。）
 *  调用点（全是“结构变化”，**不逐 tick**）：`installModule`（装上即生效）、战斗内启停
 *  （`battle.js recomputeCap`，其 `overlayHp/overlayEnergy`＝该单位**目标级 cap 叠加**的聚合值，如电磁脉冲）。
 *  非累加：每次从各自基准重算。 */
export function syncSelfStatics(ship, overlayHp = 0, overlayEnergy = 0) {
  syncStaticCoeffs(ship);
  syncHullCaps(ship, overlayHp, overlayEnergy);
  return ship;
}

/* ---------- 货舱 / 矿物容量（自身常驻词条 `cargo_cap_bonus` / `ore_cap_bonus`）----------
 * ★ **唯一口径（引擎与 UI 同源，UI 不得自算）**：
 *     总量 = **本体容量**（船型 `base.cargoCap` / `base.oreCap`，**不受系数影响、直接相加**）
 *          + Σ(模块 `*_cap_bonus` **各来源分别 × 对应类别系数** 再求和)
 *   · 货物 → `coeff(ship,'transport')`（运输系数）；矿物 → `coeff(ship,'mining')`（采矿系数）；
 *   · 常驻判据与 `hp_cap_bonus`/`energy_cap_bonus` **完全同源**（走 `selfStaticBonus`：模块**启用中**
 *     且 **无 `duration_ticks`** → 生效；装/拆/启停即变，**不逐 tick**）；
 *   · 最后 **`Math.round` 取整** 得到总量（本体为整数占位值 → `base + modules === total`）。
 * ★ 本体容量的落地：`createShip` 把等级解析后的 `type.base.cargoCap/oreCap` 写到实例
 *   `ship.baseCargoCap/baseOreCap`（`applyShipLevel` 重解析时一并更新）→ 与船型等级同口径，
 *   `base.*` 可被 `levels[]` 逐级覆写。
 * ★ **按需计算、不缓存**（与 `modulePoolCapOf` 的护盾池 cap 同一体例）：结构变化（装拆/启停）与
 *   系数变化（结算阶段落地的系数修饰）都**即时**反映，且**不逐 tick 写任何数值**
 *   → 不破坏 Pass1 零数值变化铁律。分解值供 UI 展示：`{ base, modules, raw, total }`。 */
const CARGO_KEY = 'cargo_cap_bonus';
const ORE_KEY = 'ore_cap_bonus';
/** 容量分解（内部共用实现，避免货物/矿物各写一遍算式） */
function capPartsOf(ship, key, coeffCategory, baseField) {
  const base = Math.round((ship && ship[baseField]) || 0); // 本体容量：不受系数影响
  const raw = selfStaticBonus(ship, key, coeffCategory);   // Σ(各来源 × 对应类别系数)
  return { base, modules: Math.round(raw), raw, total: Math.round(base + raw) };
}
/** **货物容量**（唯一口径，取整后总量） */
export function cargoCapacityOf(ship) {
  return cargoCapPartsOf(ship).total;
}
/** **矿物容量**（唯一口径，取整后总量） */
export function oreCapacityOf(ship) {
  return oreCapPartsOf(ship).total;
}
/** 货物容量分解：`{ base（本体）, modules（模块部分，取整）, raw（未取整）, total（取整总量） }` */
export function cargoCapPartsOf(ship) {
  return capPartsOf(ship, CARGO_KEY, 'transport', 'baseCargoCap');
}
/** 矿物容量分解：`{ base, modules, raw, total }`（同 `cargoCapPartsOf`） */
export function oreCapPartsOf(ship) {
  return capPartsOf(ship, ORE_KEY, 'mining', 'baseOreCap');
}
/** 当前**已装载货物量**的唯一读口径（M4 资源系统前恒为 0；UI 显示「已用 / 上限」用）。
 *  `hull.cargo` 由后续资源系统写入，本函数只读、不写。 */
export function cargoLoadOf(ship) {
  return Math.max(0, (ship && ship.hull && ship.hull.cargo) || 0);
}
/** 当前**已装载矿物量**的唯一读口径（同 `cargoLoadOf`） */
export function oreLoadOf(ship) {
  return Math.max(0, (ship && ship.hull && ship.hull.ore) || 0);
}

/** 依 effects.type 刷新池的语义标记：blastproof=防爆池、alliance=同盟(共享)池 */
function markPoolFlags(pool, fx) {
  const t = Array.isArray(fx.type) ? fx.type : [];
  pool.blastproof = t.includes('blastproof');
  pool.alliance = t.includes('alliance');
}

/** 确保本体池存在并按其 cap 归位：
 *  cap = baseShieldCap + capExtra(目标级叠加) + permanentBonus(常驻/长期护盾模块并入量)。
 *  capExtra / permanentBonus 由调用方给出，此处不持有其来源状态。 */
function ensureBasePool(ship, permanentBonus) {
  const pools = ship.hull.pools;
  let b = pools.get(BASE_POOL_KEY);
  if (!b) {
    b = {
      key: BASE_POOL_KEY,
      inst: null,
      cap: 0,
      value: 0,
      capExtra: 0,
      blastproof: false,
      alliance: false,
    };
    pools.set(BASE_POOL_KEY, b);
  }
  b.cap = Math.max(0, ship.hull.baseShieldCap + (b.capExtra || 0) + (permanentBonus || 0));
  b.value = Math.min(b.value, b.cap); // cap 缩水（如负叠加/持续结束/停用常驻模块）时钳制
  return b;
}

/** 仅重算派生汇总：hull.shield = Σ 池 value、hull.shieldCap = Σ 池 cap。
 *  承伤/补盾只改池值，不直接写这两个标量；任何池值变化后都应调用本函数刷新。 */
export function syncShieldSummary(ship) {
  if (!ship.hull || !(ship.hull.pools instanceof Map)) return ship;
  let v = 0;
  let c = 0;
  for (const p of ship.hull.pools.values()) {
    v += p.value;
    c += p.cap;
  }
  ship.hull.shield = v;
  ship.hull.shieldCap = c;
  return ship;
}

/** 护盾池全量同步（在“贡献成员/容量”可能变化时调用）：
 *  - 本体池 = baseShieldCap + capExtra + Σ(常驻/长期护盾模块 cap)；
 *    “长期/常驻”模块：无 duration_ticks 的护盾模块(如再生护盾)并入本体长期池，不单独成池；
 *  - “时长型”护盾模块(duration_ticks>0，如 硬化/反射/同盟/防爆) 各一个独立池；
 *    持续结束/停用/破盾/移除 → 该池整体删除（值丢弃），本体与其它模块池不受影响；
 *  - 已存在池保留其当前值（新建池值为 0，即“只加容量、不白送盾量”），容量按现时重算；
 *  - 最后刷新派生汇总。 */
function syncShieldPools(ship) {
  if (!ship.hull || !(ship.hull.pools instanceof Map)) return;
  const pools = ship.hull.pools;
  const keep = new Set([BASE_POOL_KEY]);
  let permanentBonus = 0;
  for (const inst of ship.modules) {
    const fx = contributingShieldFx(inst);
    if (!fx) continue;
    if ((fx.duration_ticks || 0) > 0) {
      // 时长型护盾 → 独立池（按激活顺序使用；后续在战斗层按 inst._shieldSeq 排序）
      keep.add(inst.id);
      let p = pools.get(inst.id);
      if (!p) {
        p = {
          key: inst.id,
          inst,
          cap: 0,
          value: 0,
          capExtra: 0,
          blastproof: false,
          alliance: false,
        };
        pools.set(inst.id, p);
      }
      p.cap = modulePoolCapOf(ship, inst);
      p.value = Math.min(p.value, p.cap); // cap 变化时钳制
      markPoolFlags(p, fx);
    } else {
      // 常驻/长期护盾模块（如再生护盾）→ 并入本体长期池（无独立池；cap 记入本体池）
      permanentBonus += modulePoolCapOf(ship, inst);
    }
  }
  ensureBasePool(ship, permanentBonus);
  for (const key of [...pools.keys()]) {
    if (!keep.has(key)) pools.delete(key);
  }
  syncShieldSummary(ship);
}

/** 重算派生值（启停/持续期/破盾/安装等“贡献成员变化”后调用）：
 *  按来源维护护盾池并刷新汇总：shieldCap = Σ 池 cap = baseShieldCap(+目标级叠加) +
 *  Σ(贡献模块 cap×系数)；hull.shield = Σ 池 value（各池已各自钳制，总和不越总上限）。 */
export function recalcDerived(ship) {
  syncShieldPools(ship);
  return ship;
}

/** 取本体池（不存在则按空池创建，供战斗层写 capExtra 用） */
export function baseShieldPoolOf(ship) {
  if (!ship.hull || !(ship.hull.pools instanceof Map)) return null;
  return ensureBasePool(ship);
}

/** 满盾：把【所有】护盾池补满到各自 cap（本体 + 各贡献模块池），随后刷新汇总。
 *  战斗开场 / 召唤登场时用，等价旧“hull.shield = shieldCap”。 */
export function fillShieldPools(ship) {
  if (!ship.hull || !(ship.hull.pools instanceof Map)) return ship;
  for (const p of ship.hull.pools.values()) p.value = p.cap;
  syncShieldSummary(ship);
  return ship;
}

/** 只把【某模块自己的池】补满到其 cap（激活时长型大护盾时用）；
 *  本体 / 其它模块池保持当前值不变，随后刷新汇总。 */
export function fillModuleShieldPool(ship, inst) {
  const p = inst && ship.hull && ship.hull.pools && ship.hull.pools.get(inst.id);
  if (!p) return ship;
  p.value = p.cap;
  syncShieldSummary(ship);
  return ship;
}

/** 读某模块当前的池对象（无池=null） */
export function moduleShieldPoolOf(ship, inst) {
  if (!ship.hull || !(ship.hull.pools instanceof Map)) return null;
  return ship.hull.pools.get(inst.id) || null;
}

/** 船型解析（**等级唯一口径**）+ 全条目覆写 → 该实例的**基准配置**。
 *  · 等级解析：`data/ships/index.js resolveShipAtLevel(def, level)`（未填字段回退上一级、可覆写任意条目）；
 *  · `overrides`（召唤模块的 `effects.summon.attrs`）**优先级最高**：在**解析后**的等级配置上再做全条目覆写
 *    → 召唤物“种类差异”永远压过模板与等级（既有行为不变：drone 走 Lv1 + attrs 覆写）；
 *  · `base` / `coefficients` 做深合并（缺省沿用），其余条目直接覆盖（与拆分前体例一致）。 */
function buildTypeCfg(typeId, level, overrides) {
  const def = SHIPS[typeId];
  if (!def) throw new Error(`未知船型: ${typeId}`);
  const tmpl = resolveShipAtLevel(def, level); // 该等级的完整配置（返回新对象，不改原定义）
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  return {
    ...tmpl,
    ...ov,
    base: Object.assign({}, tmpl.base, ov.base),
    coefficients: Object.assign({}, tmpl.coefficients, ov.coefficients),
  };
}

/** 创建一艘船（模块槽初始为空）。
 * overrides 可选：在船型模板上做"全条目"覆写（结构与 `data/ships/<id>.js` 单船一致，如 nameKey / slots /
 * base{hp,shieldCap,energyCap,energyRegen} / coefficients{...}），缺省的条目沿用模板。
 * 用于召唤模块给通用无人机模板设定具体种类；常规造舰不传即可。
 * level 可选：船型等级（默认 1）——建单位时按 `resolveShipAtLevel` 解析一次作为**实例基准值**，
 * 之后所有派生（护盾池/常驻加成/三围上限）都基于它（详见文件头“船型等级系统”）。 */
export function createShip(typeId, side = 'ally', overrides = null, level = 1) {
  const lv = Math.max(1, level | 0);
  const type = buildTypeCfg(typeId, lv, overrides);
  const ship = {
    id: uid('ship'),
    side,
    typeId,
    level: lv,                // ★ 船型等级（默认 1）：引擎按实例等级结算（基准值已在下方落地）
    slots: type.slots,        // ★ 该等级的模块槽位数（安装校验/UI 槽位渲染读它，勿直接读 SHIPS[typeId].slots）
    typeCfg: type,            // ★ 该实例的**基准配置**（等级解析 + attrs 覆写后的完整船型条目）
    typeOverrides: overrides && typeof overrides === 'object' ? overrides : null, // 供 applyShipLevel 重解析
    // ★ 单位定位（'combat' 战斗单位 / 'logistics' 后勤单位）：船型默认值（`data/ships/<id>.js` 的 `role`）
    //   可被**编队条目 / 召唤 attrs** 的 `role` 覆写（经上面的 overrides 全条目覆写）→ 本字段即**唯一口径**，
    //   UI 只读它决定把该单位显示在【战斗单位栏】还是【后勤单位栏】；战斗层不使用该字段（不影响战斗行为）。
    role: type.role || 'combat',
    nameKey: type.nameKey,
    coefficients: Object.assign({}, type.coefficients),
    coeffMods: new Map(),    // 类别系数**加性**修饰（来源 key → {category, add}）；由 coeff() 求和
    coeffMulMods: new Map(), // 类别系数**乘性**修饰（来源 key → {category, mul}）；由 coeff() 连乘
    damageTakeMulMods: new Map(), // **受伤减免**修饰（来源 key → mul，不分类别）；damageTakeMul = 各来源连乘
    damageTakeMul: 1,             // 受伤减免系数（缺省 1）：该单位受到的伤害统一乘它（自毁/能量削减除外）
    timeCoeffMods: new Map(),     // **时间系数**来源表（来源 key → 系数，负=加速/正=放缓）；timeCoeff = 各来源**加性求和**
    timeCoeff: 0,                 // 时间系数（缺省 0）：计时器需求量 = timeScaled(基础量, 它)（见 timeScaled）
    stealthMods: new Set(),       // **潜行**标记来源表（来源 key → 潜行；isStealth = 来源非空）
    isStealth: false,             // 是否潜行（缺省 false）：潜行单位**不能成为主要攻击目标**（仍受溅射 / 仍受锁定影响）
    modules: [],
    hull: {
      hp: type.base.hp,
      hpMax: type.base.hp,
      baseHpMax: type.base.hp,
      shield: 0,               // 派生汇总：Σ 各护盾池 value（不直接承伤）
      shieldCap: type.base.shieldCap, // 派生汇总：Σ 各护盾池 cap
      baseShieldCap: type.base.shieldCap,
      energy: type.base.energyCap,
      energyCap: type.base.energyCap,
      baseEnergyCap: type.base.energyCap,
      pools: new Map(),        // ★ 独立护盾池（key='base' 或 模块实例 id）
    },
    energyRegenPerSec: type.base.energyRegen,
    baseEnergyRegen: type.base.energyRegen, // 基准能量恢复/秒（`syncHullCaps` 据此非累加重算 energyRegenPerSec）
    // ★ 货舱容量基准（本体，**不受系数影响**；唯一口径 `cargoCapacityOf`/`oreCapacityOf`，按需读取不缓存）
    baseCargoCap: Math.max(0, type.base.cargoCap || 0),
    baseOreCap: Math.max(0, type.base.oreCap || 0),
    targetId: null, // 玩家指定的主要攻击目标（unit id）；null=自动(最近)
    alive: true,
  };
  recalcDerived(ship); // 建本体池（值 0、cap=baseShieldCap）并刷新汇总
  return ship;
}

/** 安装模块（槽位不足抛错，除非 force=true 忽略槽位上限）；返回模块实例 */
export function installModule(ship, moduleId, level = 1, force = false) {
  // ★ 槽位数取**实例的等级解析结果**（`ship.slots`，由 createShip/applyShipLevel 落地）；
  //   旧实例（或未带该字段的调用方）回退到该船型 Lv1 定义，保持既有行为不变。
  const slots = ship.slots != null ? ship.slots : (SHIPS[ship.typeId] || {}).slots;
  if (!force && ship.modules.length >= slots) throw new Error('模块槽位已满');
  const inst = createModuleInstance(moduleId, level);
  ship.modules.push(inst);
  recalcDerived(ship); // 常驻模块池出现（值为 0；时长型不在持续期则无池）
  // ★ 自身常驻静态加成（增幅器类：血量/能量上限、能量恢复、类别系数加性）**装上即生效**：
  //   走派生重算（非“激活-触发”流程、无冷却/耗能/持续期），与护盾池 permanentBonus 同属“安装即计入”。
  //   安装只可能发生在“新单位建好/布阵”时（战斗中的召唤单位均为新单位、无目标级 cap 叠加），
  //   故此处不需要（也无权访问）战斗层的 capOverlays；战斗内启停模块走 battle.js 的 recomputeCap。
  syncSelfStatics(ship);
  return inst;
}

/** 重设船型等级（**等级可在建单位后调整**；当前无 UI 调用，供后续“升级舰船”功能接入）。
 *  · 重新走唯一口径 `buildTypeCfg`（等级解析 + 该实例原有的 `attrs` 覆写）；
 *  · 基准值（`baseHpMax` / `baseShieldCap` / `baseEnergyCap` / `baseEnergyRegen`）随之更新，
 *    再由 `syncSelfStatics` 按“基准 + Σ自身常驻”**非累加**重算上限与能量恢复（当前值**只钳制不补齐**，
 *    与安装/启停同一口径），最后 `recalcDerived` 重算护盾池（cap 变化 → 池值由 ensureBasePool 钳制）。
 *  · 已装模块实例不受影响（等级是船型基准，不是模块等级）。 */
export function applyShipLevel(ship, level) {
  if (!ship || !SHIPS[ship.typeId]) return ship;
  const lv = Math.max(1, level | 0);
  const type = buildTypeCfg(ship.typeId, lv, ship.typeOverrides || null);
  ship.level = lv;
  ship.slots = type.slots;
  ship.typeCfg = type;
  ship.role = type.role || 'combat'; // 定位随等级解析一并更新（船型可逐级覆写 role）
  ship.nameKey = type.nameKey;
  ship.coefficients = Object.assign({}, type.coefficients);
  const h = ship.hull;
  if (h) {
    h.baseHpMax = type.base.hp;
    h.baseShieldCap = type.base.shieldCap;
    h.baseEnergyCap = type.base.energyCap;
  }
  ship.baseEnergyRegen = type.base.energyRegen;
  // 货舱容量基准随等级解析一并更新（唯一口径 `cargoCapacityOf`/`oreCapacityOf` 按需读取）
  ship.baseCargoCap = Math.max(0, type.base.cargoCap || 0);
  ship.baseOreCap = Math.max(0, type.base.oreCap || 0);
  syncSelfStatics(ship); // hpMax/energyCap/energyRegenPerSec：基准 + Σ自身常驻（非累加，只钳制）
  recalcDerived(ship);   // 护盾池按新基准重算
  return ship;
}

export default createShip;
