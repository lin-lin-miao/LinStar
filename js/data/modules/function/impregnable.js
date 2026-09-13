/* ===== data/modules/function/impregnable.js —— 固若金汤（功能 · 强制目标 + 自身受伤减免） =====
 * 功能（时长型）：激活后把**解析出的目标**（`target` 选择器 → 默认“所有敌人”）拉入针对本模块施放者的
 *   **强制攻击**状态（＝敌人被迫集火自己），持续到本模块持续时间消失。
 *   · 目标优先级：**激活锁定 > 强制目标 > 模块手动目标 > 优先自己 > 船 targetId > 全队策略**；
 *   · **多来源**：每单位维护**有序强制来源栈**（按激活先后，后激活者优先被集火）；
 *     某来源消失 → 集火对象**回落到下一个仍生效的来源**，全部消失 → 按正常优先级解析
 *     （**不恢复任何“被强制前的快照”**，也不改写被强制单位的 `targetId`）。
 *   同时获得**受伤减免**（`damage_coeff_mul`，如 `0.95` = 只承受 95% 伤害，即自己更抗打）——即本模块的
 *   收益：被集火期间自身受伤降低。该系数作用于**该单位受到的**一切伤害（血量/护盾），唯一结算点＝受伤
 *   入口（`applyHit`），故主目标命中 / 爆炸波及 / 反射返程等**所有来源**自动一并减免；
 *   **豁免**：自毁 `self_destruct_damage`（自伤）、能量削减（`energy_target` 负值）、上限类 `*_cap_target`。
 * 机制标记（`type` 标签，引擎按标签识别、**不按模块 id**）：
 *   - `force_target_self`：把 `target` 选择器解析出的每个目标拉入“强制攻击施放者”的来源栈
 *     （**不是** effects 词条，见 模块字段说明.md §2.5）。
 * 词条：
 *   - `damage_coeff_mul`：**自身受伤减免系数**（不分类别、不经 `coeff()`），需与 `duration_ticks` 搭配。
 * 落地：Pass1 只记账（`__pending.forceOps` / `__pending.coeffOps`），
 *   统一在 Pass2 结算步骤 2 / 2b 落地 → 故**下一 tick 生效**（本 tick 已开出的伤害不受影响）。
 * 数值说明：【占位预填】duration_ticks / cooldown_ticks / energy_cost / damage_coeff_mul 由用户逐级人工调校。
 */
export default {
  id: 'impregnable',
  nameKey: 'module.impregnable', // i18n -> 固若金汤 / Impregnable
  name: '固若金汤',
  icon: 'assets/img/固若金汤.svg',
  category: 'function',
  target: {
    kinds: ['enemy'],   // 强制对象＝敌方（作用集合由本选择器解析，引擎不硬编码）
    countMode: 'all',   // 所有敌人
  },
  effects: {
    // 机制标签列表（可多个；引擎按标签识别）。
    // 是否持续型一律由 `duration_ticks > 0` 判定。
    type: ['force_target_self'],
    damage_coeff_mul: 0.5,    // 目标受伤×damage_coeff_mul（Lv1 占位；缓步向 1 回补＝升级）
    duration_ticks: 400,       // Lv1 占位：持续 20s
    cooldown_ticks: 20,        // Lv1 占位：持续结束后冷却 1s
    energy_cost: 500,          // Lv1 占位：每次开启耗能
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { duration_ticks: 500, damage_coeff_mul: 0.7, energy_cost: 550 } },
    { level: 10, effects: { duration_ticks: 600, damage_coeff_mul: 0.5, energy_cost: 600 } },
    { level: 16, effects: { duration_ticks: 800, damage_coeff_mul: 0.2, energy_cost: 700 } },
  ],
};
