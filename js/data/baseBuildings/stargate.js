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
 *     ★ M3d：星门的**出征费用**不在这里 —— 它按**难度档**登记在 `data/starfields/*.js` 的
 *     `deployCost`（"打哪个战区花多少"是星域口径，不是建筑等级口径）；
 *     星门建筑的升级效果**本阶段仍未实装**（`upgradeBuilding('stargate')` ⇒ `notImplemented`），
 *     故 `levels[].effect` 依旧为空对象（**不编造**加成）。
 * ★ 全部数值为【占位预填 · 待用户调校】。
 */
export default {
  id: 'stargate',
  nameKey: 'building.stargate',
  kind: 'building',
  order: 1,
  stage: 'M3d',
  maxLevel: 16,
  /** ★ 面板分区（**仅结构**；M3d 实装）：战区（难度档）列表 + 星域编号 + 出征装配表 + 出征/返回
   *  —— 渲染逻辑见 `ui/baseView.js` 的 `zone.key === 'stargate'` 分支，数值一律由引擎快照给出。 */
  zones: [
    // ★ M3d 迭代 3：**`noteKey` 已移除** —— 用户口径"星门面板内不再有说明性文字节点"，
    //   `zoneBlock()` 的 `.base-note` 不会再出现在本分区（其它分区的 `noteKey` 一律保留、未动）。
    { key: 'stargate', nameKey: 'building.stargate.zoneField', stage: 'M3d' },
  ],
  levels: [
    { level: 1, cost: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 }, effect: {} },
    { level: 2, cost: { energy: 500, ore: 0, alloy: 150, rare: 0, science: 0 }, effect: {} },
    { level: 3, cost: { energy: 1000, ore: 80, alloy: 320, rare: 10, science: 0 }, effect: {} },
    { level: 4, cost: { energy: 1800, ore: 160, alloy: 600, rare: 25, science: 0 }, effect: {} },
    { level: 5, cost: { energy: 3000, ore: 300, alloy: 1000, rare: 50, science: 0 }, effect: {} },
    // ★ M3d 补齐 Lv6..Lv16（**原有 Lv1..Lv5 一字未改**）：本表必须逐级完整（自检 ② `levels.length === maxLevel`），
    //   原文件只有 5 级而 `maxLevel: 16` ⇒ **② 本来就是红的**（M3a 遗留的骨架缺口，与 M3d 逻辑无关）。
    //   补法＝沿用本文件自身已有增长：能量 Lv2→Lv5：500/1000/1800/3000 继续 ×1.6 取整，逐级严格递增。
    { level: 6, cost: { energy: 4800, ore: 480, alloy: 1600, rare: 80, science: 0 }, effect: {} },
    { level: 7, cost: { energy: 7680, ore: 768, alloy: 2560, rare: 128, science: 0 }, effect: {} },
    { level: 8, cost: { energy: 12288, ore: 1229, alloy: 4096, rare: 205, science: 0 }, effect: {} },
    { level: 9, cost: { energy: 19661, ore: 1966, alloy: 6554, rare: 328, science: 0 }, effect: {} },
    { level: 10, cost: { energy: 31458, ore: 3146, alloy: 10486, rare: 525, science: 0 }, effect: {} },
    { level: 11, cost: { energy: 50333, ore: 5034, alloy: 16778, rare: 840, science: 0 }, effect: {} },
    { level: 12, cost: { energy: 80533, ore: 8054, alloy: 26845, rare: 1344, science: 0 }, effect: {} },
    { level: 13, cost: { energy: 128853, ore: 12886, alloy: 42952, rare: 2150, science: 0 }, effect: {} },
    { level: 14, cost: { energy: 206165, ore: 20618, alloy: 68723, rare: 3440, science: 0 }, effect: {} },
    { level: 15, cost: { energy: 329864, ore: 32989, alloy: 109957, rare: 5504, science: 0 }, effect: {} },
    { level: 16, cost: { energy: 527782, ore: 52782, alloy: 175931, rare: 8806, science: 0 }, effect: {} },
  ],
};
