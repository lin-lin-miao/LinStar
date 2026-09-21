/* ===== data/baseBuildings/stargate.js —— 星门（基地建筑配置） =====
 * 体例：**一建筑一文件**，注册表见 `data/baseBuildings/index.js`（唯一聚合与查表口径）。
 * 字段：
 *   · `id`      唯一标识（＝文件名＝注册表键名）；
 *   · `nameKey` 名称词条 key（体例 `building.<id>`，zh-CN / en **成对**）；
 *   · `kind`    条目种类（建筑恒为 `'building'`；左列表的「舰队」不是建筑，见注册表头注释）；
 *   · `order`   **左列表顺序**（整数、全部列表项内**唯一**）；
 *   · `stage`   实装里程碑（仅用于界面显示"待实现"文案，**不是数值**）；
 *   · `maxLevel` 最大等级；
 *   · `levels[]` **完整逐级表**（level 1 .. maxLevel，每项 `{ level, cost, effect }`）——
 *     与船型 / 模块"只写差异"的体例不同：基地建筑等级少、界面要直接展示"下一级消耗"，
 *     故采用完整表；基地自检断言 `levels.length === maxLevel` 且逐项 `level === 下标 + 1`。
 *   · `placeholder` （可选）`true` ＝本阶段**未开放**（仅 `planet` 使用）。
 * 数值口径：
 *   · `cost` 的键＝`data/resources.js` 的资源键（**缺失键视为 0**）；`level:1` 的 cost 恒为 0
 *     （初始状态即已建成，不代表"建造价"）；
 *   · `effect` **只登记配置可表达的字段**，M3a 不实现任何业务逻辑，也**不编造未实现的加成**。
 * ★ 全部数值为【占位预填 · 待用户调校】。
 */
export default {
  id: 'stargate',
  nameKey: 'building.stargate',
  kind: 'building',
  order: 1,
  stage: 'M3d',
  maxLevel: 5,
  levels: [
    { level: 1, cost: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 }, effect: {} },
    { level: 2, cost: { energy: 500, ore: 0, alloy: 150, rare: 0, science: 0 }, effect: {} },
    { level: 3, cost: { energy: 1000, ore: 80, alloy: 320, rare: 10, science: 0 }, effect: {} },
    { level: 4, cost: { energy: 1800, ore: 160, alloy: 600, rare: 25, science: 0 }, effect: {} },
    { level: 5, cost: { energy: 3000, ore: 300, alloy: 1000, rare: 50, science: 0 }, effect: {} },
  ],
};
