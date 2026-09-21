/* ===== data/baseBuildings/commandCenter.js —— 指挥中心（基地建筑配置） =====
 * 体例与字段说明见 `data/baseBuildings/stargate.js` 头注释（本文件同体例）。
 * ★ 本建筑的 `effect` **实装字段**：
 *   · `maxFleet` —— **出战上限**（由**配置效果字段**决定，代码里**不写上限公式**；
 *     取值链＝该建筑该等级的 `levels[].effect.maxFleet`，见 `主基地框架说明.md` §4.2）；
 *     占位取值＝ 2 + 等级（Lv1 ⇒ 3 艘）【占位预填 · 待用户调校】。
 *   · 其它增益（如指挥中心的战斗加成）**M3 不实装**，故本文件**不登记**、界面只显示"待开放"
 *     （铁律：不得伪造未实现的加成）。
 * ★ 全部数值为【占位预填 · 待用户调校】。
 */
export default {
  id: 'commandCenter',
  nameKey: 'building.commandCenter',
  kind: 'building',
  order: 2,
  stage: 'M3c',
  maxLevel: 16,
  levels: [
    { level: 1, cost: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 }, effect: { maxFleet: 3 } },
    { level: 2, cost: { energy: 600, ore: 0, alloy: 200, rare: 0, science: 0 }, effect: { maxFleet: 4 } },
    { level: 3, cost: { energy: 1200, ore: 100, alloy: 400, rare: 10, science: 0 }, effect: { maxFleet: 5 } },
    { level: 4, cost: { energy: 2000, ore: 200, alloy: 700, rare: 25, science: 0 }, effect: { maxFleet: 6 } },
    { level: 5, cost: { energy: 3200, ore: 350, alloy: 1100, rare: 50, science: 0 }, effect: { maxFleet: 7 } },
  ],
};
