/* ===== data/modules/reflectShield.js —— 反射护盾（护盾 · 对自身 · 持续型 · 反射） =====
 * 功能：激活后持续期内为【自身】提供一层护盾（护盾量/持续时间均【低于】硬化护盾）；
 *       当其“自身这层护盾”被攻击伤害消耗时，按反射系数 shield_reflect 把落在自身层内的伤害
 *       返还给攻击者（经攻击者自身护盾→血结算）。reflect_ratio = 1 即全反射。
 *   - shield_cap_bonus：本层护盾量（越高能吸收/反射越多；数值低于硬化护盾）；
 *   - duration_ticks：持续时长（短于硬化护盾）；持续结束或层被耗尽(破盾)后进冷却；
 *   - shield_reflect：反射系数（0~1，可 >1 为超额反射）；
 *   - cooldown_ticks / energy_cost：再次开启的冷却与能耗。
 * 数值说明：【占位预填】护盾量/持续/反射系数/能耗由用户人工调校（强度应整体低于硬化护盾）。
 */
export default {
  id: 'reflectShield',
  nameKey: 'module.reflectShield', // i18n -> 反射护盾 / Reflective Shield
  name: '反射护盾',
  icon: 'assets/img/反射护盾.svg',
  category: 'shield',
  target: {
    kinds: ['self'],   // 作用于自身
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    shield_cap_bonus: 120, // Lv1 占位：本层护盾量（< 硬化护盾 Lv1=200）
    shield_reflect: 0.5,     // 反射系数：1 = 全反射
    duration_ticks: 80,    // 持续(tick)占位（< 硬化护盾 Lv1=125）
    cooldown_ticks: 160,   // 冷却(tick)占位
    energy_cost: 40,       // 开启能耗占位
  },
  maxLevel: 16,
  // 护盾量逐级 +40（< 硬化护盾每级 +50），各级沿用 Lv1 的持续/冷却/能耗/反射系数。
  levels: [
    { level: 2, effects: { shield_cap_bonus: 160, shield_reflect: 0.6, duration_ticks: 90 } },
    { level: 3, effects: { shield_cap_bonus: 200, shield_reflect: 0.7, duration_ticks: 100 } },
    { level: 4, effects: { shield_cap_bonus: 240, shield_reflect: 0.8, duration_ticks: 110 } },
    { level: 5, effects: { shield_cap_bonus: 280, shield_reflect: 0.9, duration_ticks: 120 } },
    { level: 6, effects: { shield_cap_bonus: 320, shield_reflect: 1.0, duration_ticks: 130 } },
    { level: 7, effects: { shield_cap_bonus: 360, shield_reflect: 1.1, duration_ticks: 140 } },
    { level: 8, effects: { shield_cap_bonus: 400, shield_reflect: 1.2, duration_ticks: 150 } },
    { level: 9, effects: { shield_cap_bonus: 440, shield_reflect: 1.3, duration_ticks: 160 } },
    { level: 10, effects: { shield_cap_bonus: 480, shield_reflect: 1.4, duration_ticks: 170 } },
    { level: 11, effects: { shield_cap_bonus: 520, shield_reflect: 1.5, duration_ticks: 180 } },
    { level: 12, effects: { shield_cap_bonus: 560, shield_reflect: 1.6, duration_ticks: 190 } },
    { level: 13, effects: { shield_cap_bonus: 600, shield_reflect: 1.7, duration_ticks: 200 } },
    { level: 14, effects: { shield_cap_bonus: 640, shield_reflect: 1.8, duration_ticks: 210 } },
    { level: 15, effects: { shield_cap_bonus: 680, shield_reflect: 1.9, duration_ticks: 220 } },
    { level: 16, effects: { shield_cap_bonus: 720, shield_reflect: 2.0, duration_ticks: 230 } },
  ],
};
