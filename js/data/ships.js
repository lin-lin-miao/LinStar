/* ===== data/ships.js —— 船型【聚合入口】（向后兼容转发层） =====
 * ★ 本文件已拆分：**一个单位一个文件**，统一放在 `data/ships/` 目录下：
 *     data/ships/combat.js     战斗舰
 *     data/ships/transport.js  运输舰
 *     data/ships/mining.js     采矿船
 *     data/ships/drone.js      通用无人机（召唤模板）
 *   注册表 + 等级解析唯一口径在 `data/ships/index.js`（`SHIPS` / `getShip` / `resolveShipAtLevel`…）。
 *
 * 本文件**只做转发**，保持既有导出名与导出形状**完全不变**：
 *   具名导出 `SHIPS`（id → 船型定义）与默认导出（＝ SHIPS）均与拆分前一致
 *   → 既有调用点 `import { SHIPS } from '../data/ships.js'` **零改动**。
 *   新增能力请直接从 `data/ships/index.js` 导入（或由本文件转发，见下）。
 */
export {
  SHIPS,
  SHIP_IDS,
  getShip,
  shipMaxLevel,
  resolveShipAtLevel,
  shipLevels,
} from './ships/index.js';
export { default } from './ships/index.js';
