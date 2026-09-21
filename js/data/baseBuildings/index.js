/* ===== data/baseBuildings/index.js —— 基地建筑注册表 + 左列表口径（唯一聚合） =====
 * 体例与 `data/ships/index.js` / `data/cargos/index.js` **一致**：**一建筑一文件**，本文件只做聚合与查表。
 *   · `BASE_BUILDINGS`    ：id → 建筑定义（**五个建筑**：星门 / 指挥中心 / 研究站 / 船坞 / 星球）；
 *   · `getBaseBuilding(id)`：按 id 取建筑定义（未知 ⇒ null）；
 *   · `BASE_LIST_ITEMS`   ：**基地屏左列表的完整口径**（按 `order` 升序）；
 *   · `BASE_LIST_ITEM_IDS`：左列表 id 列表（默认选中项＝其首项）；
 *   · `getBaseListItem(id)`：按 id 取左列表项（未知 ⇒ null）。
 *
 * ★ 左列表顺序（`order` **连续、唯一、升序 ＝ 1..5**）：
 *   1 星门 / 2 指挥中心 / 3 研究站 / 4 船坞 / 5 星球
 *
 * ★★ M3a 修订（用户口径）：**「舰队」不再是左列表项** ——
 *   舰队与「建造」同属**船坞**的职责，改由**船坞面板的两个分区**承载
 *   （分区写在 `data/baseBuildings/shipyard.js` 的 `zones`；业务属 M3b / M3c，本阶段只渲染占位）。
 *   ⇒ 左列表项 ≡ 建筑注册表（**一一对应且同序**）；本文件不再有"非建筑列表项"。
 *
 * ★ i18n 键约定（**不是配置字段**；由 `systems/base.js` 的 `snapshot()` 派生，自检 ⑥ 逐语言核对）：
 *   · 名称：`building.<id>`（＝各建筑配置里的 `nameKey`）；
 *   · ★ **面板副标题：`building.<id>.meta`** —— **每个建筑一句、互不相同**
 *     （修复"M3a 首版所有面板显示同一句等级/上限"的问题）。
 */
import stargate from './stargate.js';
import commandCenter from './commandCenter.js';
import researchStation from './researchStation.js';
import shipyard from './shipyard.js';
import planet from './planet.js';

/** 建筑注册表（id → 建筑定义；键序＝左列表顺序） */
export const BASE_BUILDINGS = {
  stargate,        // 星门（M3d）
  commandCenter,   // 指挥中心（M3c）：出战上限由 levels[].effect.maxFleet 决定
  researchStation, // 研究站（M3e）：研究位由 levels[].effect.researchSlots 决定
  shipyard,        // 船坞（M3b / M3c）：建造 + 舰队（分区见 shipyard.js 的 `zones`）
  planet,          // 星球（M4）：placeholder ⇒ 本阶段未开放；资源上限提升由 effect.resourceCap 承载
};

/** 建筑 id 列表（左列表顺序） */
export const BASE_BUILDING_IDS = Object.keys(BASE_BUILDINGS);

/** 按 id 取建筑定义（未知 ⇒ null） */
export function getBaseBuilding(id) {
  return BASE_BUILDINGS[id] || null;
}

/** ★ 基地屏左列表的**完整口径**（＝建筑注册表，按 `order` 升序；界面只遍历它，不硬编码顺序） */
export const BASE_LIST_ITEMS = BASE_BUILDING_IDS.map((id) => BASE_BUILDINGS[id]).sort((a, b) => a.order - b.order);

/** 左列表项 id 列表（按 `order` 升序；默认选中项＝其首项） */
export const BASE_LIST_ITEM_IDS = BASE_LIST_ITEMS.map((it) => it.id);

/** 按 id 取左列表项（未知 ⇒ null） */
export function getBaseListItem(id) {
  return BASE_LIST_ITEMS.find((it) => it.id === id) || null;
}

export default BASE_BUILDINGS;
