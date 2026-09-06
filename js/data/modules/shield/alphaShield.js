/* ===== data/modules/alphaShield.js —— 阿尔法护盾（护盾 · 对自身 · 无敌） =====
 * 功能：对【自身】施加周期性的持续无敌——持续期间目标免疫一切经伤害结算的伤害
 *       （普通攻击 + 爆炸波及），不会阵亡；但【自毁】(self_destruct 直接扣血)无法免疫。
 *   - type 含 invincible → 引擎在目标自身某模块处于激活持续期时拦截其受到的一切 damageShip 伤害。
 *   - target.kinds = ['self']（保护自身）；按"持续期(duration_ticks) + 冷却(cooldown_ticks)"周期循环。
 * 数值说明：【占位预填】无敌持续时间/冷却/能耗由用户人工调校。
 */
export default {
  id: 'alphaShield',
  nameKey: 'module.alphaShield', // i18n -> 阿尔法护盾 / Alpha Shield
  name: '阿尔法护盾',
  icon: 'assets/img/阿尔法护盾.svg',
  category: 'shield',
  target: {
    kinds: ['self'],   // 保护自身
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: ['invincible'], // 无敌：激活持续期内不受伤害（自毁除外）
    shield_gain: 100,
    duration_ticks: 100,  // 无敌持续(tick)：Lv1 = 100
    cooldown_ticks: 300,  // 无敌结束后进入冷却(tick)占位
    energy_cost: 50,      // 每次开启能耗占位
  },
  maxLevel: 16,
  // 无敌持续逐级递增 5~10 tick，满级(Lv16)=200 tick；冷却/能耗各级沿用 Lv1。
  levels: [
    { level: 2, effects: { duration_ticks: 106 } },
    { level: 3, effects: { duration_ticks: 112 } },
    { level: 4, effects: { duration_ticks: 119 } },
    { level: 5, effects: { duration_ticks: 126 } },
    { level: 6, effects: { duration_ticks: 133 } },
    { level: 7, effects: { duration_ticks: 140 } },
    { level: 8, effects: { duration_ticks: 146 } },
    { level: 9, effects: { duration_ticks: 153 } },
    { level: 10, effects: { duration_ticks: 160 } },
    { level: 11, effects: { duration_ticks: 167 } },
    { level: 12, effects: { duration_ticks: 174 } },
    { level: 13, effects: { duration_ticks: 181 } },
    { level: 14, effects: { duration_ticks: 187 } },
    { level: 15, effects: { duration_ticks: 194 } },
    { level: 16, effects: { duration_ticks: 200 } },
  ],
};
