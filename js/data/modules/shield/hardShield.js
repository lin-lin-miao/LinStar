/* ===== data/modules/hardShield.js —— 硬化护盾（护盾 · 对自身 · 厚实大护盾·持续时间） =====
 * 功能：激活后在持续期内对【自身】大幅提高护盾上限并【补满到大上限】，形成拥有大量护盾量的厚实护盾；
 *       持续期结束上限回落，超出部分按既有护盾语义扣除。
 *   - shield_cap_bonus：持续期内提高自身护盾上限（越大护盾量越多）；
 *   - duration_ticks：持续时长（持续期外此加成不生效）；
 *   - energy_cost / cooldown_ticks：开启能耗与进入冷却（持续结束后进冷却）。
 * 数值说明：【占位预填】护盾量/持续时间/能耗由用户逐级人工调校。
 */
export default {
  id: 'hardShield',
  /* ★ M3 基地侧字段【占位预填 · 待用户调校】——M3a 只铺字段，读取逻辑属 M3b（船坞）/ M3e（研究站）。
   * · `levels[]` 仍是【战斗数值】的唯一逐级表（由 entities/module.js 解析 effects/target）；
   *   下列基地侧字段自带**独立逐级表**（数组项 { level, ... }，未列出该等级则沿用上一项）；
   * · 缺省即视为「无消耗 / 无门槛」：installCost / removeCost / upgradeCost / scienceCost 缺失＝免费，
   *   blueprint 缺失＝无需蓝图；资源键见 data/resources.js（缺失键视为 0）。 */
  installCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  removeCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  upgradeCost: [{ level: 2, cost: { energy: 0, ore: 0, alloy: 0, rare: 0 } }],
  blueprint: [{ level: 1, count: 0 }],
  scienceCost: [{ level: 2, cost: { science: 0 } }],
  nameKey: 'module.hardShield', // i18n -> 硬化护盾 / Hardened Shield
  name: '硬化护盾',
  icon: 'assets/img/硬化护盾.svg',
  category: 'shield',
  target: {
    kinds: ['self'],   // 作用于自身
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: ['no_break'],
    shield_cap_bonus: 300,  // Lv1 占位：持续期内大幅提高自身护盾上限0.48
    duration_ticks: 400,    // 持续(tick)占位：Lv1
    cooldown_ticks: 20,    // 持续结束后冷却(tick)占位
    energy_cost: 250,        // 每次开启能耗占位
  },
  maxLevel: 16,
  // 护盾上限逐级 +50（Lv1=200 → Lv16=950）；持续时间各级递增（2→16），冷却/能耗各级沿用 Lv1。
  levels: [
    { level: 2, effects: { shield_cap_bonus: 350 } },
    { level: 3, effects: { shield_cap_bonus: 400 } },
    { level: 4, effects: { shield_cap_bonus: 450 } },
    { level: 5, effects: { shield_cap_bonus: 500 } },
    { level: 6, effects: { shield_cap_bonus: 550 } },
    { level: 7, effects: { shield_cap_bonus: 600 } },
    { level: 8, effects: { shield_cap_bonus: 650 } },
    { level: 9, effects: { shield_cap_bonus: 700 } },
    { level: 10, effects: { shield_cap_bonus: 750, duration_ticks: 300 } },
    { level: 11, effects: { shield_cap_bonus: 800 } },
    { level: 12, effects: { shield_cap_bonus: 850 } },
    { level: 13, effects: { shield_cap_bonus: 900 } },
    { level: 14, effects: { shield_cap_bonus: 950 } },
    { level: 15, effects: { shield_cap_bonus: 1000 } },
    { level: 16, effects: { shield_cap_bonus: 1050 } },
  ],
};
