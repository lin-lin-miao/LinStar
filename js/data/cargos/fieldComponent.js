/* ===== data/cargos/fieldComponent.js —— 力场组件（类型色＝护盾类） =====
 * 体例与 `data/modules/<类别>/<模块>.js` **完全一致**（一物一文件，注册表见 `data/cargos/index.js`）。
 *  · `colorKey: '--cat-shield'` ＝**护盾类代表色**（`#9adcff`）——与护盾类模块芯片**共用同一变量**；
 *  · 数值说明：【占位预填】统一占位值＝**吨位 5t、装载时间 300t**（t＝tick，50ms/tick ⇒ 300t = 15s）；
 *    各级暂与 Lv1 相同（**结构就绪、数值待用户逐级人工调校**）。
 *  · **不写任何数值类意图**（Pass1 零数值变化）；**装载体系已实装**——由带 `cargo_loader` 标签的
 *    装载器模块把它装进单位货舱（装载完成后本件 `loadTicks` 被**永久改写**为 `CARGO_FAST_LOAD_TICKS`＝20t）。
 */
export default {
  id: 'fieldComponent',
  nameKey: 'cargo.fieldComponent', // i18n -> 力场组件 / Field Component
  /* ★ M3 基地侧字段【占位预填 · 待用户调校】——M3a 只铺字段，读取逻辑属 M3e（研究站）。
   * · `researchTicks`（研究耗时）与 `researchCost`（能量币；一次研究一个货物 ⇒ **无件数**）**逐级可覆写**：
   *   写进 `levels[]` 对应项即可（等级解析 resolveCargoAtLevel 会深合并整条覆盖项，
   *   未填字段自动沿用上一级）；
   * · `blueprintOutput` 蓝图产出规则：产出数量 ＝ 货物等级基础表 + 加成；
   *   `baseByLevel` 逐级基础数量表（数组项 { level, count }，未列出沿用上一项）；
   *   `bonus` 加成【占位预填 · 待用户调校】（M3 先按 0 加成 ⇒ 产出＝基础数量）：
   *   产出数量 ＝ `baseByLevel[等级].count` 经 `bonus` 加成后的结果（加成口径与实装属 M3e）；
   *   `targetModuleId` 为 null ⇒ 目标模块由「货物类型 ⇒ 模块」映射决定（映射表属 M3e）；
   * · 缺省即视为「无消耗 / 无产出」；资源键见 data/resources.js（缺失键视为 0）。 */
  researchTicks: 0,
  researchCost: { energy: 0 },
  blueprintOutput: { baseByLevel: [{ level: 1, count: 0 }], bonus: 0, targetModuleId: null },
  name: '力场组件',
  type: 'fieldComponent',
  colorKey: '--cat-shield',        // ★ 类型色来源（CSS 变量名，不硬编码色值）
  tons: 5,
  loadTicks: 300,
  bonus: 1,
  maxLevel: 16,
  levels: [
    { level: 5, tons: 5, loadTicks: 300, bonus: 1 },
    { level: 10, tons: 5, loadTicks: 300, bonus: 1 },
    { level: 16, tons: 5, loadTicks: 300, bonus: 1 },
  ],
};
