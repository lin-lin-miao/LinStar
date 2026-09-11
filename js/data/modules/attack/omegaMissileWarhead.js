/* ===== data/modules/attack/omegaMissileWarhead.js —— 欧米茄导弹爆炸（内部 · 随 欧米茄导弹发射器 携带） =====
 * 功能：欧米茄导弹发射器召唤出的【欧米茄导弹】所携带的特殊弹头模块；结构与既有「导弹爆炸」
 *   （`missileWarhead`）完全一致，**只是数值更高更强**（占位预填）：
 *     · `damage`      —— 明显高于导弹弹头（对判定目标造成的大量爆炸伤害）；
 *     · `blast_range` —— 明显更大的爆炸范围（同时波及目标所在队列**视觉顺序**前后各 N 个存活单位）；
 *     · `cooldown_ticks` —— **更久的引信**（`cool_first` 使其部署即进入冷却，到点才引爆）。
 *   - `type: ['cool_first','blast','explosive']`（与既有弹头同一套标签）：
 *       `cool_first`＝引信倒计时；`blast`＝爆炸型伤害（**可被防爆护盾吸收**；主目标被防爆池吸收时
 *       `blast_range` 波及被抑制）；`explosive`＝命中伤害类型标签（战报 dtype → 爆炸伤害）。
 *   - 引爆时对**本次按正常目标链解析出的目标**造成 `damage`；随后 `self_destruct_damage`（大负值）
 *     扣除自身全部生命令导弹自毁 —— 该词条走**独立自毁路径**（`applySelfDestruct`，直接改机体血量、
 *     **不经护盾/受伤减免**），故“带护盾的欧米茄导弹”照常在引信结束时自毁。
 *   - 目标即使已阵亡也照常引爆（自毁词条始终触发）；若解析不到目标则只自毁、不产生伤害。
 *   - 目标解析：**不锁定**（发射器未写 `summon.bind_target`）→ 每次激活按既有正常目标链重新选目标
 *     （自动粘性优先沿用上次目标，目标阵亡/潜行即自动改选）。
 *   - `picker:false` → 内部模块，不进入演练编队的可选项。
 * 数值说明：【占位预填】damage/blast_range/引信由用户逐级人工调校。
 */
export default {
  id: 'omegaMissileWarhead',
  nameKey: 'module.omegaMissileWarhead', // i18n -> 欧米茄导弹爆炸（内部，通常只作为欧米茄导弹的携带模组出现）
  name: '欧米茄导弹爆炸',
  icon: 'assets/img/爆炸.svg',
  picker: false,                    // 不出现在演练编队可选模块清单
  category: 'attack',               // 伤害类内部模块（与既有 导弹爆炸/火箭爆炸 同体例）
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 },
  effects: {
    type: ['cool_first', 'blast', 'explosive'], // 引信 / 爆炸型伤害（可被防爆抵挡）/ 伤害类型 = 爆炸
    damage: 320,                   // Lv1 占位：对判定目标的大量爆炸伤害（明显高于导弹弹头 140）
    blast_range: 2,                // ★ 爆炸范围：队列前后各 2 个位置内的存活单位同额受爆炸伤害（导弹为 1）
    self_destruct_damage: -1000000, // 触发后扣除自身全部生命（自毁）；占位大负值保证死亡
    cooldown_ticks: 200,            // 引信时长(tick)占位：部署后 4.5s 引爆（导弹弹头为 60）
    energy_cost: 10,               // 自毁不耗能（占位，与既有弹头一致）
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 420 } },
    { level: 3, effects: { damage: 520 } },
    { level: 4, effects: { damage: 630 } },
    { level: 5, effects: { damage: 750, blast_range: 3, cooldown_ticks: 85 } },
    { level: 6, effects: { damage: 880 } },
    { level: 7, effects: { damage: 1020 } },
    { level: 8, effects: { damage: 1180 } },
    { level: 9, effects: { damage: 1350 } },
    { level: 10, effects: { damage: 1540, blast_range: 4, cooldown_ticks: 80 } },
    { level: 11, effects: { damage: 1750 } },
    { level: 12, effects: { damage: 1980 } },
    { level: 13, effects: { damage: 2230 } },
    { level: 14, effects: { damage: 2510 } },
    { level: 15, effects: { damage: 2820 } },
    { level: 16, effects: { damage: 3160, blast_range: 5, cooldown_ticks: 70 } },
  ],
};
