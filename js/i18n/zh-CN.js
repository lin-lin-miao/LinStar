/* ===== i18n/zh-CN.js —— 简体中文词条（当前唯一完整语言） =====
 * 所有界面可见文本都必须来自词条表，禁止在逻辑中硬编码文案。
 */
export default {
  /* 品牌 / 通用 */
  'brand': 'LinStar',

  /* 顶栏 HUD */
  'hud.tps': '{n} tick/s',
  'hud.tpsTip': '实测每秒游戏刻',
  'hud.pause': '暂停',
  'hud.resume': '继续',
  'hud.step': '逐帧',
  'hud.stepTip': '暂停时点击推进一帧',
  'hud.speed': '速度x{n}',
  'hud.export': '导出存档',
  'hud.import': '导入存档',
  'hud.lang': '语言',

  /* 主菜单 */
  'menu.title': 'LinStar',
  'menu.subtitle': '太空背景 · 增量 · 回合制网页游戏',
  'menu.start': '开始游戏',
  'menu.back': '返回主菜单', // 通用「返回主菜单」（星域配置占位页等非战斗屏使用；与 battle.menu.back 同文案、分命名空间）
  'menu.hint': '存档：右上角可导出 / 导入',

  /* 星域配置界面（步骤 S0-1＝占位页；正式实装见开发步骤 C-3） */
  'starfield.config.title': '星域配置',
  'starfield.config.todo': '待开发：后续将在此选择难度/玩法、输入随机种子（默认随机）、配置星域半径与各类型星区数量、编辑 NPC 列表，并预览、导出/导入配置。',
  'starfield.config.drillHint': '开发测试：原「编队配置（单星区模拟）」已移除界面入口，改用控制台指令 LS.drill() 打开。',

  /* 星域数据层（步骤 A-2/A-3/A-4）：星区类型名 / NPC 列表名 / 星域（难度）名
   * ★ 命名体例（由 `data/starfieldData.js selfCheck()` 核对）＝ `sectorType.<id>` / `npcList.<id>` / `starfield.<id>` */
  'sectorType.star': '恒星星区',
  'sectorType.planet': '星球星区',
  'sectorType.mineral': '矿物区',
  'sectorType.empty': '空区',
  'sectorType.stargate': '星门星区',
  'npcList.none': '无单位',
  'npcList.patrolLight': '轻型巡逻队',
  'npcList.patrolHeavy': '重型巡逻队',
  // 难度阶梯名：两语言同串（H1…Hn）；后续若要给难度加副标题，在此追加即可
  'starfield.h1': 'H1',
  'starfield.h2': 'H2',
  'starfield.h3': 'H3',

  /* 星域大地图（步骤 C-1：只读视图 + 缩放平移 + 点击选中；★ 完整战斗侧栏＝C-2）。
   * ★ 星区类型名**不在此重复**：直接用既有 `sectorType.<id>`（`data/sectorTypes/` 的 nameKey）。 */
  'starfield.map.title': '星域大地图',
  'starfield.map.back': '返回星域配置',
  'starfield.map.meta': '难度 {id} · 种子 {seed} · 半径 {r}',
  'starfield.map.remaining': '剩余 {s}s',
  // ★ 地图下方的操作说明（原 `starfield.map.hint`）已按用户口径整段移除 ⇒ 键随之删除。
  'starfield.map.legend': '图例',
  'starfield.map.legend.void': '无星区（空位）',
  'starfield.map.void': '无星区：({q}, {r})',
  'starfield.map.zoom.in': '放大',
  'starfield.map.zoom.out': '缩小',
  'starfield.map.zoom.reset': '重置视图',
  'starfield.map.resize': '拖拽调整侧栏宽度',
  /* ★ **星区显示名（唯一口径）**：`#编号 类型名（坐标）`，如 `#11 星球星区（1, -2）`。
   *   同一字符串用于**战斗屏星区栏**（`.zone-label`）与**星域地图侧栏标题**；`{n}`＝显示编号（只读 `index + 1`）。 */
  'starfield.zoneName': '#{n} {name}（{q}, {r}）',

  /* ★ C-3 星域配置界面（正式主入口）：字段标签 / 按钮 / 提示 / 校验原因 / 状态 */
  'starfield.cfg.title': '星域配置',
  'starfield.cfg.subtitle': '选择难度为基底，配置种子、半径、持续时间与各类型星区；预览无误后进入星域。种子只在本界面输入。',
  'starfield.cfg.difficulty': '难度 / 玩法',
  'starfield.cfg.difficultyHint': '切换难度会以该配置为基底重新载入编辑区（内置数据不会被修改）。',
  'starfield.cfg.seed': '种子',
  'starfield.cfg.seedRandom': '随机生成',
  'starfield.cfg.seedHint': '允许字母/数字/下划线/连字符，长度 1~32；同配置 + 同种子 ⇒ 生成结果完全一致。',
  'starfield.cfg.radius': '半径',
  'starfield.cfg.radiusHint': '圆形星域半径（≥1）；星区总数恒等于圆内格位数。',
  'starfield.cfg.duration': '持续时间（tick）',
  'starfield.cfg.durationHint': '≥1；当前约 {s} 秒（20 tps）。',
  /* ★ 玩家单位入场星区类型（`sideRules.playerEntryTypeId`；「自动」＝不写该字段 ⇒ 回退规则） */
  'starfield.cfg.entryType': '入场星区类型（玩家单位）',
  'starfield.cfg.entryTypeHint': '玩家单位生成在该类型的星区；「自动」＝不指定 ⇒ 回退「第一个四方位边缘（edges）类型」，仍无 ⇒ #1 号星区。',
  'starfield.cfg.entryAuto': '自动（回退规则）',
  'starfield.cfg.types': '星区类型（开关 / 数量区间 / 默认 NPC 列表）',
  'starfield.cfg.min': '最小',
  'starfield.cfg.max': '最大',
  'starfield.cfg.typeNpc': '默认 NPC 列表',
  'starfield.cfg.typeNpcHint': '可配置多个：生成时每个该类星区从候选集合里按种子随机抽一个；空集合＝该类型无单位。',
  'starfield.cfg.npcAdd': '添加列表',
  'starfield.cfg.npcAddHint': '新增一个候选 NPC 列表（生成时随机抽取其中之一）',
  'starfield.cfg.npcRemove': '移除该列表',
  'starfield.cfg.tagSpecial': '特殊',
  'starfield.cfg.tagFill': '填充',
  'starfield.cfg.npcReadonly': 'NPC 列表（只读摘要；上方为逐类型的候选集合覆写）',
  'starfield.cfg.npcEmpty': '无单位',
  /* ★ 玩家单位列表（我方初始编队；字段＝`playerUnits[]`，与 NPC 列表 units[] 同构） */
  'starfield.cfg.playerUnits': '玩家单位列表（我方初始编队）',
  'starfield.cfg.playerUnitsHint': '进入星域时生成在入场星区（见预览行）；阵营＝我方。每条＝船型 + 等级 + 数量 + 模块（与 NPC 列表同构）。',
  'starfield.cfg.playerUnitsEmpty': '尚未配置玩家单位：进入星域时不会生成我方初始编队（可点下方「添加单位」）。',
  'starfield.cfg.playerAdd': '添加单位',
  'starfield.cfg.playerRemove': '移除该单位',
  'starfield.cfg.playerUnitN': '单位 #{n}',
  'starfield.cfg.playerShip': '船型',
  'starfield.cfg.playerLevel': '等级',
  'starfield.cfg.playerCount': '数量',
  'starfield.cfg.playerSlots': '模块 {n}/{m}',
  'starfield.cfg.playerAddModule': '添加模块',
  'starfield.cfg.playerRemoveModule': '移除该模块',
  'starfield.cfg.playerModuleLevel': '{n} 等级',
  'starfield.cfg.playerEntry': '玩家单位将生成于 #{n} {name}（{q}, {r}）',
  'starfield.cfg.playerEntryNone': '玩家单位入场星区：无（点「预览」后显示）',
  'starfield.cfg.previewTitle': '预览生成结果',
  'starfield.cfg.preview': '预览',
  'starfield.cfg.previewNone': '尚未预览。点「预览」按当前配置与种子试算（纯函数，不创建星域）。',
  'starfield.cfg.previewError': '预览失败：{msg}',
  'starfield.cfg.previewTotal': '星区总数 {n} / 圆内格位 {cells}',
  'starfield.cfg.previewBase': '半径 {r} · 持续 {t} tick（约 {s} 秒）',
  'starfield.cfg.previewNoWarn': '无告警。',
  'starfield.cfg.ioTitle': '导出 / 导入（与内置配置同格式 JSON）',
  'starfield.cfg.export': '导出（当前编辑配置）',
  'starfield.cfg.import': '导入（JSON 文件 / 剪贴板）',
  'starfield.cfg.importBtn': '导入',
  'starfield.cfg.copy': '复制到剪贴板',
  'starfield.cfg.copied': '已复制到剪贴板。',
  'starfield.cfg.copyFail': '剪贴板写入失败：已为你选中文本，请手动复制。',
  'starfield.cfg.copyUnsupported': '剪贴板不可用：请改用「下载 JSON 文件」。',
  /* ★ ② 导出下载（主路径）/ 导入文件与剪贴板（含降级提示） */
  'starfield.cfg.download': '下载 JSON 文件',
  'starfield.cfg.downloaded': '已开始下载：{name}',
  'starfield.cfg.downloadFail': '下载失败：{msg}；可改用「复制到剪贴板」。',
  'starfield.cfg.downloadUnsupported': '下载不可用：浏览器不支持文件下载（Blob/URL）；请改用「复制到剪贴板」。',
  'starfield.cfg.importFile': '选择 JSON 文件',
  'starfield.cfg.importFileHint': '仅接受 .json（与内置配置文件同格式）；导入内容走与「进入星域」相同的校验。',
  'starfield.cfg.importClipboard': '从剪贴板导入',
  'starfield.cfg.importClipboardFail': '读取剪贴板失败（或内容不是 JSON）：请改用「选择 JSON 文件」导入。',
  'starfield.cfg.importClipboardUnsupported': '剪贴板读取不可用：请改用「选择 JSON 文件」导入。',
  'starfield.cfg.importReadFail': '读取文件失败：{msg}',
  'starfield.cfg.importFallbackHint': '文件选择与剪贴板均不可用：请在下方粘贴 JSON 后点「导入」。',
  'starfield.cfg.importParse': 'JSON 解析失败：{msg}',
  'starfield.cfg.importFail': '导入失败（当前编辑内容未改变）：',
  'starfield.cfg.importOk': '导入成功，已载入编辑区。',
  'starfield.cfg.enter': '进入星域',
  'starfield.cfg.noErrors': '配置校验通过，可以进入星域。',
  'starfield.cfg.errSeed': '种子不合法：只允许字母/数字/下划线/连字符，长度 1~32。',
  'starfield.cfg.errRadius': '半径必须是不小于 1 的整数。',
  'starfield.cfg.errDuration': '持续时间（tick）必须是不小于 1 的整数。',
  'starfield.cfg.errCount': '「{name}」的数量区间不合法：需为不小于 0 的整数且最小 ≤ 最大。',
  /* ★★ C-3b **完整 NPC 列表编辑器**（内置只读摘要 + **内嵌自定义列表可编辑**）：
   *   · 内嵌列表＝星域配置**根层** `npcLists`（与内置 `data/npcLists/*` 的 `units[]` **完全同构**）；
   *   · id 规则：**必须以 `custom:` 开头**、不得与内置 id 冲突、不得重复；
   *   · 删除规则：**默认禁止删除仍被引用的列表**（给出引用处并可一键「从这些引用中移除」）；
   *   · 引用解析：`内置 → 本配置内嵌 → 报错`（`LS.starfieldData.resolveNpcList`）。 */
  'starfield.cfg.npcSection': 'NPC 列表（内置只读摘要 / 内嵌自定义列表可编辑）',
  'starfield.cfg.npcSectionHint': '内嵌列表随星域配置**同一份 JSON** 走既有导出/导入与同一校验入口（不必对应 data/npcLists/* 文件）。',
  'starfield.cfg.npcBuiltinTitle': '内置列表（只读摘要）',
  'starfield.cfg.npcInlineTitle': '内嵌列表（可编辑；id 前必须缀 custom:）',
  'starfield.cfg.npcInlineHint': '内嵌列表随配置一同导出/导入；被星区类型的候选集合引用后按种子参与生成（与内置 id 同名时**内置优先**）。',
  'starfield.cfg.npcIdPrefixHint': 'id 规则：必须以 custom: 开头（如 custom:l1），且不得与内置列表 id 冲突。重命名请在下方该列表的「id」输入框里改，点「重命名 id」生效（会同步更新引用）。',
  'starfield.cfg.npcCreate': '新建内嵌列表',
  'starfield.cfg.npcCreateHint': '自动分配未占用的 custom:lN id，然后编辑其单位条目',
  'starfield.cfg.npcNameLabel': '列表名',
  'starfield.cfg.npcIdLabel': 'id',
  'starfield.cfg.npcRename': '重命名 id',
  'starfield.cfg.npcRenameHint': '重命名会**同步更新**所有引用它的星区类型与友方援军列表；id 仍需以 custom: 开头且不得重复/与内置冲突。',
  'starfield.cfg.npcRefs': '被 {n} 处引用：{list}',
  'starfield.cfg.npcRefsNone': '未被任何候选集合引用（不会参与生成）',
  'starfield.cfg.npcRefType': '{name}（候选列表）',
  'starfield.cfg.npcRefAlly': '友方援军列表（allyNpcListIds）',
  'starfield.cfg.npcDelete': '删除该列表',
  'starfield.cfg.npcDeleteHint': '删除前需先解除全部引用（界面不做静默解引用）。',
  'starfield.cfg.npcDeleteBlocked': '仍被 {n} 处引用：{list}',
  'starfield.cfg.npcDeleteUnref': '从这些引用中移除并删除',
  'starfield.cfg.npcDeleteUnrefHint': '把该 id 从上面每一处候选集合里摘掉，然后再删除该内嵌列表',
  'starfield.cfg.npcDeleteCancel': '取消删除',
  'starfield.cfg.npcInlineEmpty': '尚无内嵌列表：点上方「新建内嵌列表」添加（内嵌列表不必对应 data/npcLists/* 文件）。',
  'starfield.cfg.npcUnitsEmpty': '该列表暂无单位条目（生成时该星区不放单位）。',
  'starfield.cfg.npcUnitAdd': '添加单位条目',
  'starfield.cfg.npcUnitN': '条目 #{n}',
  'starfield.cfg.npcUnitRemove': '移除该条目',
  'starfield.cfg.npcUnitShip': '船型',
  'starfield.cfg.npcUnitCount': '数量',
  'starfield.cfg.npcUnitLevel': '等级',
  'starfield.cfg.npcAddModule': '添加模块',
  'starfield.cfg.previewNpcInline': '内嵌列表 {n} 个',
  'starfield.cfg.previewNpcInlineNone': '内嵌列表 0 个',
  'starfield.cfg.previewNpcInlineUsed': '被引用的内嵌列表：{list}',
  'starfield.cfg.errNpcIdEmpty': '内嵌列表 id 不能为空。',
  'starfield.cfg.errNpcIdPrefix': '内嵌列表 id 必须以 custom: 开头（如 custom:l1）。',
  'starfield.cfg.errNpcIdBuiltin': '内嵌列表 id 与内置列表冲突：{id}（内置优先，请改名）。',
  'starfield.cfg.errNpcIdDup': '内嵌列表 id 重复：{id}',
  'starfield.cfg.errNpcNameEmpty': '内嵌列表「{id}」的名称不能为空。',
  'starfield.cfg.errNpcUnitCount': '「{name}」第 {n} 条的数量必须是不小于 1 的整数。',
  'starfield.cfg.errNpcLevel': '「{name}」第 {n} 条的等级必须在 1 ~ {max} 之间。',
  'starfield.cfg.errNpcModuleLevel': '「{name}」第 {n} 条中「{mod}」的等级必须在 1 ~ {max} 之间。',
  'starfield.map.status.running': '运行中',
  'starfield.map.status.finished': '时间耗尽',
  'starfield.map.status.settled': '已结算',
  'starfield.map.status.stopped': '已停止',
  /* 单个**星区**（该区 battle 实例）的阶段文案：值＝容器只读口径 `sectors[].phase`（原样映射、不自算） */
  'starfield.phase.idle': '未开始',
  'starfield.phase.running': '运行中',
  'starfield.phase.settled': '已结算',
  /* 格上细节（按缩放层级显示）：a＝我方存活、e＝敌方存活、ore＝储量、cargo＝货物件数 */
  'starfield.cell.alive': '我{a} · 敌{e}',
  'starfield.cell.oreCargo': '矿{ore} · 货{cargo}',
  /* 格内“存活单位图标”预览的超额提示（图标上限见 `ui/starfieldMapView.js` 的 `CELL_ICON_MAX`） */
  'starfield.cell.moreAlive': '另有 {n} 个存活单位未显示',
  /* 侧栏（本轮＝星区摘要面板；C-2 在此挂载完整战斗场景） */
  'starfield.sidebar.title': '星区摘要',
  'starfield.sidebar.close': '关闭',
  'starfield.sidebar.index': '编号',
  'starfield.sidebar.coord': '坐标',
  'starfield.sidebar.type': '类型',
  'starfield.sidebar.alive': '存活单位',
  'starfield.sidebar.ore': '矿物储量',
  'starfield.sidebar.cargo': '货物件数',
  'starfield.sidebar.cd': '星区冷却',
  'starfield.sidebar.logLines': '累计战报',
  'starfield.sidebar.phase': '状态',
  'starfield.sidebar.none': '无',
  'starfield.sidebar.stageTodo': '完整战斗场景将在后续步骤（C-2）挂载于此。',
  /* ★★ 星区间移动（阶段 2 UI）：**从侧栏单位卡拖到地图格子**下达移动 ——
   * 失败提示的 `reason` 与引擎唯一写入口 `moveUnitTo` 的词表**一一对应**（UI 只做映射、不自造判据）；
   * ★ **拖到“自身所在星区” ＝ 取消移动**（成功语义，不是失败）⇒ 用 `cancelled` 短提示。 */
  'starfield.move.failed': '无法移动：{reason}',
  'starfield.move.cancelled': '已取消移动',
  'starfield.move.none': '无此单位',
  'starfield.move.dead': '该单位已阵亡',
  'starfield.move.owner': '该单位不归你指挥',
  'starfield.move.far': '版图阻断，无法抵达该星区',
  'starfield.move.invalid': '目标星区不存在',
  'starfield.move.finished': '星域已结束，无法再下达指令',
  /* 星域配置占位页：进入地图的入口（C-1） */
  'starfield.config.enterMap': '进入星域（占位）',
  'starfield.config.mapHint': '本轮（C-1）可先进入「星域大地图」查看只读地图；若尚无星域实例，将用默认配置 H1 + 随机种子创建（正式配置见 C-3）。',

  /* 存档 */
  'save.exported': '存档已导出',
  'save.imported': '存档导入成功',
  'save.importError': '存档导入失败：{err}',
  'save.exportBusy': '战斗中不可导出存档',
  'save.importBusy': '战斗中不可导入存档',
  'save.busy': '战斗中不可保存，结算完成后自动保存',
  'save.unavailable': '本地存储不可用（受限/无痕模式），仍可手动导出与导入存档。',

  /* 船舰 */
  'ship.combat': '战斗舰',
  'ship.transport': '运输舰',
  'ship.mining': '采矿船',
  'ship.drone': '无人机',
  'ship.rocket': '火箭',
  'ship.missile': '导弹',
  'ship.omegaMissile': '欧米茄导弹',
  'ship.slagMissile': '矿渣导弹',

  /* 模块 */
  'module.cannon': '火炮',
  'module.concussionCannon': '震荡炮',
  'module.heavyCannon': '大型火炮',
  'module.laser': '激光',
  'module.dualLaser': '双向激光',
  'module.denseBarrage': '密集弹幕',
  'module.laserDroneSpawn': '激光无人机',
  // ★ 无人机类（`category:'drone'`，棕色 `--cat-drone`）本轮新增 5 个召唤模块 + 1 个**无人机专属**模块
  //   （名称键一律 `module.<id>`；`repairBeam` 的 `picker:false` 使其不出现在编队可选列表中）
  'module.repairDroneSpawn': '维修无人机',
  'module.bulwarkDroneSpawn': '壁垒无人机',
  'module.rocketDroneSpawn': '火箭无人机',
  'module.laserTurretSpawn': '激光炮塔',
  'module.sentryTurretSpawn': '哨戒炮塔',
  // 无人机 · 纳米无人机：携带 火炮 + **本模块自身**（可链式召唤）；无护盾 / hp 50 / 回能 20 / 上限 500 / 存在 400t
  'module.nanoDroneSpawn': '纳米无人机',
  'module.repairBeam': '维修光束', // 功能 · **无人机专属**（picker:false）：主动单体友方（不含自身）回血 hp_target（标签 exact_amount）
  'module.rocketLauncher': '火箭发射器',
  'module.rocketWarhead': '火箭爆炸',
  'module.missileLauncher': '导弹发射器',
  'module.missileWarhead': '导弹爆炸',
  'module.omegaMissileLauncher': '欧米茄导弹发射器',
  'module.omegaMissileWarhead': '欧米茄导弹爆炸',
  'module.slagMissileLauncher': '矿渣导弹发生器', // 采矿 · 召唤矿渣导弹（**只耗自身携带矿物 ore_cost**、不耗能）
  'module.slagMissileWarhead': '矿渣导弹爆炸', // 内部：矿渣导弹携带的爆炸弹头（picker:false）
  'module.reactorCoil': '强辐线圈',
  'module.shieldBattery': '护盾电池',
  'module.hullArmor': '船体装甲',
  'module.recycle': '回收利用',
  'module.energyTransfer': '能量输送',
  'module.oreTransfer': '矿物输送', // 采矿 · 主动单体友方（把自身携带矿物 **1:1** 输送给目标 ore_target）
  'module.cargoHold': '货舱',
  'module.loadingBeam': '装载光束', // 运输 · 主动无目标（标签 cargo_loader + 词条 cargo_load：把星区货物装进本舰货舱）
  'module.cargoTransfer': '货物传输', // 运输 · 主动单体友方（标签 cargo_transfer：把**整件已入舱货物**原样搬运给目标）
  'module.cargoRepair': '货物维修', // 运输 · 主动单体友方含自身（标签 cargo_repair：消耗**整件已入舱货物**换回血 hp_per_ton）
  'module.navThruster': '航行推进器', // 运输 · 常驻增幅器（自身**航行系数** nav_coeff_add ⇒ 星区间移动的航行引擎冷却）
  'module.oreHold': '矿舱',
  'module.miningLaser': '采矿激光',
  'module.oreCompressor': '矿物压缩', // 采矿 · 常驻增幅器（自身采矿系数 mining_coeff_add）
  'module.oreRepair': '矿物维修', // 采矿 · 主动单体友方（含自身；耗自身矿物 ore_cost 修复目标 hp_target，量值按词条原值）
  'module.cargoEnhance': '货物强化', // 采矿 · 主动单体友方含自身（耗矿+耗能，把目标货舱**一件尚未被强化**的货物 bonus 加性提高 bonus_add；一次性永久；标签 cargo_enhance）
  'module.genesis': '创世纪', // 采矿 · 无目标主动（星区剩余储量**加法** sector_ore_add）
  'module.oreEnrichment': '矿藏富集', // 采矿 · 无目标主动（星区剩余储量**乘法** sector_ore_mul）
  'module.emp': '电磁脉冲',
  'module.alphaShield': '阿尔法护盾',
  'module.regenShield': '再生护盾',
  'module.hardShield': '硬化护盾',
  'module.reflectShield': '反射护盾',
  'module.allianceShield': '同盟护盾',
  'module.blastShield': '防爆护盾',
  'battle.detail.longShield': '长期护盾池',
  'module.shieldSuppressor': '护盾抑制器',
  'module.singleHanded': '单枪匹马',
  'module.impregnable': '固若金汤',
  'module.timeWarp': '时间扭曲',
  'module.slowTime': '放缓时间',
  'module.overload': '辐能过载',
  'module.stealth': '潜行',

  /* 货物类型名（`data/cargos/*.js` 的 `nameKey`；类型名即默认货物名，实例自定义 `name` 时不再使用） */
  'cargo.none': '无',
  'cargo.weaponPart': '武器零件',
  'cargo.fieldComponent': '力场组件',
  'cargo.functionDevice': '功能设备',
  'cargo.droneDebris': '机骸碎片',
  'cargo.miningRig': '采矿器械',
  'cargo.freightBlueprint': '货运蓝图',

  /* 单位系数栏（详情页 · 模块字段之前） */
  'battle.detail.coeffs': '单位系数',
  'battle.coeff.attack': '攻击系数',
  'battle.coeff.shield': '护盾系数',
  'battle.coeff.function': '功能系数',
  'battle.coeff.transport': '运输系数',
  'battle.coeff.mining': '采矿系数',
  'battle.coeff.drone': '无人机系数',
  // ★ 航行系数（`coefficients.nav`）：与上面的类别系数**同列同体例**（该行由系数集合自动生成）
  'battle.coeff.nav': '航行系数',
  // ★ 单位系数栏（详情页）：**只放数值、不放任何解释性文案**（基础值/口径说明/预留说明一律不显示）。
  //   `mulRow` 为预留项（当前无词条映射 → 显示“无”）；`takeMul`＝受伤减免（×值）；
  //   `timeCoeff`＝时间系数（负＝加速 / 正＝放缓；计时器需求量 = 基础量 ×(1+系数)，取整）。
  'battle.coeff.mulRow': '其它系数',
  'battle.coeff.takeMul': '受伤减免',
  'battle.coeff.timeCoeff': '时间系数',
  'battle.coeff.none': '无',

  /* 对战场景 */
  'battle.title': '对战场景',
  'battle.drill.title': '演练编队配置',
  'battle.drill.hint': '双方皆可添加各类单位、设置单位等级与定位（战斗/后勤），并为每单位装配/卸除模块，点“开战”进入对局。',
  'battle.fleet.ally': '我方编队',
  'battle.fleet.enemy': '敌方编队',
  'battle.drill.addShip': '＋ 添加单位',
  'battle.drill.removeShip': '移除该舰',
  'battle.drill.addModule': '＋ 添加模块…',
  'battle.drill.removeModule': '移除该模块',
  'battle.drill.levelOf': '模块 {n}：选择等级',
  'battle.drill.fullSlots': '模块槽位已满',
  'battle.drill.start': '开战',
  'battle.drill.shipType': '添加单位：选择类型',
  'battle.drill.shipLevel': '单位 {n}：选择等级',
  'battle.drill.role': '单位定位',
  'battle.drill.role.combat': '战斗单位',
  'battle.drill.role.logistics': '后勤单位',
  'battle.drill.slots': '模块 {n}/{m}',
  // 星区（战斗场景）设定：名称＝用户自定义字符串（**原样提交/显示、不做 i18n**）；储量＝非负整数
  'battle.drill.sector': '星区设定',
  'battle.drill.sectorName': '星区名称',
  'battle.drill.sectorNamePh': '（留空则不显示名称）',
  'battle.drill.sectorOreLabel': '矿物储量',
  'battle.drill.sectorOreInvalid': '矿物储量须为 0 或正整数',
  // 星区设定·**货物设定**：类型（None + 6 种零件）+ 数量批量添加；逐条可改名称/吨位/等级
  // （类型由所选类型决定、**不可编辑**；**装载时间随等级解析、不可编辑**）
  'battle.drill.cargoTitle': '星区货物',
  'battle.drill.cargoTplLabel': '类型',
  'battle.drill.cargoCountLabel': '数量',
  'battle.drill.cargoAdd': '添加货物',
  'battle.drill.cargoEmpty': '（暂无货物）',
  'battle.drill.cargoName': '货物名称',
  'battle.drill.cargoType': '类型',
  'battle.drill.cargoTons': '吨位',
  'battle.drill.cargoLevel': '等级',
  'battle.drill.cargoLoad': '装载 {s}s',
  'battle.drill.cargoRemove': '移除该货物',
  'battle.drill.cargoRemoveBtn': '移除',
  'battle.drill.cargoTonsInvalid': '吨位须为 0 或正整数',
  'battle.drill.cargoLevelInvalid': '等级须为 1 至 {max} 的整数',
  'battle.drill.cargoCountInvalid': '数量须为 1 或正整数',
  'battle.drill.blocked': '存在无效配置，无法开战',
  'battle.drill.warn.title': '配置存在问题（{n} 项），修正后方可开战：',
  'battle.drill.warn.slotOverflow': '模块数超出该等级槽位（上限 {n}），请卸除多余模块或提高单位等级',
  'battle.drill.warn.levelClamped': '单位等级超出上限，已按 Lv{n} 计',
  'battle.drill.warn.moduleLevelClamped': '模块等级超出上限，已按 Lv{n} 计',
  'battle.drill.warn.invalid': '存在无效条目（未知船型/模块），将被忽略',
  // 星区货物侧告警（引擎唯一口径 `normalizeSectorCargos` 产出，`side` 恒为 'sector'）
  'battle.drill.warn.cargoInvalid': '星区货物存在无效条目，将被忽略',
  'battle.drill.warn.cargoUnknownTemplate': '未知货物类型（{id}），将被忽略',
  'battle.drill.warn.cargoCountClamped': '货物数量超出允许范围，已按 {n} 计',
  'battle.drill.warn.cargoClamped': '货物{field}超出允许范围，已钳制为 {to}',
  // ★ 原 `battle.drill.warn.cargoOverflow`（星区货物总数超上限已截断）已**随总件数上限的取消删除**
  //   （用户口径：编队定义与运行时都不封顶 ⇒ 引擎不再产生该告警码；删除而非保留，避免留下永不触发的死文案）
  'battle.zone.enemy': '敌方战斗单位',
  'battle.zone.enemyLogistics': '敌方后勤单位',
  'battle.zone.combat': '我方战斗单位',
  'battle.zone.logistics': '我方后勤单位',
  'battle.zone.command': '指挥栏',
  // 星区资源栏（指挥栏下方独立一栏）：栏目标题无名称时用「星区」；行标签＝矿物储量（剩余/初始）
  'battle.zone.sector': '星区',
  'battle.sector.ore': '矿物储量',
  'battle.sector.line': '星区：{name}',
  // 星区冷却组（储量条**上方**的独立小节标题）：组内每模块一行，**仅冷却中显示**、就绪隐藏
  'battle.sector.cdTitle': '星区冷却',
  // 星区资源栏·星区冷却行（每个星区冷却模块各一行，**仅在冷却中显示**）：剩余冷却 tick 数
  'battle.sector.cd': '冷却 {n}t',
  // ★ 星区资源栏·**星区货物**小节（与星区冷却组**并排**的独立区块）：每件货物一个小芯片
  //   （**高度固定 32px**），边框色＝**类型色**；点击＝加入/移出**优先队列**（选中态＝边缘发光+内部填充）。
  //   芯片＝**六段独立元素**（各段各自成元素、各用一条短模板，**不拼成长串**），视觉顺序：
  //     `[cargoSeq 序号列] 名称 [· cargoBonus 加成%] [· cargoLv 等级] [· cargoMeta 吨位·装载秒] [末尾填充]`
  //     · cargoSeq   优先队列序号（1 起；**未入队留空占位**、定宽 ⇒ 入队/取消不跳动）；
  //     · 名称段     用户名称或类型名词条 `nameKey`（无模板，名称即数据）；
  //     · cargoBonus **加成增量百分比**（`bonus` 是倍率：1 → 整段不显示、1.1 → `10%`）；
  //     · cargoLv    等级（**仅等级 ≠ 1 时显示**该段）；
  //     · cargoMeta  吨位 · 装载秒数（末段文字）；
  //     · 末尾填充   与序号列**同宽**的占位格：**该货物已被「货物强化」强化过**（引擎只读口径
  //                  `cargo.enhanced`）时在其中显示**语言无关徽标 `※`**（字符为 JS 常量、不走 i18n；
  //                  无悬停文案键 cargoEnhanced ⇒ 悬停显示「已强化」），否则该格**保持空占位** ——
  //                  宽度口径不变 ⇒ **芯片宽度与文字位置不跳动**。
  'battle.sector.cargoTitle': '星区货物',
  'battle.sector.cargoSeq': '{n}',
  'battle.sector.cargoBonus': '{v}%',
  'battle.sector.cargoLv': 'Lv{level}',
  'battle.sector.cargoMeta': '{tons}t · {load}s',
  'battle.sector.cargoHover': '{type}：{hint}',
  'battle.sector.cargoAddHint': '点击加入优先队列',
  'battle.sector.cargoRemoveHint': '点击移出队列',
  'battle.sector.cargoLockedHint': '装载中：剩余约 {s}s', // 被装载器锁定（引擎派生 locked）时的悬停提示；剩余秒数＝formatTickSeconds(需求−已推进)；此时点击无效
  // ★ **玩家手动卸载**（引擎只读派生字段 `manualUnloaded` + `manualUnloadedTicks`）时的悬停提示：
  //   `{s}`＝**剩余有效秒数**（引擎派生 `manualUnloadedTicks` → `core/tick.js formatTickSeconds`，
  //   UI **不自算到期**）；说明“本阵营装载器暂时不会自动把它装回去、点击入队即可立即再装”
  //   （仅在「未入队且未在装载」时替换 cargoAddHint）。
  'battle.sector.cargoHoldHint': '已手动卸载：{s}s 内不会被自动装载（点击入队可再装）',
  // ★ 「已强化」徽标（`※`，语言无关符号，字符由 UI 常量提供、**不占 i18n 键**）的**悬停说明**：
  //   只在货物 `enhanced === true` 时挂到**末尾占位格**上（最短新键；不含 `{v}`，与数值无关）。
  'battle.sector.cargoEnhanced': '已强化',
  'battle.command.fleet': '全队主要目标',
  'battle.command.preview': '当前命中：{name}',
  'battle.command.noTarget': '（无存活目标）',
  'battle.policy.order': '顺序',
  'battle.policy.lowestHp': '最低血量',
  'battle.policy.lowestShield': '最低护盾',
  'battle.policy.droneFirst': '优先无人机',
  'battle.policy.shipFirst': '优先舰船',
  'battle.side.ally': '我方',
  'battle.side.enemy': '敌方',
  'battle.hp': 'HP',
  'battle.shield': '护盾',
  'battle.energy': '能量',
  'battle.cargo': '货物',
  'battle.ore': '矿物',
  'battle.cargo.breakdown': '本体 {base} + 模块 {modules}',
  'battle.unit.ally': '我方{type}',
  'battle.unit.enemy': '敌方{type}',
  'battle.unit.focus': '目标：{name}',
  'battle.unit.focusNone': '目标：—',
  'battle.log.title': '战报',
  'battle.log.start': '战斗开始',
  /* —— 命中/溅射成句（逐吸收段，模块名渲染绿；{dtype} 为伤害类型） —— */
  'battle.log.hit.fire': '{actor}的{weapon}开火命中{target}',
  'battle.log.hit.blast': '{actor}的{weapon}爆炸命中{target}',
  'battle.log.hit.splash': '{actor}的{weapon}溅射到{target}',
  'battle.log.hit.absorb': '，对{abs}造成{amount}点{dtype}伤害',
  'battle.log.hit.reflect': '{owner}的{module}反射{amount}点伤害给{attacker}',
  'battle.log.empParalyze': '{actor}的{module}使{target}瘫痪',
  'battle.abs.base': '舰载护盾',
  'battle.abs.hull': '舰体',
  'battle.abs.alliance': '共享同盟护盾',
  'battle.abs.blastproof': '共享防爆护盾',
  'battle.dmgType.projectile': '动能',
  'battle.dmgType.beam': '能量',
  'battle.dmgType.explosive': '爆炸',
  'battle.dmgType.normal': '普通',
  'battle.dmgType.reflect': '反射',
  'battle.log.summon': '{ship} 召唤了 {unit}',
  'battle.log.tempExpired': '{ship} 到达存在时间自动消失',
  'battle.log.selfDestruct': '{ship} 引爆自毁',
  'battle.log.shieldBreak': '{ship} 的 {module} 护盾被击破',
  'battle.log.destroyed': '{ship} 被击毁',
  'battle.result.win.title': '胜利',
  'battle.result.win.desc': '敌方战斗单位已被全歼',
  'battle.result.lose.title': '失败',
  'battle.result.lose.desc': '我方战斗单位已被全歼',
  'battle.result.draw.title': '平局',
  'battle.result.draw.desc': '双方单位全部阵亡',
  'battle.restart': '再来一场',
  'battle.leave': '离开',
  'battle.leave.title': '结束本场战斗并返回编队配置界面',
  'battle.menu.back': '返回主菜单',

  /* 战斗交互（M1 增强） */
  'battle.phase.idle': '待命',
  'battle.phase.running': '对战中',
  'battle.phase.settled': '已结算',
  'battle.status': '阶段：{phase} ｜ 我方存活 {ally} ／ 敌方存活 {enemy}',
  'battle.act.fireReady': '开火就绪',
  'battle.act.fireCool': '开火 · {n}t 后',
  'battle.act.regen': '回复护盾',
  'battle.act.regenCool': '回复护盾 · {n}t 后',
  'battle.act.cooling': '冷却中 · {n}t',
  'battle.act.buffing': '效果持续 {n}t',
  'battle.act.buffReady': '可激活',
  'battle.act.shieldFull': '护盾已满',
  'battle.act.noEnergy': '能量不足',
  'battle.act.idle': '待机',
  'battle.act.dead': '已击毁',
  'battle.intent': '下一步：{act}',
  'battle.lifeLeft': '存活 {n}s',
  /* ★★ 航行引擎（单位「星区间移动」；阶段 2 UI）——单位卡竖条 + 详情面板 + 排队标记。
   * ★ 数值/判据一律来自容器只读口径 `unitNav()`（剩余/暂停/排队目标），**UI 不自算**；
   * ★ **航行系数不在此处**：它已归位到「单位系数」区（`coefficients.nav` ⇒ `battle.coeff.nav`）。 */
  'unit.nav': '航行引擎',
  'unit.navReady': '就绪',
  'unit.navRemain': '剩余 {s}s',
  'unit.navStalled': '能量不足',
  'unit.navQueued': '排队前往 #{n}',
  'unit.navQueueMark': '⇥#{n}',
  'unit.navCd': '本步冷却 {n}t',
  /* ★ 被选单位在移动中“消失”（阵亡/被移出场景）⇒ 收起详情并给一次短提示（不报错） */
  'starfield.follow.lost': '所选单位已不在星域中',
  'battle.detail.empty': '点击场景中的单位查看详情',
  'battle.detail.slots': '模块槽 {n}',
  'battle.detail.modules': '模块',
  'battle.detail.noModules': '未安装模块',
  'battle.detail.costCycle': '耗能 {n} · 每 {cd}t',
  'battle.detail.costCycleDur': '耗能 {n} · 持续 {d}t + 冷却 {cd}t',
  // ★ 含「矿物成本」（`ore_cost`）的模块：成本段与周期段**分别成词、按需拼接**（最短体例）——
  //   好处：① 不会出现“耗能 0”的误导；② `costCycle`/`costCycleDur` 原样保留，
  //   不含矿物成本的既有模块文案**逐字不变**（零回归）。
  'battle.detail.costOre': '耗矿 {n}',
  'battle.detail.costEnergy': '耗能 {n}',
  'battle.detail.perCycle': '每 {cd}t',
  'battle.detail.perCargo': '每件货物', // 装载器（`cargo_loader`）：无自身冷却，周期＝一次完整装载
  'battle.detail.perCycleDur': '持续 {d}t + 冷却 {cd}t',
  'battle.detail.cooling': '冷却 {n}t',
  'battle.detail.loading': '装载中 {done}/{need}t', // 装载器在装（进度/需求 tick 均来自引擎只读判据 cargoLoadingOf）
  'battle.detail.ready': '就绪',
  'battle.detail.stateActive': '生效中',
  'battle.detail.stateInactive': '条件未满足',
  'battle.detail.stateCost': '状态型',
  'battle.detail.noEnergy': '能量不足',
  'battle.detail.regen': '回复中',
  'battle.detail.full': '护盾已满',
  'battle.detail.target': '主要攻击目标',
  'battle.detail.auto': '按自动策略',
  'battle.detail.following': '跟随全队[{policy}] → {name}',
  'battle.detail.autoOwn': '自动[{policy}] → {name}',
  'battle.detail.autoPolicy': '自动策略',
  'battle.detail.followFleet': '跟随全队',
  'battle.detail.targetLocked': '目标锁定：{name}（不可更改）',
  'battle.detail.lockGone': '已阵亡',
  'battle.detail.moduleTarget': '模块目标',
  'battle.detail.moduleFollow': '跟随船舰（默认）',
  'battle.detail.targetInfoMulti': '自动选择：按全队策略取前 {n} 个目标',
  'battle.detail.targetInfoAll': '自动选择：命中全部敌方单位',
  'battle.detail.targetSelf': '目标：自身',
  'battle.detail.manualTag': '（手动）',
  'battle.detail.lockTag': '（已锁定）',
  'battle.detail.lockNote': '锁定中：本次持续期内不切换目标（新选择于下次激活生效）',
  'battle.detail.targetLockPending': '锁定中：已记录新目标，将于下次激活生效',
  'battle.detail.targetLockedGone': '（锁定目标已阵亡，等待下次激活重新选目标）',
  'battle.detail.targetCurPrefix': '命中目标：',
  'battle.detail.curNone': '（无可用目标，本次不激活）',
  'battle.detail.buffing': '效果持续 {n}t',
  'battle.detail.disable': '停用',
  'battle.detail.enable': '启用',
  // 「不可停用」标签（`undeactivatable`）：开关灰显时的悬停说明（引擎判据 `moduleUndeactivatable`）
  'battle.detail.undeactivatable': '该模块不可停用',
  'battle.detail.disabled': '已停用',
  'battle.detail.ended': '战斗已结束，操作锁定（仅可浏览）',
  'battle.detail.aiGear': '模块 AI 策略（开发中预留入口）',
  'battle.detail.statDamage': '伤害 {n}/次',
  'battle.detail.statAttackCoeff': '攻击系数 {v}',
  'battle.detail.statAttackCoeffT': '目标攻击系数 {v}',
  'battle.detail.statHpBelow': '血量 ≤{v}%',
  'battle.detail.statDamageCoeffMul': '受到伤害 ×{v}',
  'battle.detail.statDamageCoeffMulT': '目标受到伤害 ×{v}',
  'battle.detail.statRamp': '每次激活 +{r} · 上限 {c}',
  'battle.detail.statTimeCoeff': '时间系数 {v}',
  'battle.detail.statBlast': '爆炸范围 {n}',
  'battle.detail.statInvincible': '无敌 {n}t',
  'battle.detail.statRegen': '回盾 {n}/次',
  'battle.detail.statOreGain': '采矿量 {n}/次', // 采矿激光：每次激活的采矿量（× 采矿系数后取整）
  'battle.detail.statCargoLoad': '装载速度 {v}', // 装载光束：装载速度加成原值（速度 = 1 + 本值 + (运输系数 − 1)）
  'battle.detail.cargos': '装载货物', // 详情页「装载货物」栏（单位系数区块下方：已入舱货物芯片）
  'battle.detail.cargoUnloadHint': '点击返还星区', // 该栏货物芯片的悬停提示（点击＝引擎唯一返还接口）
  'battle.detail.statMiningCoeff': '采矿系数 {v}', // 矿物压缩：自身采矿系数加性（不加取整、不乘船级系数）
  'battle.detail.statSectorOreAdd': '星区矿物 {v}/次', // 创世纪：星区剩余储量加法（绝对增量、无上限）
  'battle.detail.statSectorOreMul': '星区矿物 ×{v}/次', // 矿藏富集：星区剩余储量乘法（展示实际乘数 1+比例）
  'battle.detail.statOreT': '目标矿物 +{n}', // 矿物输送：1:1 输送给目标的矿物量（**不乘任何系数**，原样显示）
  'battle.detail.statCargoTransfer': '传输 1 件货物', // 货物传输：整件搬运（无数值词条 ⇒ 只显示粒度）
  'battle.detail.statHpPerTon': '每吨回血 {v}', // 货物维修：`hp_per_ton`（词条原值、不乘类别系数；回血＝吨位×本值）
  'battle.detail.statBonusAdd': '加成 {v}%', // 货物强化：`bonus_add`（词条原值、不乘类别系数；**增量**走唯一换算 formatBonusDeltaPercent，自带正负号 ⇒ 模板不写 `+`）
  'battle.detail.statCap': '护盾上限 +{n}',
  // ★ 自身常驻静态加成（增幅器类自身词条）：只放数值（无机制说明句）
  //   ★ 能量上限可**取负**（护盾电池的代价）→ 统一用带符号数值 {v}（fmtSigned 渲染 +N / −N）。
  'battle.detail.statHpCapBonus': '血量上限 {v}',
  'battle.detail.statEnergyCapBonus': '能量上限 {v}',
  'battle.detail.statEnergyRegenBonus': '能量恢复 {v}/s',
  'battle.detail.statCargoCapBonus': '货物容量 {v}',
  'battle.detail.statOreCapBonus': '矿物容量 {v}',
  // 自身护盾系数加性（`shield_coeff_add`，与既有 `attack_coeff_add` 的显示体例一致）
  'battle.detail.statShieldCoeff': '护盾系数 {v}',
  // 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：只放数值
  'battle.detail.statHpRegenPerDeath': '每阵亡单位恢复 {n}',
  'battle.detail.statShieldT': '目标护盾 {v}',
  'battle.detail.statCapT': '目标护盾上限 {v}',
  'battle.detail.statCapClear': '清空目标护盾上限',
  'battle.detail.statHpT': '目标血量 {v}',
  'battle.detail.statHpCapT': '目标血量上限 {v}',
  'battle.detail.statHpCapClear': '清空目标血量上限',
  'battle.detail.statEnergyT': '目标能量 {v}',
  'battle.detail.statEnergyCapT': '目标能量上限 {v}',
  'battle.detail.statEnergyCapClear': '清空目标能量上限',
  // ★ 自身单体模块（`target.kinds === ['self']`，如「潜行」）：上限类词条的作用对象就是自己 → “自身”措辞
  'battle.detail.statEnergyCapClearSelf': '清空自身能量上限',
  'battle.detail.targetForced': '被强制攻击：{name}',
  'battle.detail.statDuration': '持续 {n}t',
  'battle.detail.statSummon': '召唤 {type} · 存活上限 {n} · 时长 {t}t',
  'battle.detail.contrib.dmg': '本场贡献：总伤害 {dmg} · DPS {dps} · 激活 {act} 次',
  'battle.detail.contrib.regen': '本场贡献：总回复 {amt} · {rate}/秒 · 激活 {act} 次',
  'battle.detail.contrib.latestDmg': '本击伤害 {n}',
  'battle.detail.contrib.latestShield': '本次回盾 {n}',
  'battle.detail.locked': '锁定目标：{name}',
  'battle.detail.targetIs': '当前目标：{name}',
  'battle.detail.noControl': '（敌方单位，无法指定其目标）',
  'battle.detail.noTargets': '（无存活目标）',
  'battle.log.retarget': '{ship} 将主要攻击目标设为 {target}',
  'battle.log.autoTarget': '{ship} 改为跟随全队目标',
  'battle.log.moduleOff': '{ship} 停用了模块：{module}',
  'battle.log.moduleOn': '{ship} 启用了模块：{module}',
  'battle.log.moduleFollow': '{ship} 的模块「{module}」恢复跟随船舰目标',
  'battle.log.aiPlaceholder': '模块 AI 策略（{module}）将在后续版本开放',
  'battle.log.forceTarget': '{actor} 的 {module} 生效：{n} 个目标被强制攻击它',
  'battle.log.forceFallback': '{owner}的{module}强制效果结束：{n}个单位的集火对象回落至其它仍生效的来源',
  'battle.log.forceRelease': '{owner}的{module}强制效果结束：{n}个单位恢复按正常优先级选择目标',
  'battle.log.hastenStart': '{owner}的{module}开始加速：{n}个单位',
  'battle.log.hastenEnd': '{owner}的{module}加速结束：{n}个单位',
  'battle.log.slowStart': '{owner}的{module}开始减速：{n}个单位',
  'battle.log.slowEnd': '{owner}的{module}减速结束：{n}个单位',
  // ★ 潜行（`type` 标签 `stealth`）：低频聚合（仅状态翻转各一条、带模块拥有者；标记类不做高频播报）
  'battle.log.stealthStart': '{owner}的{module}生效：{n}个单位进入潜行',
  'battle.log.stealthEnd': '{owner}的{module}潜行结束：{n}个单位',
  // ★ 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：**低频**——必须有阵亡才会出现，
  //   且仅“实际回血 > 0”时每 tick 每模块至多一条；带模块拥有者。
  'battle.log.recycleRegen': '{owner}的{module}回收利用：阵亡 {n} 个单位，恢复 {amount} 点生命',
  // ★ 采矿 / 星区储量类**低频战报**（成句体例：`{owner}的{module}：…`，owner 着色、module 恒绿）：
  //   · `miningGain`：每次激活**实际入库量 > 0** 才记；按**模块实例**聚合成一条（每实例每 tick ≤ 1 条）；
  //   · `sectorOreAdd`：仅实际增量 > 0 时记（`n`＝该条实际增量，已乘采矿系数）；
  //   · `sectorOreMul`：仅该条真正改变储量时记（`mul`＝实际乘数如 1.1、`n`＝该条落地前后差值）。
  'battle.log.miningGain': '{owner}的{module}：采集 {n} 点矿物',
  'battle.log.sectorOreAdd': '{owner}的{module}：星区矿物 +{n}',
  'battle.log.sectorOreMul': '{owner}的{module}：星区矿物 ×{mul}（+{n}）',
  // ★ 矿物输送（`ore_target`，1:1）：低频——**仅在实际输送量 > 0** 时记一条（`n`＝实际转移量，非请求量），
  //   每模块每 tick 至多 1 条（单次激活只产生一条输送记录）；成句在结算步骤 3d-2 的**落地处**（与数值同批）；
  //   owner/target 着色、module 恒绿。与「能量输送」（不记战报）不同：矿物是**成对搬运**的可见资源。
  'battle.log.oreTransfer': '{owner}的{module}：输送 {n} 点矿物给 {target}',
  // ★ 治疗型「矿物成本」模块（`ore_cost` + 治疗 `hp_target`，如「矿物维修」）：低频——**仅在实际回血量 > 0** 时记，
  //   每模块每 tick 至多 1 条；`n`＝**实际扣矿量**、`amount`＝**实际回血量**（含 hpMax 截断，口径唯一）；
  //   owner/target 着色、module 恒绿；成句在结算步骤 4c 的**回血落地处**（与数值同批）。
  'battle.log.oreRepair': '{owner}的{module}：消耗 {n} 点矿物，修复 {target} {amount} 点生命',
  // ★ 货物传输（`cargo_transfer`）：低频——**仅在整件货物实际搬运成功**时记一条（`cargo`＝被搬运货物的显示名），
  //   每模块每 tick 至多 1 条（单目标单件）；成句在结算步骤 3d-3 的**落地处**（与数值同批）；
  //   owner/target 着色、module 恒绿，`cargo` 为纯文本（与 UI 芯片同一名称口径）。
  'battle.log.cargoTransfer': '{owner}的{module}：把 {cargo} 传输给 {target}',
  // ★ 货物维修（`cargo_repair`）：低频——**仅在实际回血 > 0 且本 tick 确实消耗了一件货物**时记一条；
  //   `cargo`＝**实际被消耗的货物**显示名、`amount`＝**实际回血量**（含 hpMax 截断，口径唯一）；
  //   owner/target 着色、module 恒绿；成句在结算步骤 4c 的**回血落地处**（与数值同批）。
  'battle.log.cargoRepair': '{owner}的{module}：消耗 {cargo}，修复 {target} {amount} 点生命',
  // ★ 货物强化（`cargo_enhance`）：低频——**仅在真正写入**（该货物本 tick 确实被强化）时记一条，
  //   每模块每 tick 至多 1 条（单目标单件）；成句在结算步骤 3d-5 的**落地处**（与数值同批）；
  //   `cargo`＝被强化货物显示名（与 UI 芯片同一名称口径）、`v`＝`bonus_add` 的**增量百分比**
  //   （唯一换算 `core/utils.js formatBonusDeltaPercent`：**增量语义**、**字符串自带正负号** ⇒
  //    模板里**不再写 `+`**，否则会出现 `++10%`）；owner 着色、module 恒绿、`cargo` 为纯文本。
  'battle.log.cargoEnhance': '{owner}的{module}：强化了 {cargo}（加成 {v}%）',
  // ★ 装载完成（`cargo_loader`，结算步骤 5）：低频——**仅在货物真正入舱时记 1 条**（唯一入舱点
  //   `landCargoOn`；每模块每 tick ≤ 1 条）；成句在**完成落地处**（与数值同批：先落数值、后成句）；
  //   `cargo`＝货物显示名（与 UI 芯片同一名称口径）、owner 着色、module 恒绿。
  'battle.log.cargoLoad': '{owner}的{module}：装载 {cargo} 完成',
  // ★ 卸载回星区（玩家在详情页点芯片主动返还）：低频——**一次有效点击 1 条**；
  //   该动作由 **UI 在 tick 之间即时触发** ⇒ 立即成句、**不写 `__pending`**；`{ok:false}` 不记、重复点击
  //   因该件已不在货舱而不再成句（幂等）；`cargo`＝货物显示名、owner 着色（无 module 段）。
  'battle.log.cargoUnload': '{owner}：把 {cargo} 卸载回星区',
  'battle.result.close': '收起',
};
