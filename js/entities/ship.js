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
 */
import { SHIPS } from '../data/ships.js';
import { uid } from '../core/utils.js';
import { createModuleInstance } from './module.js';

/** 该船对某模块类别的加成系数（缺失类别按 1） */
export function coeff(ship, category) {
  return ship.coefficients[category] ?? 1;
}

/** 本体池在 ship.hull.pools 中的固定 key */
export const BASE_POOL_KEY = 'base';

/** 模块当前是否“贡献护盾池容量”（与旧 shield_cap_bonusOf 同一判据）：
 *  启用；无时长或持续中；shield_cap_bonus>0。返回其 effects 引用；不贡献返回 null。 */
function contributingShieldFx(inst) {
  const fx = inst && inst.cfg && inst.cfg.effects;
  if (!fx || !inst.enabled) return null;
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
