/* ===== data/ships/drone.js —— 通用无人机（召唤单位模板 · 船型静态配置） =====
 * 结构与等级模型见 `data/ships/combat.js` 头注释（本文件同体例）。
 * 说明：这里只放"一份通用无人机数据模型"（基础三围/系数/槽位）——
 *   各具体无人机的种类差异（显示名/图标/携带模组/基础三围/系数）由各召唤模块
 *   在 `effects.summon.attrs` 里**整条覆写**设定（`createShip(typeId, side, overrides)`，
 *   `attrs` 优先级**高于**本模板、也高于等级解析结果），勿在此按种类堆叠多个船型。
 *   召唤携带的模组不受其 slots 上限约束（引擎 force 安装）。
 * ★ 等级：召唤单位统一按 **Lv1**（`createShip` 默认等级）生成 → 本模板**不预填 levels**
 *   （`maxLevel: 1`）；若将来要让召唤物随召唤方模块等级成长，在此补 `maxLevel` + `levels[]`
 *   即可（解析路径 `resolveShipAtLevel` 已就绪，引擎侧只需把等级传进 `createShip`）。
 * 数值说明：【占位预填】由用户人工调校（与拆分前完全一致）。
 */
export default {
  id: 'drone',               // 唯一标识（通用无人机）
  nameKey: 'ship.drone',     // 名称词条 key（i18n -> 无人机 / Drone；召唤单位会覆写为所属召唤模块名）
  role: 'combat',            // ★ 单位定位：召唤单位默认＝战斗单位（由召唤模块的 attrs 可覆写）
  picker: false,             // ★ 不进入编队可选列表（与 data/modules.js 的 `picker:false` 同一体例：
                             //   本模板仅供召唤模块经 effects.summon.type 使用，不是玩家可建造单位）
  slots: 3,                  // 通用槽位（召唤携带模组数量可超出此限）
  base: {
    hp: 50,                  // 血量上限（通用占位；召唤模块可用 attrs 覆写）
    shieldCap: 0,            // 基础护盾上限（占位）
    energyCap: 250,          // 能量上限（占位）
    energyRegen: 10,         // 基础能量回复 / 秒（占位）
    cargoCap: 0,             // 货舱容量（本体占位：召唤单位默认不载货）
    oreCap: 0,               // 矿物容量（本体占位）
  },
  coefficients: {
    attack: 1,
    shield: 1,
    function: 1,
    transport: 1,
    mining: 1,
    drone: 1,
  },
  maxLevel: 1, // 召唤单位按 Lv1 生成（如需成长见上方说明）
};
