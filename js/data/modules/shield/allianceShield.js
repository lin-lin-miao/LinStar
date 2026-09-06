/* ===== data/modules/allianceShield.js —— 同盟护盾（护盾 · 施放者 · 跨友方共享层） =====
 * 功能：激活后持续期内为【施放者】提供一层护盾；该层是一个【供整支友方共用】的共享盾池
 *       （施放者自身单位卡片上的护盾即此池）。友方任一单位自身盾空、伤害将扣血时，由
 *       友方各同盟护盾的共享层按“释放顺序”逐层吸收（共享盾池被消耗，同一盾）。
 *   - effects.type: ['alliance']：标记为“同盟护盾”（特殊 type 词条）；
 *   - shield_cap_bonus：共享层护盾量（比硬化护盾稍弱）；
 *   - duration_ticks：持续时长（与硬化护盾相同）；持续结束或共享层被打空(破盾)后进冷却；
 *   - cooldown_ticks / energy_cost：再次开启的冷却与能耗。
 * 数值说明：【占位预填】护盾量/持续/能耗由用户人工调校（护盾量应略低于硬化护盾、时长相同）。
 */
export default {
  id: 'allianceShield',
  nameKey: 'module.allianceShield', // i18n -> 同盟护盾 / Alliance Shield
  name: '同盟护盾',
  icon: 'assets/img/同盟护盾.svg',
  category: 'shield',
  target: {
    kinds: ['self'],   // 施放者自身（该共享层挂在施放者盾池上）
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: ['alliance'], // 同盟护盾；破盾后仍保持激活（层打空不提前结束，走自然持续）
    shield_cap_bonus: 150,   // Lv1 占位：共享层护盾量（< 硬化护盾 Lv1=200）
    duration_ticks: 200,     // 持续(tick)占位：比硬化护盾更长
    cooldown_ticks: 200,     // 持续结束后冷却(tick)占位
    energy_cost: 60,         // 每次开启能耗占位
  },
  maxLevel: 16,
  // 护盾量略低于硬化护盾（逐级，Lv16=900 < 硬化 Lv16=950）；持续时长比硬化护盾各等级更长。
  levels: [
    { level: 2, effects: { shield_cap_bonus: 200, duration_ticks: 225 } },
    { level: 3, effects: { shield_cap_bonus: 250, duration_ticks: 250  } },
    { level: 4, effects: { shield_cap_bonus: 300, duration_ticks: 275  } },
    { level: 5, effects: { shield_cap_bonus: 350, duration_ticks: 300  } },
    { level: 6, effects: { shield_cap_bonus: 400, duration_ticks: 325  } },
    { level: 7, effects: { shield_cap_bonus: 450, duration_ticks: 350  } },
    { level: 8, effects: { shield_cap_bonus: 500, duration_ticks: 375  } },
    { level: 9, effects: { shield_cap_bonus: 550, duration_ticks: 400  } },
    { level: 10, effects: { shield_cap_bonus: 600, duration_ticks: 425  } },
    { level: 11, effects: { shield_cap_bonus: 650, duration_ticks: 450  } },
    { level: 12, effects: { shield_cap_bonus: 700, duration_ticks: 475  } },
    { level: 13, effects: { shield_cap_bonus: 750, duration_ticks: 500  } },
    { level: 14, effects: { shield_cap_bonus: 800, duration_ticks: 525  } },
    { level: 15, effects: { shield_cap_bonus: 850, duration_ticks: 550  } },
    { level: 16, effects: { shield_cap_bonus: 900, duration_ticks: 575  } },
  ],
};
