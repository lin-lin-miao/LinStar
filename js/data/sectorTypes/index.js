/* ===== data/sectorTypes/index.js —— 星区类型注册表（一类型一文件 · 只做聚合） =====
 * 体例与 `data/ships/index.js`、`data/cargos/index.js`、`data/modules.js` **完全一致**：
 *   · 类型定义文件：`data/sectorTypes/<类型 id>.js`（**文件名 ＝ 类型 id**）；
 *   · `SECTOR_TYPES`：id → 类型定义（顺序＝默认展示顺序：**恒星 → 星球 → 矿物 → 空 → 星门**）；
 *   · `SECTOR_TYPE_IDS`：id 列表（UI/遍历用，顺序同上）；
 *   · `getSectorType(id)`：按 id 取类型定义（未知返回 null，调用方自负兜底）。
 *
 * ★ 设计文档对应：§3「星区类型与特殊星区类型配置文件」 —— **基础类型**（恒星/星球/矿物/空）
 *   与**特殊类型**（星门等，一种一个文件）在本注册表内以 `kind:'basic'|'special'` 区分；
 *   **生成位置规则**＝`placement`（`center` 中心 / `ring` 圆内任意格（可选 minRadius/maxRadius）/
 *   `edges` 四方位边缘随机），**A-5 生成器只按 `placement` 驱动、不硬编码类型 id**；
 *   **数量范围**＝`count {min,max}`（默认值，可被 `data/starfields/<id>.js` 逐类型覆写）。
 * ★ 单类型字段结构（每个类型文件一致，**全部为纯数据、可 JSON 序列化**）：
 *   `id` / `nameKey`（i18n `sectorType.<id>`）/ `kind` / `placement` / `count` /
 *   `content { ore:{min,max}, cargos:{enabled,templates,count,tonsRange,levelRange}, structures:[] }` /
 *   `npcListIds`（**默认 NPC 列表引用，可配置多个**：`string[]`，生成时按种子在该集合内随机抽一个；
 *    `[]`＝无单位；**兼容读取既有单值 `npcListId`**，归一在 `data/starfieldData.js readNpcListIds`）
 *   / `specialEffect`（占位，null）/
 *   `mapColor`（**只存 CSS 变量名**，色值在 `css/base.css :root`）/ `marker`（地图标记符号占位）。
 * ★ **本文件不含任何数值/规则判断**：校验与自检在 `data/starfieldData.js`（只读、不改数据）。
 */
import star from './star.js';
import planet from './planet.js';
import mineral from './mineral.js';
import empty from './empty.js';
import stargate from './stargate.js';

/** 星区类型注册表（id → 类型定义；顺序＝默认展示顺序） */
export const SECTOR_TYPES = {
  star,      // 恒星星区：中心 · 可参战（基础）
  planet,    // 星球星区：产出星球(货物)（基础）
  mineral,   // 矿物区：储量高（基础）
  empty,     // 空区：允许完全空（基础）
  stargate,  // 星门星区：四方位边缘随机（★ 特殊类型）
};

/** 类型 id 列表（默认展示顺序；UI 遍历用） */
export const SECTOR_TYPE_IDS = Object.keys(SECTOR_TYPES);

/** 按 id 取星区类型定义（未知 → null） */
export function getSectorType(id) {
  return SECTOR_TYPES[id] || null;
}

export default SECTOR_TYPES;
