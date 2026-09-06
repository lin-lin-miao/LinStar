/* ===== data/modules/missileWarhead.js —— 导弹弹头（内部 · 随 导弹发射器 携带 · 爆炸范围） =====
 * 功能：导弹发射器召唤出的导弹所携带的特殊弹头模块。
 *   - type 含 cool_first：部署即进入冷却（引信 cooldown_ticks），到点才引爆（不会先触发一次）。
 *   - 引爆时：对【锁定目标】造成 damage；blast_range = 爆炸范围词条——同时对其所在队列
 *     （视觉顺序）前后各 blast_range 个位置内的存活单位造成同额爆炸伤害。
 *   - 随后 self_destruct_damage（负值）扣除自身全部生命令导弹自毁；目标即使已阵亡仍照常引爆。
 *   - self_destruct_damage 为数值词条：对所属单位自身血量"正加负减"（可致死）。
 * picker:false → 内部模块，不进入演练编队的可选项。
 * 数值说明：【占位预填】damage/blast_range/引信由用户逐级人工调校。
 */
export default {
  id: 'missileWarhead',
  nameKey: 'module.missileWarhead', // i18n -> 导弹爆炸（内部，通常只作为导弹的携带模组出现）
  name: '导弹爆炸',
  icon: 'assets/img/爆炸.svg',
  picker: false,                    // 不出现在演练编队可选模块清单
  category: 'attack',
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 },
  effects: {
    type: ['cool_first', 'blast'], // cool_first：引信倒计时；blast：爆炸型伤害（可被防爆护盾抵挡）
    damage: 140,                   // Lv1 占位：对锁定目标的大量伤害
    blast_range: 1,                // ★ 爆炸范围词条：队列前后各 1 个位置内的存活单位同时受同额爆炸伤害
    self_destruct_damage: -1000000, // 触发后扣除自身全部生命（自毁）；占位大负值保证死亡
    cooldown_ticks: 60,            // 引信时长(tick)占位：部署后 3s 引爆
    energy_cost: 0,                // 自毁不耗能
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 180 } },
    { level: 3, effects: { damage: 220 } },
    { level: 4, effects: { damage: 270 } },
    { level: 5, effects: { damage: 320, blast_range: 2, cooldown_ticks: 55 } },
    { level: 6, effects: { damage: 380 } },
    { level: 7, effects: { damage: 440 } },
    { level: 8, effects: { damage: 520 } },
    { level: 9, effects: { damage: 600 } },
    { level: 10, effects: { damage: 700, blast_range: 3, cooldown_ticks: 50 } },
    { level: 11, effects: { damage: 800 } },
    { level: 12, effects: { damage: 920 } },
    { level: 13, effects: { damage: 1040 } },
    { level: 14, effects: { damage: 1200 } },
    { level: 15, effects: { damage: 1360 } },
    { level: 16, effects: { damage: 1550, blast_range: 4, cooldown_ticks: 45 } },
  ],
};
