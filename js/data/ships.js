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

  /* —— 通用无人机：由召唤模块临时召唤的单位。
   * 说明：这里只放"一份通用无人机数据模型"（基础三围/系数/槽位）——
   * 各具体无人机的种类差异（显示名/图标/携带模组/基础三围/系数）由各召唤模块
   * 在 effects.summon 里覆写设定，勿在此按种类堆叠多个船型。
   * 召唤携带的模组不受其 slots 上限约束（引擎 force 安装）。
   */
  drone: {
    id: 'drone',               // 唯一标识（通用无人机）
    nameKey: 'ship.drone',     // 名称词条 key（i18n -> 无人机 / Drone；召唤单位会覆写为所属召唤模块名）
    slots: 3,                  // 通用槽位（召唤携带模组数量可超出此限）
    base: {
      hp: 50,                  // 血量上限（通用占位；召唤模块可用 attrs 覆写）
      shieldCap: 0,           // 基础护盾上限（占位）
      energyCap: 250,          // 能量上限（占位）
      energyRegen: 10,         // 基础能量回复 / 秒（占位）
    },
    coefficients: {
      attack: 1,
      shield: 1,
      function: 1,
      transport: 1,
      mining: 1,
      drone: 1,
    },
  },
};

export default SHIPS;
