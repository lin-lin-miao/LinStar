/* ===== data/cargos/none.js —— 无（默认货物类型 · 兜底） =====
 * 体例与 `data/modules/<类别>/<模块>.js` **完全一致**（一物一文件，注册表见 `data/cargos/index.js`）。
 *  · **默认类型 / 兜底类型**：未指定类型、或将来出现无法识别的货物形态时都落到本项；
 *  · `colorKey: '--cat-none'` ＝**灰色**（`css/base.css :root` 的 `--cat-none`，直接复用既有灰 `--text-dim`，
 *    不新造颜色）——货物文件名与类型 id 同为 `none`；
 *  · 数值说明：【占位预填】统一占位值＝**吨位 5t、装载时间 300t**（t＝tick，50ms/tick ⇒ 300t = 15s）；
 *    各级暂与 Lv1 相同（**结构就绪、数值待用户逐级人工调校**）。
 *  · **不写任何数值类意图**（Pass1 零数值变化）；**装载体系已实装**——由带 `cargo_loader` 标签的
 *    装载器模块把它装进单位货舱（装载完成后本件 `loadTicks` 被**永久改写**为 `CARGO_FAST_LOAD_TICKS`＝20t）。
 */
export default {
  id: 'none',              // 唯一标识（＝类型 id）
  nameKey: 'cargo.none',   // 名称词条 key（i18n -> 无 / None）
  name: '无',              // 中文名（词条缺失时的兜底显示）
  type: 'none',            // ★ 类型 id（＝本项 id；货物条目「类型由模板决定、不可编辑」）
  colorKey: '--cat-none',  // ★ 类型色来源＝CSS 变量名（**不在此硬编码色值**）：None ⇒ 灰
  tons: 5,                 // 吨位＝占据货仓值（★ 统一占位 5t）
  loadTicks: 300,          // 装载需要时间（tick；★ 统一占位 300t = 15s；随等级解析，界面上不可编辑）
  bonus: 1,                // 加成系数（倍率语义、中性值 1；★ 本轮仅数据承载）
  maxLevel: 16,            // 最大可用等级（与模块/船型同一等级模型）
  levels: [
    // —— 占位：各级暂与 Lv1 相同（结构就绪，逐级数值待调校） ——
    { level: 5, tons: 5, loadTicks: 300, bonus: 1 },
    { level: 10, tons: 5, loadTicks: 300, bonus: 1 },
    { level: 16, tons: 5, loadTicks: 300, bonus: 1 },
  ],
};
