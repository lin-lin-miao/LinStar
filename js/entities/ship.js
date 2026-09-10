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
 * ★ 三套“乘性/加速”别混（详情见本文件 coeff() / damageTakeMul() / hastenTicksOf() 的注释）：
 *   - `coeff(ship, category)`：**类别系数**（`(基础 + Σ加性) × Π乘性`，按 category 精确匹配）；
 *   - `damageTakeMul(ship)`：**受伤减免系数**（`ship.damageTakeMul`，缺省 1）——作用于**该单位受到的一切伤害**
 *     （血量/护盾），唯一结算点在 battle.js `applyHit` 入口；不分类别、不参与护盾池/非伤害量值。
 *   - `hastenTicksOf(ship)`：**时间加速**（`ship.hastenTicks`，缺省 0，多来源**取最大值**）——把该单位
 *     每 tick 的计时推进量变为 `1 + 它`（模块持续/冷却、临时单位存在时间）。
 */
import { SHIPS } from '../data/ships.js';
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

/** 一次性撤销某来源的**全部**系数修饰 + 受伤减免 + 时间加速（撤销路径统一入口） */
export function clearAllSourceMods(ship, key) {
  clearCoeffMod(ship, key);
  clearCoeffMulMod(ship, key);
  clearDamageTakeMulMod(ship, key);
  clearHastenMod(ship, key);
}

/* ---------- 时间加速（`hasten_ticks` 词条 · 多来源**取最大值**，非叠加）----------
 * ★ 语义：该单位的**计时器推进量** = `1 + hastenTicks(ship)` —— 即每 tick 额外多推进 `hastenTicks` tick，
 *   作用于三处**递减**（均见 battle.js）：
 *     · 模块**持续时间** `inst.durationLeft`；· 模块**冷却** `inst.cooldown`；· 临时单位**存在时间** `u.tempLeft`。
 *   ★ **多来源不叠加、仅取最大值**：`ship.hastenMods: Map<来源key, ticks>`，派生值
 *   `ship.hastenTicks = max(各来源值)`（缺省 0）——与“加性叠加 / 乘性连乘”两类系数修饰表**刻意区分**
 *   （防止两个加速模块叠成 4×/8×）。撤销某个来源后按**剩余来源重新取 max**。
 *   ★ 与 `coeff()`/`damageTakeMul()` 都无关：不分类别、不影响伤害与护盾池。 */
function refreshHastenTicks(ship) {
  let max = 0;
  if (ship && ship.hastenMods instanceof Map) {
    for (const v of ship.hastenMods.values()) if (v > max) max = v;
  }
  if (ship) ship.hastenTicks = max;
  return max;
}

/** 该单位当前的**时间加速 tick 数**（缺省 0）——唯一口径：battle.js 计时推进与 UI 系数栏同源。 */
export function hastenTicksOf(ship) {
  if (!ship) return 0;
  return typeof ship.hastenTicks === 'number' ? ship.hastenTicks : 0;
}

/** 写入/覆盖一条时间加速来源（来源 key 通常＝模块实例 id；`ticks` 为额外推进的 tick 数） */
export function setHastenMod(ship, key, ticks) {
  if (!ship || !key) return;
  if (!(ship.hastenMods instanceof Map)) ship.hastenMods = new Map();
  if (ship.hastenMods.get(key) === ticks) return; // 无变化
  ship.hastenMods.set(key, ticks);
  refreshHastenTicks(ship);
}

/** 撤销某来源的时间加速（其余来源仍在 → 派生值按剩余来源重新取 max） */
export function clearHastenMod(ship, key) {
  if (ship && ship.hastenMods instanceof Map && ship.hastenMods.has(key)) {
    ship.hastenMods.delete(key);
    refreshHastenTicks(ship);
  }
}

/** 本体池在 ship.hull.pools 中的固定 key */
export const BASE_POOL_KEY = 'base';

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

/** 创建一艘船（模块槽初始为空）。
 * overrides 可选：在船型模板上做"全条目"覆写（结构与 data/ships.js 单船一致，如 nameKey / slots /
 * base{hp,shieldCap,energyCap,energyRegen} / coefficients{...}），缺省的条目沿用模板。
 * 用于召唤模块给通用无人机模板设定具体种类；常规造舰不传即可。 */
export function createShip(typeId, side = 'ally', overrides = null) {
  const tmpl = SHIPS[typeId];
  if (!tmpl) throw new Error(`未知船型: ${typeId}`);
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  // 模板 + 全条目覆写（base/coefficients 做深合并，缺省用模板）
  const type = {
    ...tmpl,
    ...ov,
    base: Object.assign({}, tmpl.base, ov.base),
    coefficients: Object.assign({}, tmpl.coefficients, ov.coefficients),
  };
  const ship = {
    id: uid('ship'),
    side,
    typeId,
    nameKey: type.nameKey,
    coefficients: Object.assign({}, type.coefficients),
    coeffMods: new Map(),    // 类别系数**加性**修饰（来源 key → {category, add}）；由 coeff() 求和
    coeffMulMods: new Map(), // 类别系数**乘性**修饰（来源 key → {category, mul}）；由 coeff() 连乘
    damageTakeMulMods: new Map(), // **受伤减免**修饰（来源 key → mul，不分类别）；damageTakeMul = 各来源连乘
    damageTakeMul: 1,             // 受伤减免系数（缺省 1）：该单位受到的伤害统一乘它（自毁/能量削减除外）
    hastenMods: new Map(),        // **时间加速**来源表（来源 key → 额外推进 tick 数）；hastenTicks = 各来源**最大值**
    hastenTicks: 0,               // 时间加速（缺省 0）：计时推进量 = 1 + 它（持续/冷却/临时存在时间）
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
    targetId: null, // 玩家指定的主要攻击目标（unit id）；null=自动(最近)
    alive: true,
  };
  recalcDerived(ship); // 建本体池（值 0、cap=baseShieldCap）并刷新汇总
  return ship;
}

/** 安装模块（槽位不足抛错，除非 force=true 忽略槽位上限）；返回模块实例 */
export function installModule(ship, moduleId, level = 1, force = false) {
  const type = SHIPS[ship.typeId];
  if (!force && ship.modules.length >= type.slots) throw new Error('模块槽位已满');
  const inst = createModuleInstance(moduleId, level);
  ship.modules.push(inst);
  recalcDerived(ship); // 常驻模块池出现（值为 0；时长型不在持续期则无池）
  return inst;
}

export default createShip;
