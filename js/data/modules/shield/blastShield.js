/* ===== data/modules/blastShield.js —— 防爆护盾（护盾 · 施放者 · 只挡爆炸 · 跨友方共享层） =====
 * 功能：与同盟护盾同构（施放者共享层=跨友方共享池）；区别在于**只吸收爆炸型伤害**（有 type 标记
 *       'blast' 的伤害，如火箭/导弹爆炸），不吸收普通伤害。强度【高于】硬化护盾。
 *   - effects.type: ['blastproof','alliance','no_break']：
 *       blastproof = 防爆型（只吸爆炸伤、指挥栏单独一行）；alliance = 共享同盟池语义；
 *       no_break = 破盾后仍保持激活（不提前结束，走自然持续到期）。
 *   - shield_cap_bonus：共享层护盾量（高于硬化护盾）；duration_ticks 等类同盟。
 * 机制：友方自身盾空、伤害将扣血且该伤害属爆炸型 → 优先由防爆池吸收，随后同盟池。
 *       主目标被防爆池吸收时，该爆炸的 blast_range 被抑制（不再波及相邻友方）。
 * 数值说明：【占位预填】护盾量/持续/能耗由用户人工调校（护盾量应高于硬化护盾）。
 */
export default {
  id: 'blastShield',
  nameKey: 'module.blastShield', // i18n -> 防爆护盾 / Blast Shield
  name: '防爆护盾',
  icon: 'assets/img/防爆护盾.svg',
  category: 'shield',
  target: {
    kinds: ['self'],   // 施放者自身（该共享层挂在施放者盾池上）
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: ['blastproof', 'alliance', 'no_break'], // 防爆型 + 共享同盟语义 + 破盾后仍激活
    shield_cap_bonus: 500,   // Lv1 占位：共享层护盾量（> 硬化护盾 Lv1=200）
    duration_ticks: 300,     // 持续(tick)占位
    cooldown_ticks: 200,     // 持续结束后冷却(tick)占位
    energy_cost: 60,         // 每次开启能耗占位
  },
  maxLevel: 16,
  // 护盾量高于硬化护盾（逐级，Lv16=1050 > 硬化 Lv16=950）。
  levels: [
    { level: 2, effects: { shield_cap_bonus: 600, duration_ticks: 320 } },
    { level: 3, effects: { shield_cap_bonus: 700, duration_ticks: 340  } },
    { level: 4, effects: { shield_cap_bonus: 800, duration_ticks: 360  } },
    { level: 5, effects: { shield_cap_bonus: 900, duration_ticks: 380  } },
    { level: 6, effects: { shield_cap_bonus: 1000, duration_ticks: 400  } },
    { level: 7, effects: { shield_cap_bonus: 1100, duration_ticks: 420  } },
    { level: 8, effects: { shield_cap_bonus: 1200, duration_ticks: 440  } },
    { level: 9, effects: { shield_cap_bonus: 1300, duration_ticks: 460  } },
    { level: 10, effects: { shield_cap_bonus: 1400, duration_ticks: 480  } },
    { level: 11, effects: { shield_cap_bonus: 1500, duration_ticks: 500  } },
    { level: 12, effects: { shield_cap_bonus: 1600, duration_ticks: 520  } },
    { level: 13, effects: { shield_cap_bonus: 1700, duration_ticks: 540  } },
    { level: 14, effects: { shield_cap_bonus: 1800, duration_ticks: 560  } },
    { level: 15, effects: { shield_cap_bonus: 1900, duration_ticks: 580 } },
    { level: 16, effects: { shield_cap_bonus: 2000, duration_ticks: 600 } },
  ],
};
