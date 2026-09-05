/* ===== data/ships.js —— 船型静态配置（1 级，占位数值） =====
 * 字段说明（中文）：
 *   id            唯一标识（引擎内部引用，勿改）
 *   nameKey       显示名词条 key（对应 i18n/*.js 中的词条，如 ship.combat）
 *   slots         模块槽数量（该船可安装的模块总数）
 *   base.hp       基础血量（生命值上限）
 *   base.shieldCap  基础护盾上限（模块可在此基础上叠加）
 *   base.energyCap  能量上限（能量池容量）
 *   base.energyRegen 基础能量回复（每秒回复量）
 *   coefficients  船类系数：该船对"某类模块"效果的加成乘数
 *                  （作用于效果量乘区：伤害/回复/产出等，不影响冷却与能耗）
 */
export const SHIPS = {
  /* —— 战斗舰：主要战斗单位 —— */
  combat: {
    id: 'combat',             // 唯一标识（战斗舰）
    nameKey: 'ship.combat',   // 名称词条 key（i18n -> 战斗舰 / Combat Ship）
    slots: 3,                 // 1 级可装模块数 = 3
    base: {
      hp: 120,                // 血量上限
      shieldCap: 40,          // 基础护盾上限
      energyCap: 1000,         // 能量上限
      energyRegen: 20,         // 基础能量回复 / 秒
    },
    coefficients: {
      attack: 1,              // 攻击类模块效果系数
      shield: 1,              // 护盾类模块效果系数
      function: 1,            // 功能类模块效果系数
      transport: 0.5,         // 运输类模块效果系数
      mining: 0.5,            // 采矿类模块效果系数
    },
  },

  /* —— 运输舰：主要运输单位（M2 上场） —— */
  transport: {
    id: 'transport',          // 唯一标识（运输舰）
    nameKey: 'ship.transport', // 名称词条 key（i18n -> 运输舰 / Transport Ship）
    slots: 3,                 // 1 级可装模块数 = 3
    base: {
      hp: 120,                // 血量上限
      shieldCap: 40,          // 基础护盾上限
      energyCap: 100,         // 能量上限
      energyRegen: 5,         // 基础能量回复 / 秒
    },
    coefficients: {
      attack: 0.5,            // 攻击类模块效果系数
      shield: 1,              // 护盾类模块效果系数
      function: 1,            // 功能类模块效果系数
      transport: 1,           // 运输类模块效果系数
      mining: 0.5,            // 采矿类模块效果系数
    },
  },

  /* —— 采矿船：主要采矿单位（M2 上场；系数已按用户修正 D3） —— */
  mining: {
    id: 'mining',             // 唯一标识（采矿船）
    nameKey: 'ship.mining',   // 名称词条 key（i18n -> 采矿船 / Mining Ship）
    slots: 3,                 // 1 级可装模块数 = 3
    base: {
      hp: 120,                // 血量上限
      shieldCap: 40,          // 基础护盾上限
      energyCap: 100,         // 能量上限
      energyRegen: 5,         // 基础能量回复 / 秒
    },
    coefficients: {
      attack: 0.5,            // 攻击类模块效果系数
      shield: 1,              // 护盾类模块效果系数（Q1 待确认）
      function: 1,            // 功能类模块效果系数（Q1 待确认）
      transport: 0.5,         // 运输类模块效果系数
      mining: 1,              // 采矿类模块效果系数（本职，修正后 =1）
    },
  },
};

export default SHIPS;
