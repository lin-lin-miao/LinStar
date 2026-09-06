/* ===== data/modules/regenShield.js —— 再生护盾（护盾 · 对自身 · 周期回盾） =====
 * 功能：对【自身】周期性地恢复护盾值，并扣除能量（激活型，沿用系统既有词条）：
 *   - shield_gain：每次激活回自身 X 盾（乘护盾系数，不超过护盾上限）；
 *   - energy_cost：每次激活耗能，能量不足则不触发、不扣能；
 *   - cooldown_ticks：激活间隔。
 *   护盾已满时无需回盾 → 不触发（不耗能）。
 * 数值说明：【占位预填】回盾量/冷却/能耗由用户逐级人工调校。
 */
export default {
  id: 'regenShield',
  nameKey: 'module.regenShield', // i18n -> 再生护盾 / Regenerative Shield
  name: '再生护盾',
  icon: 'assets/img/再生护盾.svg',
  category: 'shield',
  target: {
    kinds: ['self'],   // 作用于自身
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    shield_cap_bonus: 100,
    shield_gain: 2,      // Lv1 占位：每次激活回自身盾量
    cooldown_ticks: 25,   // 激活间隔(tick)占位（各级沿用 Lv1）
    energy_cost: 30,      // 每次激活能耗占位（各级沿用 Lv1）
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { shield_gain: 3, shield_cap_bonus: 125 } },
    { level: 3, effects: { shield_gain: 4, shield_cap_bonus: 150 } },
    { level: 4, effects: { shield_gain: 5, shield_cap_bonus: 175 } },
    { level: 5, effects: { shield_gain: 6, shield_cap_bonus: 200 } },
    { level: 6, effects: { shield_gain: 7, shield_cap_bonus: 225 } },
    { level: 7, effects: { shield_gain: 9, shield_cap_bonus: 250 } },
    { level: 8, effects: { shield_gain: 11, shield_cap_bonus: 275 } },
    { level: 9, effects: { shield_gain: 13, shield_cap_bonus: 300, energy_cost: 50 } },
    { level: 10, effects: { shield_gain: 15, shield_cap_bonus: 325, cooldown_ticks: 20 } },
    { level: 11, effects: { shield_gain: 17, shield_cap_bonus: 350 } },
    { level: 12, effects: { shield_gain: 19, shield_cap_bonus: 375 } },
    { level: 13, effects: { shield_gain: 21, shield_cap_bonus: 400 } },
    { level: 14, effects: { shield_gain: 24, shield_cap_bonus: 425 } },
    { level: 15, effects: { shield_gain: 27, shield_cap_bonus: 450 } },
    { level: 16, effects: { shield_gain: 30, shield_cap_bonus: 500 } },
  ],
};
