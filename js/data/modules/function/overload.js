/* ===== data/modules/function/overload.js —— 辐能过载（功能 · 低血后触发爆炸） =====
 * 机制（对照《模块字段说明.md》，**全部复用既有词条/标签，不新增伤害体系**）：
 *  · **低血门控**：`hp_below_activate: 0.3` —— **仅当单位血量比例 ≤ 该阈值时可激活**；激活即打**结构标记**
 *    （引擎内 `inst._firedOnce`），**血量回升到阈值以上并清标记之前不得再次激活**
 *    （＝“进入低血区间一次只能触发一次”；血量回升过阈值 → 清标记 → 可再次触发）。
 *    ★ 门控**未满足**时详情页/单位面板显示「条件未满足」（引擎判据 `battle.moduleGateMet`，UI 不自算）。
 *  · **后触发**：`type` 标签 `delayed_trigger` —— **激活时不产生效果**，只把「作用集合 + 出伤数值」
 *    冻结在激活瞬间；真正效果在**持续期结算到期的瞬间**（`duration_ticks` 走完的那一 tick）才产生。
 *  · **效果**：对**目标**产生大量爆炸伤害，并带 `blast_range` 溅射；伤害类型标签 `explosive`
 *    （战报显示“爆炸伤害”），`blast` 标签使伤害属“爆炸型”→ **可被防爆护盾吸收**
 *    （主目标被防爆池吸收时，`blast_range` 波及被抑制 —— 与火箭/导弹弹头同一口径）。
 *  · 作用集合＝共享 helper `effectSetOf`（解析到的目标 ∪ `blast_range` 波及 ∪ `include_self`），
 *    **激活瞬间冻结**（持续期内新入场单位不受影响）；到期引爆时按既有伤害记账写入目标 `__pending.dmg`，
 *    走既有结算固定顺序与战报/护盾吸收/判死链路。
 *  · **冷却与耗能保留**：① 门控只管“低血区间内一次”，冷却另给出两次引爆之间的**硬间隔**
 *    （血量在阈值附近反复波动时不会连续引爆）；② 耗能使其与其它模块**共用能量门控**（能量不足不触发）。
 * 分类归属：**功能性模块**（`category: 'function'`，与电磁脉冲/单枪匹马/固若金汤/时间扭曲等同类；
 *   文件位置＝ `data/modules/function/`）。
 * 数值说明：【占位预填】damage / blast_range / duration_ticks / cooldown_ticks / energy_cost 由用户逐级人工调校。
 */
export default {
  id: 'overload',
  nameKey: 'module.overload', // i18n -> 辐能过载 / Overload
  name: '辐能过载',
  icon: 'assets/img/爆炸.svg',
  category: 'function',
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 }, // 必须解析到目标才激活
  effects: {
    // 机制标签列表（可多个；引擎按标签识别、不按模块 id 硬编码）：
    //   delayed_trigger = 效果在**持续期结束（到期结算）时**才触发（“后触发”）
    //   blast           = 爆炸型伤害（可被防爆护盾吸收；主目标被吸收则 blast_range 波及被抑制）
    //   explosive       = 命中伤害类型标签（战报 dtype → 爆炸伤害）
    type: ['delayed_trigger', 'blast', 'explosive'],
    hp_below_activate: 0.3,   // Lv1：仅当血量比例 ≤ 30% 时可激活一次（血量回升过阈值才清标记）
    damage: 150,              // Lv1 占位：到期引爆对目标的大量爆炸伤害（按攻击系数折算）
    blast_range: 1,           // Lv1 占位：爆炸范围——目标所在队列前后各 1 个存活单位同额受击
    duration_ticks: 100,      // Lv1 占位：激活后 5s 到期→引爆（“后触发”的延迟期）
    cooldown_ticks: 200,      // Lv1 占位：引爆后 10s 冷却（两次引爆之间的硬间隔）
    energy_cost: 300,         // Lv1 占位：每次激活耗能（能量不足则不触发）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { damage: 260, blast_range: 2, duration_ticks: 90, cooldown_ticks: 190, energy_cost: 330 } },
    { level: 10, effects: { damage: 420, blast_range: 3, duration_ticks: 80, cooldown_ticks: 180, energy_cost: 360 } },
    { level: 16, effects: { damage: 650, blast_range: 4, duration_ticks: 70, cooldown_ticks: 160, energy_cost: 400 } },
  ],
};
