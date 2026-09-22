/* ===== data/baseBuildings/commandCenter.js —— 指挥中心（基地建筑配置） =====
 * 体例与字段说明见 `data/baseBuildings/stargate.js` 头注释（本文件同体例）。
 * ★ 本建筑的 `effect` **实装字段**：
 *   · `maxFleet` —— **出战上限**（由**配置效果字段**决定，代码里**不写上限公式**；
 *     取值链＝该建筑该等级的 `levels[].effect.maxFleet`，见 `主基地框架说明.md` §4.2）；
 *     占位取值＝ 2 + 等级（Lv1 ⇒ 3 艘）【占位预填 · 待用户调校】。
 *   · 其它增益（如指挥中心的战斗加成）**M3 不实装**，故本文件**不登记**、界面只显示"待开放"
 *     （铁律：不得伪造未实现的加成）。
 *
 * ★★ M3c：**升级消耗**已填**真实占位值**（逐级、非 0；结构由 `tools/patch-m3c-command-center.mjs` 生成
 *   ⇒ 想整表重铺就删掉下面的标记注释行再跑脚本；只调个别数值则直接改本文件即可）：
 *   · Lv1 ＝ 全 0（**初始等级，不收费**）；
 *   · Lv2..Lv16：能量币 ≈ `800 × 1.6^(等级 − 2)`、合金 ＝ 能量币的 40%、**Lv3 起**加稀土（10 × 1.6^(等级 − 3)）；
 *   · 逐级**严格递增**（自检 ㉛ 断言；`levels.length` 必须等于 `maxLevel`，自检 ② 断言）。
 *   ★ 升级**即时生效**（M3c 口径）：校验资源 ⇒ 扣资源 ⇒ 等级 +1 ⇒ 效果立即生效（**无队列、无耗时字段**）。
 * ★ 全部数值为【占位预填 · 待用户调校】。
 */
export default {
  id: 'commandCenter',
  nameKey: 'building.commandCenter',
  kind: 'building',
  order: 2,
  stage: 'M3c',
  maxLevel: 16,
  /* ★ M3c 费用表（【占位预填 · 待用户调校】；结构由 tools/patch-m3c-command-center.mjs 生成 —— 只调数值即可）
     口径：Lv1 免费（初始等级）；Lv2.. 能量币 ≈ 800 × 1.6^(等级 − 2)、合金 ＝ 能量币的 40%、Lv3 起加稀土；
     `effect.maxFleet` ＝ 2 + 等级（**出战上限由配置决定**，代码零公式）。 */
  levels: [
    { level: 1, cost: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 }, effect: { maxFleet: 3 } },
    { level: 2, cost: { energy: 800, ore: 0, alloy: 320, rare: 0, science: 0 }, effect: { maxFleet: 4 } },
    { level: 3, cost: { energy: 1280, ore: 0, alloy: 512, rare: 10, science: 0 }, effect: { maxFleet: 5 } },
    { level: 4, cost: { energy: 2048, ore: 0, alloy: 819, rare: 16, science: 0 }, effect: { maxFleet: 6 } },
    { level: 5, cost: { energy: 3277, ore: 0, alloy: 1311, rare: 26, science: 0 }, effect: { maxFleet: 7 } },
    { level: 6, cost: { energy: 5243, ore: 0, alloy: 2097, rare: 42, science: 0 }, effect: { maxFleet: 8 } },
    { level: 7, cost: { energy: 8389, ore: 0, alloy: 3356, rare: 67, science: 0 }, effect: { maxFleet: 9 } },
    { level: 8, cost: { energy: 13422, ore: 0, alloy: 5369, rare: 107, science: 0 }, effect: { maxFleet: 10 } },
    { level: 9, cost: { energy: 21475, ore: 0, alloy: 8590, rare: 171, science: 0 }, effect: { maxFleet: 11 } },
    { level: 10, cost: { energy: 34360, ore: 0, alloy: 13744, rare: 274, science: 0 }, effect: { maxFleet: 12 } },
    { level: 11, cost: { energy: 54976, ore: 0, alloy: 21990, rare: 438, science: 0 }, effect: { maxFleet: 13 } },
    { level: 12, cost: { energy: 87962, ore: 0, alloy: 35185, rare: 701, science: 0 }, effect: { maxFleet: 14 } },
    { level: 13, cost: { energy: 140739, ore: 0, alloy: 56296, rare: 1122, science: 0 }, effect: { maxFleet: 15 } },
    { level: 14, cost: { energy: 225182, ore: 0, alloy: 90073, rare: 1795, science: 0 }, effect: { maxFleet: 16 } },
    { level: 15, cost: { energy: 360291, ore: 0, alloy: 144116, rare: 2872, science: 0 }, effect: { maxFleet: 17 } },
    { level: 16, cost: { energy: 576466, ore: 0, alloy: 230586, rare: 4595, science: 0 }, effect: { maxFleet: 18 } },
  ],
};
