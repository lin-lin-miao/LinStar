/* ===== data/modules/attack/slagMissileWarhead.js —— 矿渣导弹爆炸（内部 · 随 矿渣导弹发生器 携带） =====
 * 功能：矿渣导弹发生器召唤出的【矿渣导弹】所携带的特殊弹头模块；结构与既有「欧米茄导弹爆炸」
 *   （`omegaMissileWarhead`）**完全同形状**（占位预填，两套后续各自独立调参）：
 *     · `damage: 4740`  —— 固定占位值（＝欧米茄 Lv16 的 3160 × 1.5），**不随等级变化**；
 *     · `blast_range: 5` —— 爆炸范围（同时波及目标所在队列**视觉顺序**前后各 5 个存活单位）；
 *     · `cooldown_ticks: 70` —— 引信（`cool_first` 使其部署即进入冷却，到点才引爆）；
 *     · `picker: false` —— 内部模块，不进入演练编队的可选项。
 *   - `type: ['cool_first','blast','explosive']`（与既有弹头同一套标签）：
 *       `cool_first`＝引信倒计时；`blast`＝爆炸型伤害（**可被防爆护盾吸收**；主目标被防爆池吸收时
 *       `blast_range` 波及被抑制）；`explosive`＝命中伤害类型标签（战报 dtype → 爆炸伤害）。
 *   - 引爆时对**本次按正常目标链解析出的目标**造成 `damage`；随后 `self_destruct_damage`（大负值）
 *     扣除自身全部生命令导弹自毁 —— 该词条走**独立自毁路径**（`applySelfDestruct`，直接改机体血量、
 *     **不经护盾/受伤减免**）。
 *   - 目标即使已阵亡也照常引爆（自毁词条始终触发）；若解析不到目标则只自毁、不产生伤害。
 *   - 目标解析：**不锁定**（发射器未写 `summon.bind_target`）→ 每次激活按既有正常目标链重新选目标。
 *   - `maxLevel: 16` 但**不预填 `levels[]`**：所有等级同值 ⇒ 伤害保持“固定占位值”，
 *     后续两套弹头各自独立调参时再补 `levels[]`。
 *   - **不写 `icon`**：暂不新增美术资源（内部模块不出现在可选清单，图标仅用于携带它的召唤物卡片）。
 * 数值说明：【占位预填】damage/blast_range/引信由用户逐级人工调校。
 */
export default {
  id: 'slagMissileWarhead',
  nameKey: 'module.slagMissileWarhead', // i18n -> 矿渣导弹爆炸（内部，通常只作为矿渣导弹的携带模组出现）
  name: '矿渣导弹爆炸',
  icon: 'assets/img/爆炸.svg',
  picker: false,                    // 不出现在演练编队可选模块清单
  category: 'attack',               // 伤害类内部模块（与既有 欧米茄导弹爆炸/导弹爆炸 同体例）
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 },
  effects: {
    type: ['cool_first', 'blast', 'explosive'], // 引信 / 爆炸型伤害（可被防爆抵挡）/ 伤害类型 = 爆炸
    damage: 4740,                   // ★ 固定占位：对判定目标的大量爆炸伤害（欧米茄 Lv16 的 3160 × 1.5）
    blast_range: 5,                 // ★ 爆炸范围：队列前后各 5 个位置内的存活单位同额受爆炸伤害
    self_destruct_damage: -1000000, // 触发后扣除自身全部生命（自毁）；占位大负值保证死亡
    cooldown_ticks: 70,             // 引信时长(tick)占位：部署后约 3.5s 引爆
    energy_cost: 10,                // 自毁不耗能（占位，与既有弹头一致）
  },
  maxLevel: 16, // 不预填 levels[] ⇒ 各等级同值（“固定占位值”）
};
