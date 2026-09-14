/* ===== data/cargos/miningRig.js —— 采矿器械（类型色＝采矿类） =====
 * 体例与 `data/modules/<类别>/<模块>.js` **完全一致**（一物一文件，注册表见 `data/cargos/index.js`）。
 *  · `colorKey: '--cat-mining'` ＝**采矿类代表色**（紫 `#b06bff`）——与采矿类模块芯片、
 *    矿渣系图标**共用同一变量**；
 *  · 数值说明：【占位预填】统一占位值＝**吨位 5t、装载时间 300t**（t＝tick，50ms/tick ⇒ 300t = 15s）；
 *    各级暂与 Lv1 相同（**结构就绪、数值待用户逐级人工调校**）。
 *  · **不写任何数值类意图**（Pass1 零数值变化）；**装载体系已实装**——由带 `cargo_loader` 标签的
 *    装载器模块把它装进单位货舱（装载完成后本件 `loadTicks` 被**永久改写**为 `CARGO_FAST_LOAD_TICKS`＝20t）。
 */
export default {
  id: 'miningRig',
  nameKey: 'cargo.miningRig', // i18n -> 采矿器械 / Mining Rig
  name: '采矿器械',
  type: 'miningRig',
  colorKey: '--cat-mining',   // ★ 类型色来源（CSS 变量名，不硬编码色值）
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
