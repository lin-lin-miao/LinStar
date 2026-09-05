/* ===== entities/module.js —— 模块实例（配置引用 + 运行状态） =====
 * 模块带等级：cfg.levels[] 为逐级绝对表，某级未填字段回退“上一级”。
 * 实例按 level 把 base 与各级差异合并成该等级可用的 cfg（effects/target 已解析）。
 */
import { MODULES } from '../data/modules.js';
import { uid, deepClone } from '../core/utils.js';

/** 把模块定义按指定等级合并出该等级的完整配置（effects/target 已按该级解析） */
export function resolveModuleCfg(def, level) {
  const lv = Math.max(1, level | 0);
  const out = deepClone(def);
  out.effects = Object.assign({}, def.effects || {});
  if (def.target) out.target = deepClone(def.target);
  for (const e of def.levels || []) {
    if ((e.level | 0) <= lv) {
      if (e.effects) out.effects = Object.assign({}, out.effects, e.effects);
      if (e.target) out.target = Object.assign({}, out.target, deepClone(e.target));
    }
  }
  return out;
}

/** 模块最大可用等级：优先 def.maxLevel；否则按 levels 最高等级 +1（至少 1） */
export function moduleMaxLevel(def) {
  if (def && def.maxLevel) return def.maxLevel;
  let m = 1;
  for (const e of (def && def.levels) || []) {
    const l = e.level | 0;
    if (l + 1 > m) m = l + 1;
  }
  return m;
}

export function createModuleInstance(moduleId, level = 1) {
  const cfg = MODULES[moduleId];
  if (!cfg) throw new Error(`未知模块: ${moduleId}`);
  const lv = Math.max(1, level | 0);
  return {
    id: uid('mod'),
    moduleId,
    level: lv,
    cfg: resolveModuleCfg(cfg, lv),
    cooldown: 0,     // 剩余冷却 tick 数（无 duration 模块：激活后即开始；有 duration：持续时间结束后开始）
    durationLeft: 0, // ★ 持续时间词条 effects.duration_ticks 的剩余 tick（>0 = 效果持续中）
    enabled: true, // 模块开关（玩家可在详情面板停用/启用；停用时不结算、不耗能）
    // 模块级目标（可选目标的模块使用，如单体/有限目标武器）：
    //   { mode:'follow' } = 默认，跟随上游（所属船的目标）
    //   { mode:'unit', id } = 手动指定某敌方单位
    target: { mode: 'follow' },
    // 本场战斗贡献统计（由 battle.js 在每次激活时累加）
    stats: {
      activations: 0,    // 激活次数
      damageDealt: 0,    // 累计造成伤害（武器）
      shieldRestored: 0, // 累计回复护盾量（回复模块）
      energySpent: 0,    // 累计消耗能量
      activeTicks: 0,    // 有效贡献窗口时长（单位存活且模块启用时逐 tick 累计；
                         // 用于折算 DPS/速率，死亡或停用后停止累计 → 数值冻结）
    },
  };
}

export default createModuleInstance;
