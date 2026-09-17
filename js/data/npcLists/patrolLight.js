/* ===== data/npcLists/patrolLight.js —— NPC 列表：轻型巡逻队（占位） =====
 * 用途：低强度巡逻（星球星区默认驻守等）；数量/等级/模块**全部占位**，待用户调校。
 * 体例：**一列表一文件**，`id` 与文件名一致；聚合与查表见 `data/npcLists/index.js`。
 * ★ `units[]` 每条＝**一批同类单位**：`{ shipId, count | countRange:[min,max], level?, modules:[{moduleId,level?}] }`
 *   · `shipId` ⇒ 既有船型注册表 `data/ships/`；`modules[].moduleId` ⇒ 既有模块注册表 `data/modules.js`
 *     （**两者都必须引用既有 id**，由 `data/starfieldData.js selfCheck()` 做存在性校验）；
 *   · 同时校验 **模块数 ≤ 该等级槽位数**（`resolveShipAtLevel(shipId, level).slots`）⇒ 避免生成时
 *     `installModule` 抛「模块槽位已满」；
 *   · ★ 不引用 `picker:false` 的内部/专属模块（弹头、维修光束等）⇒ 自检会拦。
 * ★ `side` 留占位（null）：**敌我分布属星域配置与玩法层**（`starfields/<id>.js` 的 `sideRules`），
 *   本列表**不写死阵营**（同一列表可被不同玩法分别用作敌方或友方援军）。
 * ★ 数值说明：**【占位预填 · 待用户调校】**。
 */
export default {
  id: 'patrolLight',
  nameKey: 'npcList.patrolLight', // i18n -> 轻型巡逻队 / Light Patrol
  units: [
    {
      shipId: 'combat', // 战斗舰（既有船型）
      countRange: [1, 2], // 【占位预填】1~2 艘（数量由 A-5 用种子在该区间取值 ⇒ 同种子同结果）
      level: 3, // 【占位预填】单位等级（1..16）
      modules: [
        { moduleId: 'cannon', level: 1 }, // 【占位预填】
        { moduleId: 'laser', level: 1 }, // 【占位预填】
      ], // 2 件 ≤ Lv3 战斗舰槽位 3 ⇒ 合法（自检会核对）
    },
  ],
  side: null, // 【占位】不写死阵营（见文件头）
};
