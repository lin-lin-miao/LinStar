/* ===== entities/module.js —— 模块实例（配置引用 + 运行状态） ===== */
import { MODULES } from '../data/modules.js';
import { uid, deepClone } from '../core/utils.js';

export function createModuleInstance(moduleId) {
  const cfg = MODULES[moduleId];
  if (!cfg) throw new Error(`未知模块: ${moduleId}`);
  return {
    id: uid('mod'),
    moduleId,
    cfg: deepClone(cfg),
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
