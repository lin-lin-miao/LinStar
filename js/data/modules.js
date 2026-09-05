/* ===== data/modules.js —— 模块注册总表（index） =====
 * 组织（用户定稿 A）：每个模块一个文件 data/modules/<id>.js，
 * 本文件汇总成 MODULES 注册表。原导入路径(data/modules.js)保持不变。
 *
 * 模块文件统一结构：
 *   base 字段（Lv1）= id/nameKey/glyph/category/target/effects/maxLevel
 *   levels[]      = 高阶等级差异表（逐级绝对表；某级未填的字段回退“上一级”）。
 *   levels 每项可覆盖 effects（数值词条 + type 钩子）与 target（kinds/countMode…）。
 *
 * 铁律：模块的功能与数值一律由用户人工设定；数值只在各模块文件里维护。
 */
import cannon from './modules/cannon.js';
import regenShield from './modules/regenShield.js';
import rampCannon from './modules/rampCannon.js';

export const MODULES = {
  cannon,
  regenShield,
  rampCannon,
};

/** 模块类别展示顺序（后续 UI/筛选用）：攻击/护盾/功能/运输/采矿/无人机 */
export const CATEGORY_ORDER = ['attack', 'shield', 'function', 'transport', 'mining', 'drone'];

export default MODULES;
