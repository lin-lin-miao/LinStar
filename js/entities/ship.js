/* ===== entities/ship.js —— 船实体（HP/护盾/能量/模块/系数） =====
 * ship.hull 内数值以浮点累计，显示层负责取整。
 */
import { SHIPS } from '../data/ships.js';
import { uid } from '../core/utils.js';
import { createModuleInstance } from './module.js';

/** 该船对某模块类别的加成系数（缺失类别按 1） */
export function coeff(ship, category) {
  return ship.coefficients[category] ?? 1;
}

/** 模块当前对护盾上限的贡献：
 *  - 停用 → 0；时长型词条(duration_ticks) → 仅在持续期(durationLeft>0)贡献；
 *  - 普通(永久)加成 → 恒贡献（安装即生效）。 */
function shield_cap_bonusOf(inst) {
  const fx = inst.cfg.effects;
  if (!fx || !fx.shield_cap_bonus) return 0;
  if (!inst.enabled) return 0;
  if (fx.duration_ticks > 0 && inst.durationLeft <= 0) return 0; // 持续期外不生效
  return fx.shield_cap_bonus;
}

/** 重算派生值：护盾上限 = 基础 + Σ模块(按当前启停/持续状态)贡献×系数；当前护盾不超过上限 */
export function recalcDerived(ship) {
  const type = SHIPS[ship.typeId];
  let bonus = 0;
  for (const inst of ship.modules) {
    bonus += shield_cap_bonusOf(inst) * coeff(ship, inst.cfg.category);
  }
  ship.hull.shieldCap = Math.max(0, ship.hull.baseShieldCap + bonus);
  ship.hull.shield = Math.min(ship.hull.shield, ship.hull.shieldCap);
  return ship;
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
      shield: 0,
      shieldCap: type.base.shieldCap,
      baseShieldCap: type.base.shieldCap,
      energy: type.base.energyCap,
      energyCap: type.base.energyCap,
      baseEnergyCap: type.base.energyCap,
    },
    energyRegenPerSec: type.base.energyRegen,
    targetId: null, // 玩家指定的主要攻击目标（unit id）；null=自动(最近)
    alive: true,
  };
  recalcDerived(ship);
  return ship;
}

/** 安装模块（槽位不足抛错，除非 force=true 忽略槽位上限）；返回模块实例 */
export function installModule(ship, moduleId, level = 1, force = false) {
  const type = SHIPS[ship.typeId];
  if (!force && ship.modules.length >= type.slots) throw new Error('模块槽位已满');
  const inst = createModuleInstance(moduleId, level);
  ship.modules.push(inst);
  recalcDerived(ship);
  return inst;
}

export default createShip;
