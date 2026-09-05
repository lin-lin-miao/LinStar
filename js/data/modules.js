/* ===== data/modules.js —— 模块注册总表（index） =====
 * 组织（用户定稿 A）：每个模块一个文件 data/modules/<id>.js，
 * 本文件汇总成 MODULES 注册表。原导入路径(data/modules.js)保持不变。
 *
 * 模块文件统一结构（base 即 Lv1）：
 *   id / nameKey / category / target / effects / maxLevel
 *   可选占位字段：icon(SVG 路径，无则显示名称首字)、name(名称降级占位)、
 *                 desc(描述降级占位，i18n 无该词条时用)。
 *   levels[]      = 高阶等级差异表（逐级绝对表；某级未填字段回退“上一级”）。
 *   levels 每项可覆盖 effects（数值词条 + type 钩子）与 target（kinds/countMode…）。
 *
 * 铁律：模块的功能与数值一律由用户人工设定；数值只在各模块文件里维护。
 * 注：regenShield/rampCannon 曾仅作测试，已按用户要求移除注册(文件留存)，不再重做。
 */
import cannon from './modules/cannon.js';
import heavyCannon from './modules/heavyCannon.js';
import laser from './modules/laser.js';
import dualLaser from './modules/dualLaser.js';
import denseBarrage from './modules/denseBarrage.js';
import laserDroneSpawn from './modules/laserDroneSpawn.js';

export const MODULES = {
  cannon,
  heavyCannon,
  laser,
  dualLaser,
  denseBarrage,
  laserDroneSpawn,
};

/** 模块类别展示顺序（后续 UI/筛选用）：攻击/护盾/功能/运输/采矿/无人机 */
export const CATEGORY_ORDER = ['attack', 'shield', 'function', 'transport', 'mining', 'drone'];

export default MODULES;
