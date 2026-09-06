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
    shield_cap_bonus: 200,  // Lv1 占位：持续期内大幅提高自身护盾上限
    duration_ticks: 125,    // 持续(tick)占位：Lv1
    cooldown_ticks: 200,    // 持续结束后冷却(tick)占位
    energy_cost: 60,        // 每次开启能耗占位
  },
  maxLevel: 16,
  // 护盾上限逐级 +50（Lv1=200 → Lv16=950）；持续时间各级递增（2→16），冷却/能耗各级沿用 Lv1。
  levels: [
    { level: 2, effects: { shield_cap_bonus: 250, duration_ticks: 150 } },
    { level: 3, effects: { shield_cap_bonus: 300, duration_ticks: 175  } },
    { level: 4, effects: { shield_cap_bonus: 350, duration_ticks: 200  } },
    { level: 5, effects: { shield_cap_bonus: 400, duration_ticks: 225  } },
    { level: 6, effects: { shield_cap_bonus: 450, duration_ticks: 250  } },
    { level: 7, effects: { shield_cap_bonus: 500, duration_ticks: 275  } },
    { level: 8, effects: { shield_cap_bonus: 550, duration_ticks: 300  } },
    { level: 9, effects: { shield_cap_bonus: 600, duration_ticks: 325  } },
    { level: 10, effects: { shield_cap_bonus: 650, duration_ticks: 350  } },
    { level: 11, effects: { shield_cap_bonus: 700, duration_ticks: 375  } },
    { level: 12, effects: { shield_cap_bonus: 750, duration_ticks: 400  } },
    { level: 13, effects: { shield_cap_bonus: 800, duration_ticks: 425  } },
    { level: 14, effects: { shield_cap_bonus: 850, duration_ticks: 450  } },
    { level: 15, effects: { shield_cap_bonus: 900, duration_ticks: 475  } },
    { level: 16, effects: { shield_cap_bonus: 950, duration_ticks: 500  } },
  ],
};
