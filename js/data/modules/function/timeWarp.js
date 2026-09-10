/* ===== data/modules/function/timeWarp.js —— 时间扭曲（功能 · 时间加速） =====
 * 功能：对【选择器解析出的单个目标（敌我任意，含自己）】+【该目标所在队列前后各 blast_range 个存活单位】
 *   +【自身（`include_self` 标签）】，施加**时间加速**：把这些单位的**计时推进量**从 1 变为 `1 + hasten_ticks`
 *   —— 即每 tick 多推进 N tick，作用于三处递减：
 *     · 模块**冷却**（`inst.cooldown`）· 模块**持续时间**（`inst.durationLeft`）· 临时单位**存在时间**（`u.tempLeft`）。
 *   - 持续型模块：由 `duration_ticks > 0` 判定（**不要**写 `'duration'` 标签，那不是合法标签）。
 *   - 词条：`hasten_ticks`（每 tick 额外推进的 tick 数）+ `blast_range`（作用集合扩至“目标及波及”）
 *       + `duration_ticks`（持续一段；到期/停用/携带者阵亡/离场即撤销）。映射表 `HASTEN`。
 *   - ★ **`type` 标签**（三个，全部按标签识别、引擎不硬编码模块 id）：
 *       · `include_self` —— **效果同时施加于自身**（与目标选择器无关：即使 kinds 不含 self 也作用于自身）；
 *       · `prefer_self` —— **优先自己**：自身可作为目标（`kinds:['any']` 含自身）时，默认解析**优先取自己**；
 *         玩家手动点选其它单位时以手动为准（手动 > 优先自己）；
 *       · `lock_target_on_activate` —— **激活后锁定目标**：本次持续期内目标固定为激活瞬间的解析结果
 *         （优先级高于强制目标与手动目标）；玩家在持续期内点选的目标**只记录**，**下一次激活**才采用。
 *   - ★ **多来源取最大值**：单位上按来源记账（`ship.hastenMods`），派生值 `ship.hastenTicks = max(各来源)`，
 *       **不叠加**（两个加速模块不会变成 4×）；撤销一个来源后按剩余来源重新取 max。
 *   - ★ 生效时序：Pass1 只记账（`__pending.hastenOps`），结算步骤 2 统一落地 →
 *       **下一 tick 起**生效（本 tick 的计时已按 tick 起始快照推进完毕），加速与撤销跨单位顺序一致。
 *   - 数值**不经类别系数缩放**（整数 tick 语义：`hasten_ticks: 1` 就是每 tick 多推进 1）。
 *   - 目标：`kinds:['any']` + `countMode:'single'` → **可手动指定任意单个单位**（自己/友军/敌军皆可）；
 *     无手动指定时由 `prefer_self` 优先取自己（自身存活即可激活，故单人编队也能放）。
 *   - ★ **“自身是否溅射”看它是怎么进作用集合的**：由 `include_self` 标签补入的自身**不产生溅射**；
 *     而由 `prefer_self` 默认取到的自身（或玩家手动选中的自身）属于**选择器正常解析出的目标** →
 *     `blast_range` **照常以它为中心波及**其所在队列前后各 N 个存活单位（默认玩法即如此）。
 *   - **战报（低频）**：不逐次激活播报；仅**首次施加**（从无→有）记一条
 *     「{owner}的{module}开始加速：{n}个单位」、**最后一次撤销**（从有→无）记一条
 *     「{owner}的{module}加速结束：{n}个单位」；同一模块同 tick 内到期并重新激活则整体静默
 *     （详见 战报日志开发要点.md「时间加速战报（低频聚合）」）。
 * 数值说明：【占位预填】duration_ticks / cooldown_ticks / energy_cost / hasten_ticks / blast_range
 *   由用户逐级人工调校。
 */
export default {
  id: 'timeWarp',
  nameKey: 'module.timeWarp', // i18n -> 时间扭曲
  name: '时间扭曲',
  category: 'function',
  target: { kinds: ['any'], countMode: 'single', maxCount: 1 }, // 任意单个目标（自己/友方/敌方）
  effects: {
    hasten_ticks: 1,        // 时间加速：每 tick 额外推进 1 tick（≈冷却/持续/存在时间流速 ×2）
    blast_range: 1,         // 作用集合扩至各目标所在队列前后各 1 个存活单位（标签补入的自身不产生溅射）
    duration_ticks: 200,    // Lv1 占位：持续 10s
    cooldown_ticks: 300,    // Lv1 占位：间隔 15s
    energy_cost: 300,       // Lv1 占位：每次耗能
    // ★ type 标签（非 effects 词条）：同时作用于自身 / 优先自己 / 激活后锁定目标
    type: ['include_self', 'prefer_self', 'lock_target_on_activate'],
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { duration_ticks: 240, cooldown_ticks: 280, energy_cost: 360, blast_range: 2 } },
    { level: 10, effects: { duration_ticks: 300, cooldown_ticks: 260, energy_cost: 440, blast_range: 3 } },
    { level: 16, effects: { hasten_ticks: 2, duration_ticks: 600, cooldown_ticks: 240, energy_cost: 520, blast_range: 3 } },
  ],
};
