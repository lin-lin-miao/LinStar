/* ===== data/modules/function/singleHanded.js —— 单枪匹马（功能 · 条件型自身系数增益） =====
 * 功能：**条件型自身增益**——当【友方存活单位中仅有自身一个】时本模块生效，**加法**提升自身单位的
 *   “攻击类”系数（`attack`），即提升其攻击类模块每次效果量的乘算基数（base 1.0 → 1.2）；
 *   条件不再满足（有友方存活单位/召唤物在场）即失效，系数即时回退到基础值。
 * 实现要点（引擎侧）：
 *   - 条件用**特殊标签 `type: ['solo']`** 标记 —— 引擎按标签识别，**不按模块 id 硬编码**；
 *   - 效果用新词条 `attack_coeff_add`（加法值，作用于自身单位的 `attack` 系数）；
 *   - 状态型模块：**无 `cooldown_ticks` / `energy_cost` / `duration_ticks`** —— 条件满足即生效、
 *     不满足即撤销；不进入“激活-触发”流程（不耗能、不进冷却、不进持续期）；
 *   - 生效判定在 Pass1 记账（读 tick 起始存活状态），**系数加减统一在 Pass2 结算阶段的
 *     “上限与系数”步骤落地**（对等性：跨单位同类修改统一顺序，镜像编队结果一致）。
 * 数值说明：【占位预填】`attack_coeff_add` 由用户逐级人工调校。
 */
export default {
  id: 'singleHanded',
  nameKey: 'module.singleHanded', // i18n -> 单枪匹马 / Single-Handed
  name: '单枪匹马',
  icon: 'assets/img/单枪匹马.svg',
  category: 'function',
  target: {
    kinds: ['self'],   // 作用于自身（增益对象＝自身单位的攻击系数）
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: ['solo'],            // ★ 条件标签：仅当友方存活单位只有自己时生效（引擎按标签识别）
    attack_coeff_add: 0.2,     // Lv1 占位：自身 attack 系数 +0.2（1.0 → 1.2）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { attack_coeff_add: 0.3 } },
    { level: 10, effects: { attack_coeff_add: 0.4 } },
    { level: 16, effects: { attack_coeff_add: 0.5 } },
  ],
};
