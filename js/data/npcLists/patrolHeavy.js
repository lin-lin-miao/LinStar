/* ===== data/npcLists/patrolHeavy.js —— NPC 列表：重型巡逻队（占位） =====
 * 用途：高强度巡逻/守卫（H2/H3 的星球/矿物区等）；数量/等级/模块**全部占位**，待用户调校。
 * 体例：**一列表一文件**，`id` 与文件名一致；聚合与查表见 `data/npcLists/index.js`。
 * ★ `units[]` 每条＝**一批同类单位**：`{ shipId, count | countRange:[min,max], level?, modules:[{moduleId,level?}] }`；
 *   引用口径与校验见 `data/starfieldData.js selfCheck()`（存在性 / 槽位数 / 不引用 `picker:false` 模块）。
 * ★ `side` 留占位（null）：敌我分布属**星域配置与玩法层**，本列表不写死阵营。
 * ★ 数值说明：**【占位预填 · 待用户调校】**。
 */
export default {
  id: 'patrolHeavy',
  nameKey: 'npcList.patrolHeavy', // i18n -> 重型巡逻队 / Heavy Patrol
  units: [
    {
      shipId: 'combat',
      countRange: [2, 3], // 【占位预填】
      level: 8, // 【占位预填】（Lv8 战斗舰槽位 5）
      modules: [
        { moduleId: 'heavyCannon', level: 3 }, // 【占位预填】
        { moduleId: 'hardShield', level: 3 }, // 【占位预填】
        { moduleId: 'regenShield', level: 2 }, // 【占位预填】
      ], // 3 件 ≤ 5 槽 ⇒ 合法
    },
    {
      shipId: 'transport', // 补给/运输支援（占位角色）
      count: 1, // 【占位预填】固定 1 艘（`count` 与 `countRange` 二选一，引擎/A-5 两者都支持）
      level: 5, // 【占位预填】（Lv5 运输舰槽位 4）
      modules: [{ moduleId: 'cargoHold', level: 1 }], // 【占位预填】
    },
    {
      shipId: 'mining', // 随队采矿船（占位）
      countRange: [1, 2], // 【占位预填】
      level: 5, // 【占位预填】（Lv5 采矿船槽位 4）
      modules: [
        { moduleId: 'miningLaser', level: 1 }, // 【占位预填】
        { moduleId: 'oreHold', level: 1 }, // 【占位预填】
      ],
    },
  ],
  side: null, // 【占位】不写死阵营（见文件头）
};
