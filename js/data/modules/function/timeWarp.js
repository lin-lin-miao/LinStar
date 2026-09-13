/* ===== data/modules/function/timeWarp.js —— 时间扭曲（功能 · 时间加速） =====
 * 功能：对【选择器解析出的单个目标（敌我任意，含自己）】+【该目标所在队列前后各 blast_range 个存活单位】
 *   +【自身（`include_self` 标签）】，施加**时间加速**：给出一个**负的时间系数**（`time_coeff: -0.1`）。
 *   —— ★ 它**不改每 tick 推进量**（每 tick 恒推进 1 tick），而是把作用对象各类计时器的**需求量**变小：
 *     `需求量 = timeScaled(基础量, 系数) = max(0, round(基础量 × (1 + 系数)))`（整数 tick），
 *     计时器**剩余 = 需求量 − 已推进 tick 数**。作用于三类计时器：
 *     · 模块**冷却**（`inst.cooldown`）· 模块**持续时间**（`inst.durationLeft`）· 临时单位**存在时间**（`u.tempLeft`）。
 *   —— `-0.1` → 需求量 ×0.9（更快走完）；系数在**中途**生效/撤销都能正确反映（已推进的进度不回退，
 *      只是“还需要多少 tick”随需求量变化）。
 *   - 持续型模块：由 `duration_ticks > 0` 判定（**不要**写 `'duration'` 标签，那不是合法标签）。
 *   - 词条：`time_coeff`（时间系数，**负＝加速**）+ `blast_range`（作用集合扩至“目标及波及”）
 *       + `duration_ticks`（持续一段；到期/停用/携带者阵亡/离场即撤销）。映射表 `TIME`。
 *   - ★ **`type` 标签**（三个，全部按标签识别、引擎不硬编码模块 id）：
 *       · `include_self` —— **效果同时施加于自身**（与目标选择器无关：即使 kinds 不含 self 也作用于自身）；
 *       · `prefer_self` —— **优先自己**：自身可作为目标（`kinds:['any']` 含自身）时，默认解析**优先取自己**；
 *         玩家手动点选其它单位时以手动为准（手动 > 优先自己）；
 *       · `lock_target_on_activate` —— **激活后锁定目标**：本次持续期内目标固定为激活瞬间的解析结果
 *         （优先级高于强制目标与手动目标）；玩家在持续期内点选的目标**只记录**，**下一次激活**才采用。
 *   - ★ **多来源组合**：单位上按来源记账（`ship.timeCoeffMods`），派生值 `ship.timeCoeff` 由 ship.js
 *       `refreshTimeCoeff()` 组合（**当前＝加性求和**；切换规则只改该函数一行）。撤销一个来源后按剩余来源重新组合。
 *   - ★ 生效时序：Pass1 只记账（`__pending.timeOps`），**结算步骤 2**统一落地（与上限/系数修改同批、
 *       先于伤害结算）→ **下一 tick 起**生效（本 tick 的计时已按 tick 起始的快照系数算完），
 *       落地与撤销跨单位顺序一致。
 *   - 系数**不经类别系数缩放**（时间系语义：`-0.1` 就是需求量 ×0.9）。
 *   - 目标：`kinds:['any']` + `countMode:'single'` → **可手动指定任意单个单位**（自己/友军/敌军皆可）；
 *     无手动指定时由 `prefer_self` 优先取自己（自身存活即可激活，故单人编队也能放）。
 *   - ★ **“自身是否溅射”看它是怎么进作用集合的**：由 `include_self` 标签补入的自身**不产生溅射**；
 *     而由 `prefer_self` 默认取到的自身（或玩家手动选中的自身）属于**选择器正常解析出的目标** →
 *     `blast_range` **照常以它为中心波及**其所在队列前后各 N 个存活单位（默认玩法即如此）。
 *   - **战报（低频）**：不逐次激活播报；仅**首次施加**（从无→有）记一条
 *     「{owner}的{module}开始加速：{n}个单位」、**最后一次撤销**（从有→无）记一条
 *     「{owner}的{module}加速结束：{n}个单位」；同一模块同 tick 内到期并重新激活则整体静默。
 * 数值说明：【占位预填】duration_ticks / cooldown_ticks / energy_cost / time_coeff / blast_range
 *   由用户逐级人工调校。
 */
export default {
  id: 'timeWarp',
  nameKey: 'module.timeWarp', // i18n -> 时间扭曲
  name: '时间扭曲',
  icon: 'assets/img/时间扭曲.svg',
  category: 'function',
  target: { kinds: ['any'], countMode: 'single', maxCount: 1 }, // 任意单个目标（自己/友方/敌方）
  effects: {
    time_coeff: -0.1,       // 时间系数：负＝加速（需求量 ×0.9 → 冷却/持续/存在时间更快走完）
    blast_range: 1,         // 作用集合扩至各目标所在队列前后各 1 个存活单位（标签补入的自身不产生溅射）
    duration_ticks: 200,    // Lv1 占位：持续 10s
    cooldown_ticks: 300,    // Lv1 占位：间隔 15s
    energy_cost: 300,       // Lv1 占位：每次耗能
    // ★ type 标签（非 effects 词条）：同时作用于自身 / 优先自己 / 激活后锁定目标
    type: ['include_self', 'prefer_self', 'lock_target_on_activate'],
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { time_coeff: -0.15, duration_ticks: 240, cooldown_ticks: 280, energy_cost: 360, blast_range: 2 } },
    { level: 10, effects: { time_coeff: -0.2, duration_ticks: 300, cooldown_ticks: 260, energy_cost: 440, blast_range: 3 } },
    { level: 16, effects: { time_coeff: -0.25, duration_ticks: 600, cooldown_ticks: 240, energy_cost: 520, blast_range: 3 } },
  ],
};
