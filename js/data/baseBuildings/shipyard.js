/* ===== data/baseBuildings/shipyard.js —— 船坞（基地建筑配置） =====
 * 体例与字段说明见 `data/baseBuildings/stargate.js` 头注释（本文件同体例）。
 * ★ 船坞的"可建造船型清单 / 建造与改装规则"分别由
 *   **船型配置**（`data/ships/*.js` 的 `buildable` / `buildCost` / `slotGrowth`）与
 *   **模块配置**（`data/modules/<类别>/<模块>.js` 的 `installCost` / `blueprint` 等）决定；
 *   本文件**不编造未实现的加成**（等级提升的实际效果待用户裁决后再登记）。
 * ★ 全部数值为【占位预填 · 待用户调校】。
 *
 * ★★ M3a 修订：**「舰队」并入船坞**（左列表不再有独立"舰队"项）。
 * ★★ M3b 迭代（**用户裁决：两区合并为同一张表**）：船坞面板改为**单一分区** `fleet` ——
 *   一条配置**只渲染一行**（列序：配置名称 → 单位图标 → 单位类型 → 等级 → 模块图标行 →
 *   空占位列 → 造价 → 返还 → 数量），**操作按钮另起一行**；
 *   原先"建造区 + 舰队区各自显示一遍数量 / 造价"的重复冗余已消除。
 *   `zones` 仍**只描述面板分区结构**（key / 词条键 / 里程碑 / 可选说明键），**不含业务逻辑与数值**；
 *   界面按 `zones[].key` 分派渲染（`ui/baseView.js`），**不硬编码建筑 id**。
 *   · 旧 key `build`（「建造」）保留其 i18n 词条，但**不再是分区**（配置管理已并入同一张表）。
 *
 * ★★ M3b（**船坞实装**）——`levels[].effect` 新增两个字段（**数值全在本文件，引擎不硬编码**）：
 *   · `fleetCapacity`      **舰队总容量**（所有配置的 `count` 之和不得越过它；逐级占位 5/8/12/16/20）。
 *                          ★ 口径：**船坞等级 ＝ 舰队总容量**；**指挥中心等级 ＝ 出战上限**（两者独立、互不换算）。
 *   · `scrapRefundRatio`   **拆解返还比例**（逐级占位 0.5/0.55/0.6/0.65/0.7）。
 *                          返还口径：`每资源 floor(该配置单艘累计花费 × 艘数 × 本比例)`，**不足 1 不返还**。
 *   ★ 两个字段都**逐级**给出，引擎按"取 level ≤ 目标等级的最深一项"读取（与其它建筑效果同口径）。
 */
export default {
  id: 'shipyard',
  nameKey: 'building.shipyard',
  kind: 'building',
  order: 4,
  stage: 'M3b',
  maxLevel: 16,
  /** ★ 面板分区（**仅结构**）：M3b 迭代后**只剩一个分区** —— 配置管理 + 建造 + 拆解**合并为同一张表** */
  zones: [
    { key: 'fleet', nameKey: 'building.shipyard.zoneFleet', stage: 'M3b' },
  ],
  levels: [
    { level: 1, cost: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 }, effect: { fleetCapacity: 5, scrapRefundRatio: 0.5 } },
    { level: 2, cost: { energy: 550, ore: 0, alloy: 220, rare: 0, science: 0 }, effect: { fleetCapacity: 8, scrapRefundRatio: 0.55 } },
    { level: 3, cost: { energy: 1100, ore: 100, alloy: 420, rare: 10, science: 0 }, effect: { fleetCapacity: 12, scrapRefundRatio: 0.6 } },
    { level: 4, cost: { energy: 1900, ore: 200, alloy: 750, rare: 25, science: 0 }, effect: { fleetCapacity: 16, scrapRefundRatio: 0.65 } },
    { level: 5, cost: { energy: 3100, ore: 340, alloy: 1150, rare: 50, science: 0 }, effect: { fleetCapacity: 20, scrapRefundRatio: 0.7 } },
    // ★ M3d 补齐 Lv6..Lv16（**原有 Lv1..Lv5 一字未改**）：本表必须逐级完整（自检 ② `levels.length === maxLevel`），
    //   原文件只有 5 级而 `maxLevel: 16` ⇒ **② 本来就是红的**（M3a 遗留的骨架缺口，与 M3d 逻辑无关）。
    //   补法＝沿用本文件自身已有增长：能量/矿石/合金/稀有 ×1.6 取整、容量 +4、返还比例 +0.02（≤ 1）。
    { level: 6, cost: { energy: 4960, ore: 544, alloy: 1840, rare: 80, science: 0 }, effect: { fleetCapacity: 24, scrapRefundRatio: 0.72 } },
    { level: 7, cost: { energy: 7936, ore: 870, alloy: 2944, rare: 128, science: 0 }, effect: { fleetCapacity: 28, scrapRefundRatio: 0.74 } },
    { level: 8, cost: { energy: 12698, ore: 1392, alloy: 4710, rare: 205, science: 0 }, effect: { fleetCapacity: 32, scrapRefundRatio: 0.76 } },
    { level: 9, cost: { energy: 20317, ore: 2227, alloy: 7536, rare: 328, science: 0 }, effect: { fleetCapacity: 36, scrapRefundRatio: 0.78 } },
    { level: 10, cost: { energy: 32507, ore: 3563, alloy: 12058, rare: 525, science: 0 }, effect: { fleetCapacity: 40, scrapRefundRatio: 0.8 } },
    { level: 11, cost: { energy: 52011, ore: 5701, alloy: 19293, rare: 840, science: 0 }, effect: { fleetCapacity: 44, scrapRefundRatio: 0.82 } },
    { level: 12, cost: { energy: 83218, ore: 9122, alloy: 30869, rare: 1344, science: 0 }, effect: { fleetCapacity: 48, scrapRefundRatio: 0.84 } },
    { level: 13, cost: { energy: 133149, ore: 14595, alloy: 49390, rare: 2150, science: 0 }, effect: { fleetCapacity: 52, scrapRefundRatio: 0.86 } },
    { level: 14, cost: { energy: 213038, ore: 23352, alloy: 79024, rare: 3440, science: 0 }, effect: { fleetCapacity: 56, scrapRefundRatio: 0.88 } },
    { level: 15, cost: { energy: 340861, ore: 37363, alloy: 126438, rare: 5504, science: 0 }, effect: { fleetCapacity: 60, scrapRefundRatio: 0.9 } },
    { level: 16, cost: { energy: 545378, ore: 59781, alloy: 202301, rare: 8806, science: 0 }, effect: { fleetCapacity: 64, scrapRefundRatio: 0.92 } },
  ],
};
