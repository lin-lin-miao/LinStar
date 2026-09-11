/* ===== data/modules/function/emp.js —— 电磁脉冲（功能 · 清空能量上限） =====
 * 功能：对【自身】+【解析到的目标】+【目标所在队列前后各 blast_range 个存活单位】，
 *   将其**能量上限压到 0**（等价“清空能量上限”，当前能量随之被 clamp 到 0），并**持续一段时间**。
 *   - 词条复用优先：`energy_cap_target`（大负值占位 = 压到 0，引擎按 base 重算后 clamp 至 0，
 *     同火箭/导弹弹头用大负值保证自毁的做法）+ `blast_range`（把上限词条的作用集合扩为“目标及波及”）
 *     + `duration_ticks`（持续一段；到期/停用/携带者阵亡即撤销并复原上限）。
 *   - **`type` 标签 `include_self`**：本模块的上限词条**同时作用于自身**（kinds 里若加 self 会让“必须有目标才激活”失效，
 *     故用独立标签；★ 已由“effects 布尔词条”改为 **`type` 标签**，引擎按标签识别）。
 *   - 必须有目标才激活：无可用目标（kinds:['enemy'] 解析为空）则不激活、不耗能、不进冷却。
 *   - 作用集合在**激活瞬间冻结**：持续期内新入场单位不受影响，单位离场则其影响随自身消亡一并失效。
 *     ★ **`include_self` 标签补入的自身不产生 `blast_range` 溅射**（波及只从“选择器解析出的目标”出发，
 *       自身仅精确作用到自己）；若某模块的选择器**正常解析出自身**（kinds 含 self/any），则自身照常有溅射。
 *       本模块 kinds 为 ['enemy']，两种情形都与之无关 → 行为与既有版本完全一致。
 * 数值说明：【占位预填】duration_ticks / cooldown_ticks / energy_cost / blast_range 由用户逐级人工调校。
 */
export default {
  id: 'emp',
  nameKey: 'module.emp', // i18n -> 电磁脉冲
  name: '电磁脉冲',
  icon: 'assets/img/电磁脉冲.svg',
  category: 'function',
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 }, // 必须解析到目标才激活
  effects: {
    energy_cap_target: -1000000,   // 复用：大负值占位 = 把目标能量上限压到 0（“清空”，引擎 clamp 至 0）
    blast_range: 1,                // 复用：作用集合扩至目标队列前后各 1 个存活单位
    duration_ticks: 100,           // Lv1 占位：持续 5s
    cooldown_ticks: 200,           // Lv1 占位：间隔 10s
    energy_cost: 200,              // Lv1 占位：每次耗能
    type: ['include_self'],        // ★ 标签（非词条）：效果同时施加于自身
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { duration_ticks: 120, cooldown_ticks: 190, energy_cost: 230, blast_range: 2 } },
    { level: 10, effects: { duration_ticks: 150, cooldown_ticks: 180, energy_cost: 260, blast_range: 3 } },
    { level: 16, effects: { duration_ticks: 180, cooldown_ticks: 160, energy_cost: 300, blast_range: 4 } },
  ],
};
