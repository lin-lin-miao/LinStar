/* ===== data/baseBuildings/researchStation.js —— 研究站（基地建筑配置） =====
 * 体例与字段说明见 `data/baseBuildings/stargate.js` 头注释（本文件同体例）。
 * ★ 本建筑的 `effect` **实装字段**：
 *   · `researchSlots` —— **研究位数量**（M3 **固定 1**，字段**预留**：将来可升级为多个研究位，
 *     见 `主基地框架说明.md` §4.5 口径 2 / §10）。逐级取值都写在配置里，代码不写死研究位数。
 *   · 研究**耗时 / 消耗 / 蓝图产出**不在此处 —— 一律写在**各货物配置**（`data/cargos/*.js`），
 *     蓝图门槛与科研点消耗写在**各模块配置**（`data/modules/<类别>/<模块>.js`）。
 * ★ 全部数值为【占位预填 · 待用户调校】。
 */
export default {
  id: 'researchStation',
  nameKey: 'building.researchStation',
  kind: 'building',
  order: 3,
  stage: 'M3e',
  maxLevel: 5,
  levels: [
    { level: 1, cost: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 }, effect: { researchSlots: 1 } },
    { level: 2, cost: { energy: 450, ore: 0, alloy: 180, rare: 0, science: 0 }, effect: { researchSlots: 1 } },
    { level: 3, cost: { energy: 900, ore: 90, alloy: 350, rare: 10, science: 0 }, effect: { researchSlots: 1 } },
    { level: 4, cost: { energy: 1600, ore: 180, alloy: 620, rare: 25, science: 0 }, effect: { researchSlots: 1 } },
    { level: 5, cost: { energy: 2600, ore: 300, alloy: 950, rare: 50, science: 0 }, effect: { researchSlots: 1 } },
  ],
};
