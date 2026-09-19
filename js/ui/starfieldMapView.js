/* ===== ui/starfieldMapView.js —— ★ C-1 星域大地图（只读视图 + 缩放平移 + 点击选中） =====
 * 设计依据：`战场大地图(星域)说明.md` §5「布局生成（方形网格 · 近似圆）」、§6「地图交互与侧栏」、
 *   §7「界面规划」、§10 阶段 C（C-1 地图本体；**C-2 侧栏完整战斗场景不在本轮**）。
 *
 * 视图契约与既有屏一致：`{ root() -> Element }`（`ui/router.js`；每次 `show` 重新生成 DOM ⇒
 *   语言切换 `repaint()` 即全量刷新文案），路由名 **`'starfieldMap'`**。
 *
 * ★ **只读铁律**：本文件**只读**星域容器的只读口径，**绝不重算/生成任何东西**——
 *   · 布局几何读 `starfield.generation.layout`（`width/height/cells/order:'r-then-q'`）；
 *   · 星区位置/类型/数量读 `starfield.sectors`（每区 `index/q/r/typeId/isStar/placement/…`）；
 *   · 类型名/标记/颜色读**既有星区类型注册表** `data/sectorTypes/`（`getSectorType`）——
 *     颜色**只取 CSS 变量名**（`mapColor`，如 `--sector-star`），UI 用 `var(...)` 引用、**不写任何色值**；
 *   · 数字（存活/储量/货物/冷却/战报条数）全部来自 `sectors` 快照，**UI 不自算**（秒数换算只调 `formatTickSeconds`）。
 *   · **不硬编码类型 id**：恒星＝容器给的 `isStar`；特殊区＝类型定义的 `kind === 'special'`
 *     （星门即特殊类型）；方位＝`placement.mode`。⇒ 数据里加新类型时本视图无需改动。
 *
 * ★ tick 驱动（本轮口径 · 用户指定）：**本视图打开期间**用既有 `bus` 的 `tick` 事件驱动
 *   `starfield.step(1)`（20 tps，`core/tick.js` 体例）；**离开路由即停止驱动**（`bus.on('route')`）。
 *   刷新用 `queueMicrotask` 延后一拍（体例同 `battleView.js`）⇒ 无论引擎/UI 的订阅先后，UI 读到的都是
 *   **本 tick 结算之后**的状态。★ 本视图**不接管战斗屏、不影响既有单星区玩法**（各区实例为
 *   「星域星区模式」：不发全局事件、不写全局战报、不执行“一方全灭即结束”）。
 *   ★ 若后续判定“驱动星域 tick”应属容器自身职责（而非 UI），改动点**只有本文件的 `onTick` 一处**。
 *
 * ★ 性能：地图节点**只在挂载时建一次**（DOM 复用）；每次刷新只读 `starfield.sectors` 新快照并与
 *   **上一帧缓存字符串**逐字段比较 ⇒ **只在变化时写 DOM**（体例同既有货物芯片/单位卡的“变化才更新”）。
 *
 * ★ C-2 挂载点：见 `buildSidebar()` 里的 **`.starfield-sidebar-stage`**（已预留容器 + 注释）。
 *
 * ★★ 阶段 2：**拖拽下达「星区间移动」** ★★
 *   · **拖源**＝侧栏单位卡（由 `battleView` 渲染；卡片 `draggable` 判据＝容器只读 `unitNav().canCommand`）；
 *   · **落点**＝地图格子（`.sf-cell`，**非空位**）；拖动中该格加 `.sf-cell.drop-target`（**仅描边**，
 *     复用既有视觉、不新增配色）；
 *   · **放开** ⇒ 调**唯一写入口** `starfield.moveUnitTo(unitId, targetIndex)`（**UI 绝不自算**可达性/冷却）；
 *     · **失败**（`dead/owner/far/invalid/finished`）⇒ 顶栏**短提示**（`starfield.move.failed.*` 按 reason
 *       映射），**不改队列、不改任何字段**；
 *     · ★ **拖到该单位“自身所在星区” ⇒ 取消移动**（引擎成功返回 `{cancelled:true}`，**不是失败**）⇒
 *       短提示「已取消移动」并立即清掉卡片 `⇥#n` 与地图路径描边；本来就没有指令 ⇒ 静默无操作；
 *   · **无新配色**：提示用既有 `--warn`，高亮用既有 `--accent`；
 *   · **零回归**：既有点击选中 / 平移 / 缩放 / 侧栏宽度逻辑**一字未改**（拖拽只用 `drag*` 事件，
 *     与既有 `pointer*` 平移/点击链路互不干扰）。
 *
 * ★★ 阶段 2 增补②：**侧栏跟随被选单位** ＋ **地图描出其余路径** ★★
 *   · 选中态来源＝侧栏「单位详情」的选中（`battleView` 经 `navHook.onSelect` 回报；**UI 不另建选中态**）；
 *   · **跟随**：被选单位跨区移动 ⇒ 侧栏场景自动切到它所在的新星区（`mountSectorScene(newBattle)`）并
 *     **保持详情展开**（同一渲染链 `battleView.selectSceneUnit`）；单位已不存在 ⇒ 收起详情 + 一次短提示；
 *   · **描边**：有移动指令 ⇒ 逐格描出**剩余路径**（数据＝容器只读 `unitNav().navPath`，引擎算好、UI 只渲染）；
 *     无指令 ⇒ 只描其**当前所在格**；随移动逐格消减、随新指令重算；
 *   · 类名 `.sf-cell.nav-here` / `.sf-cell.nav-path`（**只用既有 `--accent`**），与 `.selected` / `.drop-target`
 *     三者互不覆盖；描边集合每帧**先清后画**（幂等，不重建 DOM）。
 */
import { el } from '../core/utils.js';
import { bus } from '../core/eventBus.js';
import { i18n } from '../i18n/index.js';
import { formatTickSeconds } from '../core/tick.js';
import { getSectorType } from '../data/sectorTypes/index.js';
import { router } from './router.js';
import { ensureStarfield, getStarfield } from './starfieldSession.js';
import { unitIcon } from './unitIcon.js'; // ★ 单位图标**唯一口径**（与战斗屏共用；见 `ui/unitIcon.js`）
import { mountSectorScene, selectSceneUnit } from './battleView.js'; // ★ C-2：复用**同一套**战斗场景渲染/交互链（无第二套实现）

/* ---------- 交互常量（纯表现层参数，非游戏数值） ---------- */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.6;
const ZOOM_STEP = 1.15; // 滚轮/按钮每档倍率
const DRAG_THRESHOLD = 4; // 位移小于该像素数 ⇒ 视为“点击选中”而非“拖拽平移”
// ★ 原 `PAN_PAD`（平移夹取容差 40px）已随「取消平移夹取」一并删除（用户口径：拖拽范围不限制）
/* ★ **格内单位预览的图标上限与省略规则**（用户口径要求：写进注释并回报）：
 *  · 只统计**存活**单位（`u.alive`）；死亡/已移除者**不显示预览**；
 *  · ★ **任何缩放层级都显示本图标行**（用户口径：“地图中始终显示单位图标”）—— 不再有“仅 mid/near
 *    才显示”的层级限制；层级只影响进度条（`.sf-bars` 仅 near 显示，见 `css/screens.css`）；
 *  · 最多显示 **`CELL_ICON_MAX = 4`** 个图标；**第 5 个起不再画图标**，改为在其后追一枚 **`+n` 小芯片**
 *    （`n` ＝ 存活数 − 4）⇒ 一行最多 5 个元素；该行 `flex-wrap:nowrap` + `overflow:hidden`
 *    ⇒ **绝不换行、绝不挤破格子**（超出部分被裁掉，但信息由 `+n` 与悬停 title 兜住）；
 *  · 图标渲染走**既有唯一口径** `ui/unitIcon.js unitIcon(ship)`（召唤模块图标 / 船型解析 icon /
 *    约定素材路径三级优先，加载失败降级 ▲）——地图里只是把它放进小尺寸 CSS 作用域。 */
const CELL_ICON_MAX = 4;
/* ★ **格内进度条口径（用户口径 · 本轮修正）**：
 *  · 矿物条 ＝ **当前 `ore` ÷ `oreInit`（该区生成时的初始储量）**；
 *  · 货物条 ＝ **当前 `cargoCount` ÷ `cargoInit`（该区**货物初始件数**，容器只读口径新增字段）**；
 *    —— **不再使用任何展示参考常量**（原 `CARGO_BAR_REF` 已删除）。
 *  · **分母口径（确定性兜底，无 NaN/Infinity/负宽）**：分母 ＝ `max(初始值, 当前值, 0)` ——
 *      → 初始为 0 且当前 > 0（例如「初始无货物、后续卸载/返还进来」）⇒ 分母＝当前值 ⇒ **比例＝1 ⇒ 满条**；
 *      → 初始与当前都为 0 ⇒ 该条**隐藏**（见下）；
 *      → `oreInit`/`cargoInit` 缺失、非数值或为负 ⇒ 按 0 参与（同样由上式兜底）。
 *  · **上限钳制**：比例 clamp 到 `[0, 1]` ⇒ **超出初始值一律满条**（采矿使矿物增加、或卸载使件数超过初始件数）。
 *  · **值为 0 则隐藏该条**：`ore <= 0` 隐藏矿物条、`cargoCount <= 0` 隐藏货物条（两条独立判断）；
 *    两条都隐藏时**整块进度条区域隐藏**。 */

/* ★ 侧栏宽度（**会话内记忆**：模块级变量 ⇒ 切换星区/重绘/离开再进入都保持；刷新页面自然重置）
 *  ★ 默认宽度＝**半屏**（`.sf-body` 可用宽 × 0.5，见 `clampSidebarW(null)`）：
 *    · `sidebarW === null` 且 `sidebarUserSet === false` ⇒ **尚未确定/用户未拖动过** ⇒ 每次按当前可用宽取半屏；
 *    · 用户拖动后 `sidebarUserSet = true` ⇒ **会话内记忆优先**（窗口 resize 时只做夹取、不再回到半屏）。 */
const SIDEBAR_MIN_W = 220;
const SIDEBAR_DEFAULT_W = 300; // 仅用于「首帧尚未布局、拿不到可用宽」时的确定性兜底
const SF_SIDE_PAD = 24; // 侧栏上限推导时的**留白**（像素；保证地图一列星区两侧仍有呼吸空间）
const SIDEBAR_DEFAULT_RATIO = 0.5; // ★ 默认＝半屏
let sidebarW = null; // null ⇒ 未拖动过：按半屏推导
let sidebarUserSet = false; // 用户是否拖动过（决定"会话内记忆"是否优先于默认）

/* ---------- 模块状态（视图重绘时复用：缩放/平移/选中在 `repaint()` 后保持） ---------- */
let mounted = false;
let viewportEl = null;
let canvasEl = null;
let gridEl = null;
let metaEl = null;
let statusEl = null;
let remainEl = null;
let zoomEl = null;
let legendEl = null;
let sidebarEl = null;
let sbTitleEl = null; // 侧栏标题（显示星区名，与战斗屏星区栏同一文案口径）
let sbStageEl = null; // ★ C-2：战斗场景挂载容器（`.starfield-sidebar-stage`）
let sceneHost = null; // ★ C-2：当前侧栏场景宿主（`battleView.mountSectorScene` 返回值；只刷新当前星区）
let gridCols = 1; // 网格列数（建图时记录；用于推导「单列星区」的实际宽度 ⇒ 侧栏最大宽度）
/* ★★ 阶段 2：拖拽下达「星区间移动」的**视图内状态**（与容器/引擎无关，纯 UI 中间态）：
 *   · `navDragUnitId` ＝ 正在拖拽的单位 id（由单位卡的 `dragstart` 经 `navHook.beginDrag` 登记）；
 *   · `dropCell`       ＝ 当前高亮的目标格（`.sf-cell.drop-target`；同一时刻至多一个）；
 *   · `moveMsgEl/Timer`＝ 顶栏短提示（非法下达专用；自动消隐）；
 *   · `navSelId`       ＝ 侧栏**当前选中（详情已展开）的单位 id**：用于①侧栏跟随其移动 ②地图描边其路径；
 *   · `navFocusCells`  ＝ 地图上**当前被描边**的格子（`.nav-here`/`.nav-path`）——每帧先清后画（幂等）；
 *   · `sceneSwitching` ＝ 正在切换侧栏场景（切换过程中的内部“清空选中”通知**不代表用户收起详情**）。 */
let navDragUnitId = null;
let dropCell = null;
let moveMsgEl = null;
let moveMsgTimer = 0;
let navSelId = null;
let sceneSwitching = false;
const navFocusCells = [];
let selectedIndex = null;
let scale = 1;
let tx = 0;
let ty = 0;
const cellRefs = new Map(); // index → { cell, units, unitSig, bars:{ore,cargo}, cache:{…} }（DOM 复用 + 变化才写）

/* ---------- 小工具 ---------- */

/** 该星区类型定义（未知类型 ⇒ null；名称/标记/颜色一律取自**数据层注册表**） */
const typeOf = (typeId) => getSectorType(typeId) || null;

/** 类型名（走既有 `sectorType.<id>` 词条；缺词条时 `i18n.t` 返回 `??key`，便于发现） */
function typeName(typeId) {
  const def = typeOf(typeId);
  return i18n.t((def && def.nameKey) || `sectorType.${typeId}`);
}

/** 格子的“类型色/标记”样式：**只引用 CSS 变量名**（不写色值） */
function paintCell(cell, def) {
  if (!def) return;
  cell.style.setProperty('--sf-color', `var(${def.mapColor})`);
  cell.style.setProperty('--sf-glyph', `'${String(def.marker || '·').replace(/'/g, "\\'")}'`);
}

/** 状态词条 key（finished/stopped/settled 优先级：手动停止 > 时间耗尽 > 运行中） */
function statusKey(sf) {
  if (sf.stopped) return 'starfield.map.status.stopped';
  if (sf.finished) return sf.settled ? 'starfield.map.status.settled' : 'starfield.map.status.finished';
  return 'starfield.map.status.running';
}

/** **星区**（该区 battle 实例）阶段文案：直接用容器只读口径给的 `phase`（`idle|running|settled`），
 *  UI 不自算、不映射内部状态 ⇒ 未知值由 `i18n.t` 原样回显 `??key`（便于发现遗漏词条）。 */
const phaseText = (s) => i18n.t(`starfield.phase.${s.phase}`);

/** ★ **星区显示名（唯一口径）**：`#{显示编号} {类型名}（{q}, {r}）`
 *  · `{显示编号}` ＝ **1 起的显示编号**（只读 `index + 1`；`index` 是引擎生成顺序、从 0 起）——纯呈现层换算；
 *  · `{类型名}` 复用既有 `sectorType.<id>` 词条；`{坐标}` 取只读 `q/r`；
 *  · 同一字符串既用于**战斗屏星区栏**（`battleView.mountSectorScene(..., { zoneName })`）也用于**侧栏标题**
 *    ⇒ 两处显示**必然一致**（无第二套拼法）。 */
const zoneNameOf = (s) =>
  i18n.t('starfield.zoneName', { n: s.index + 1, name: typeName(s.typeId), q: s.q, r: s.r });

/* ---------- 格内预览的小工具（只读 `battleOf(index)` 的既有口径） ---------- */

/** 该星区的**存活**单位（读 `starfield.battleOf(index).units()` 只读口径；UI 只做 `alive` 过滤，不自算其它） */
function aliveUnitsOf(sf, index) {
  const b = sf.battleOf(index);
  if (!b) return [];
  return b.units().filter((u) => u && u.alive);
}

/** 图标行的**签名**（决定是否需要重画图标 DOM）：只取影响图标/省略的字段（顺序即渲染顺序，不自排） */
const iconSig = (units) =>
  units
    .map((u) => `${u.summonIcon || (u.typeCfg && u.typeCfg.icon) || ''}|${u.typeId}|${u.side}|${u.tempNoIcon ? 'n' : ''}`)
    .join(',');

/** ★ **进度条比例（唯一口径）**：`当前值 ÷ max(初始值, 当前值, 0)`，**clamp 到 [0,1]**。
 *  · 非数值/负值一律按 0 参与 ⇒ **绝不产生 NaN / Infinity / 负宽度**；
 *  · 初始为 0 且当前 > 0 ⇒ 分母＝当前值 ⇒ 比例＝1 ⇒ **满条**（用户口径：后续补充进来的量超过初始就满条）；
 *  · 当前为 0 ⇒ 返回 0（调用方据此**隐藏该条**）。 */
function ratioOf(cur, init) {
  const c = Number.isFinite(cur) ? Math.max(0, cur) : 0;
  const i = Number.isFinite(init) ? Math.max(0, init) : 0;
  const denom = Math.max(i, c);
  if (denom <= 0) return 0;
  return Math.max(0, Math.min(1, c / denom));
}

/** 贴图（**预留**）：`def.texture` 非空 ⇒ 渲染 `<img>`；为空 ⇒ 返回 null（调用方回退「类型色 + marker」）。
 *  加载失败 ⇒ 移除 `has-tex` 类 ⇒ CSS 自动回到 marker 呈现（**不新增任何图片文件**）。 */
function buildTexture(def) {
  if (!def || !def.texture) return null;
  const img = el('img', { class: 'sf-tex', src: def.texture, alt: '', draggable: 'false' });
  img.addEventListener('error', () => {
    const host = img.parentElement; // ★ 先取父节点再移除（否则 parentElement 已为 null）
    img.remove();
    if (host) host.classList.remove('has-tex');
  });
  return img;
}

/** 单位图标行：最多 `CELL_ICON_MAX` 个图标 ＋（超出时）一枚 `+n` 芯片；只统计存活单位 */
function renderUnitsRow(row, units) {
  row.replaceChildren();
  const shown = Math.min(units.length, CELL_ICON_MAX);
  for (let i = 0; i < shown; i += 1) {
    const wrap = el('span', { class: 'sf-unit-ico' }, [unitIcon(units[i])]);
    wrap.title = i18n.t(`ship.${units[i].typeId}`); // 悬停单图标也能看到船型名（缺词条回显 ??key）
    row.appendChild(wrap);
  }
  const rest = units.length - shown;
  if (rest > 0) {
    row.appendChild(el('span', { class: 'sf-more', text: `+${rest}`, title: i18n.t('starfield.cell.moreAlive', { n: rest }) }));
  }
}

/* ---------- DOM 构建 ---------- */

function buildTopbar() {
  const back = el('button', {
    class: 'btn small',
    text: i18n.t('starfield.map.back'),
    onclick: () => router.show('starfield'), // 返回「星域配置」占位页（C-4 将换成正式配置界面）
  });
  metaEl = el('div', { class: 'sf-meta' });
  remainEl = el('div', { class: 'sf-remain' });
  statusEl = el('div', { class: 'sf-status' });
  // ★ 阶段 2：拖拽下达的**短提示**（非法/失败专用；无内容时整块隐藏 ⇒ 既有呈现零变化）
  moveMsgEl = el('div', { class: 'sf-move-msg hidden' });
  zoomEl = el('div', { class: 'sf-zoom-label', text: '100%' });
  const bar = el('div', { class: 'sf-topbar' }, [
    back,
    el('div', { class: 'sf-title', text: i18n.t('starfield.map.title') }),
    el('div', { class: 'sf-top-meta' }, [metaEl, remainEl, statusEl]),
    moveMsgEl,
    el('div', { class: 'sf-zoom' }, [
      el('button', { class: 'btn tiny', text: '−', title: i18n.t('starfield.map.zoom.out'), onclick: () => zoomBy(1 / ZOOM_STEP) }),
      zoomEl,
      el('button', { class: 'btn tiny', text: '+', title: i18n.t('starfield.map.zoom.in'), onclick: () => zoomBy(ZOOM_STEP) }),
      el('button', { class: 'btn tiny', text: i18n.t('starfield.map.zoom.reset'), onclick: () => resetView() }),
    ]),
  ]);
  return bar;
}

/** 网格：按 `layout.width/height` 铺满方形网格；`sectors[]` 按 (q,r) 落格，其余格位＝**空位**（灰底、可悬停说明）。
 *  ★ 坐标→格位映射：扫描顺序 `order:'r-then-q'` ⇒ 行号 = `r + R`、列号 = `q + R`（`R = (width-1)/2`）。 */
function buildGrid(sf) {
  const layout = sf.generation.layout;
  const R = (layout.width - 1) / 2;
  const sectors = sf.sectors; // 只读快照（新数组/新对象）
  const byPos = new Map(sectors.map((s) => [`${s.q},${s.r}`, s]));
  cellRefs.clear();
  gridEl = el('div', { class: `sf-grid sf-zoom-${zoomTier()}` });
  gridCols = layout.width; // ★ 记录列数：侧栏上限推导「单列星区宽度」用（`oneColumnWidth()`）
  gridEl.style.setProperty('--sf-cols', String(layout.width));
  gridEl.style.setProperty('--sf-rows', String(layout.height));
  const frag = document.createDocumentFragment();
  for (let row = 0; row < layout.height; row += 1) {
    for (let col = 0; col < layout.width; col += 1) {
      const q = col - R;
      const r = row - R;
      const s = byPos.get(`${q},${r}`);
      const cell = el('div', {
        class: 'sf-cell',
        dataset: { q: String(q), r: String(r) },
        style: { gridColumn: String(col + 1), gridRow: String(row + 1) },
      });
      if (!s) {
        // ★ 圆内/圆外**没有星区**的格位：留空（灰底）＋说明，**不自己补类型**
        cell.classList.add('sf-void');
        cell.title = i18n.t('starfield.map.void', { q, r });
      } else {
        const def = typeOf(s.typeId);
        paintCell(cell, def);
        cell.dataset.index = String(s.index);
        if (s.isStar) cell.classList.add('is-star'); // ★ 恒星星区（容器给的 isStar）
        if (def && def.kind === 'special') cell.classList.add('is-special'); // ★ 特殊类型（星门等）
        if (s.placement && s.placement.mode === 'edges') cell.classList.add('is-edge'); // 四方位外缘
        // ★ 贴图（预留）＋ 标记（回退）：有 `texture` ⇒ 渲染贴图并隐藏 marker；为空/加载失败 ⇒ marker 呈现
        const tex = buildTexture(def);
        const marker = el('span', { class: 'sf-marker' });
        if (tex) {
          cell.classList.add('has-tex');
          cell.append(tex);
        }
        // ★ 格内预览（本轮改版）：**上＝存活单位图标行**（★ **任何缩放层级都显示**，用户口径）、
        //   **下＝矿物/货物进度条**（**仅 near 显示**，far/mid 由 CSS 隐藏）；**不再显示文字摘要**
        //   （文字信息保留在悬停 title 与右侧侧栏里）。层级规则只按行类名（`.sf-units`/`.sf-bars`）由 CSS 控制。
        const units = el('div', { class: 'sf-detail sf-detail-1 sf-units' });
        // 两条条各自独立（**当前值为 0 ⇒ 该条隐藏**；两条都隐藏 ⇒ 整块隐藏）：
        //   ★ **取色改用分类主题色（用户口径）**：矿物条＝`--cat-mining`（采矿紫）、货物条＝`--cat-transport`（运输亮黄）；
        //     **星域新 UI 的进度条不再使用 `--ore`/`--cargo`**（那两条是既有战斗屏/星区资源栏的资源语义配色，未改动）。
        //     底槽色仍沿用既有 `.bar-track` 的既有灰（`css/battle.css`）⇒ **不新增配色值**。
        const oreRow = el('div', { class: 'sf-bar sf-bar-ore' }, [
          el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: { background: 'var(--cat-mining)' } })]),
        ]);
        const cargoRow = el('div', { class: 'sf-bar sf-bar-cargo' }, [
          el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: { background: 'var(--cat-transport)' } })]),
        ]);
        const bars = el('div', { class: 'sf-detail sf-detail-2 sf-bars' }, [oreRow, cargoRow]);
        cell.append(marker, units, bars);
        cellRefs.set(s.index, {
          cell,
          units,
          unitSig: null,
          bars,
          oreRow,
          cargoRow,
          oreFill: oreRow.querySelector('.bar-fill'),
          cargoFill: cargoRow.querySelector('.bar-fill'),
          cache: {},
        });
      }
      frag.appendChild(cell);
    }
  }
  gridEl.appendChild(frag);
  canvasEl = el('div', { class: 'sf-canvas' }, [gridEl]);
  return canvasEl;
}

/** 图例：**只列本星域实际出现的类型**（从 sectors 派生，不硬编码类型清单） */
function buildLegend(sf) {
  const seen = [];
  for (const s of sf.sectors) if (!seen.includes(s.typeId)) seen.push(s.typeId);
  legendEl = el('div', { class: 'sf-legend' }, [
    el('span', { class: 'sf-legend-title', text: i18n.t('starfield.map.legend') }),
    ...seen.map((typeId) => {
      const def = typeOf(typeId);
      const item = el('span', { class: 'sf-legend-item' });
      paintCell(item, def);
      item.append(el('span', { class: 'sf-legend-marker' }), el('span', { class: 'sf-legend-name', text: typeName(typeId) }));
      return item;
    }),
    el('span', { class: 'sf-legend-item sf-legend-void' }, [
      el('span', { class: 'sf-legend-marker' }),
      el('span', { class: 'sf-legend-name', text: i18n.t('starfield.map.legend.void') }),
    ]),
  ]);
}

/** 侧栏（**只承载战斗场景**：C-1 的「星区摘要」面板已按用户口径删除——
 *  那些信息战斗场景里都有，星区名集成到战斗屏的**星区栏** `.zone-label`） */
function buildSidebar() {
  sbTitleEl = el('span', { class: 'sf-sb-title' }); // 标题＝星区名（与星区栏同一口径）
  // ★★ C-2 挂载点：`battleView.mountSectorScene()` 在此渲染该星区**完整战斗场景**（同一套渲染/交互链；
  //   数据＝`starfield.battleOf(index)` 只读口径；**星域容器是实例生命周期的唯一所有者**）。
  sbStageEl = el('div', { class: 'starfield-sidebar-stage' });
  sidebarEl = el(
    'aside',
    { class: 'starfield-sidebar hidden' },
    [
      el('div', { class: 'sf-sb-head' }, [
        sbTitleEl,
        el('button', {
          class: 'btn tiny',
          text: i18n.t('starfield.sidebar.close'),
          onclick: () => selectSector(null),
        }),
      ]),
      sbStageEl,
    ]
  );
  return sidebarEl;
}

/* ---------- 刷新（只读 sectors 快照；变化才写 DOM） ---------- */

const setText = (node, text) => {
  if (node && node.textContent !== text) node.textContent = text;
};

function refreshTopbar(sf) {
  setText(metaEl, i18n.t('starfield.map.meta', { id: sf.configId, seed: sf.seed, r: sf.radius }));
  setText(remainEl, i18n.t('starfield.map.remaining', { s: formatTickSeconds(sf.remainingTicks) }));
  setText(statusEl, i18n.t(statusKey(sf)));
  statusEl.dataset.state = sf.stopped ? 'stopped' : sf.finished ? 'finished' : 'running';
}

/** 格内预览刷新（**只读** `sectors` 快照 + `battleOf(index).units()`；变化才写 DOM）：
 *  · 单位图标行：**只在签名变化时重画**（存活集合/船型/阵营/图标来源变了才重建，否则一个节点都不动）；
 *  · 矿物 / 货物进度条：只改两条 `.bar-fill` 的 `width`，并**按当前值是否为 0 独立隐藏该条**
 *    （两条都隐藏 ⇒ 整块 `.sf-bars` 隐藏）；比例口径见 `ratioOf()` 的注释；
 *  · 悬停 `title`：类型名 / 编号 / 坐标 / 存活（我·敌）/ 矿量 / 货物数 / 该区 phase。 */
function refreshCells(sf) {
  for (const s of sf.sectors) {
    const ref = cellRefs.get(s.index);
    if (!ref) continue;
    // ① 单位图标（只统计存活；上限/省略规则见 `CELL_ICON_MAX` 注释）
    const units = aliveUnitsOf(sf, s.index);
    const sig = iconSig(units);
    if (ref.unitSig !== sig) {
      renderUnitsRow(ref.units, units);
      ref.unitSig = sig;
    }
    // ② 进度条：**当前值 ÷ max(初始值, 当前值)**，clamp [0,1] ⇒ 超出初始一律满条；当前为 0 ⇒ 隐藏该条
    const oreVisible = s.ore > 0;
    const cargoVisible = s.cargoCount > 0;
    if (ref.cache.oreVisible !== oreVisible) {
      ref.oreRow.classList.toggle('hidden', !oreVisible); // ★ 值为 0 ⇒ 隐藏（`.sf-bar.hidden` 已显式声明）
      ref.cache.oreVisible = oreVisible;
    }
    if (ref.cache.cargoVisible !== cargoVisible) {
      ref.cargoRow.classList.toggle('hidden', !cargoVisible);
      ref.cache.cargoVisible = cargoVisible;
    }
    const barsVisible = oreVisible || cargoVisible;
    if (ref.cache.barsVisible !== barsVisible) {
      ref.bars.classList.toggle('hidden', !barsVisible); // ★ 两条都隐藏 ⇒ 整块隐藏
      ref.cache.barsVisible = barsVisible;
    }
    if (oreVisible) {
      const orePct = (ratioOf(s.ore, s.oreInit) * 100).toFixed(1);
      if (ref.cache.orePct !== orePct) {
        ref.oreFill.style.width = `${orePct}%`;
        ref.cache.orePct = orePct;
      }
    }
    if (cargoVisible) {
      const cargoPct = (ratioOf(s.cargoCount, s.cargoInit) * 100).toFixed(1);
      if (ref.cache.cargoPct !== cargoPct) {
        ref.cargoFill.style.width = `${cargoPct}%`;
        ref.cache.cargoPct = cargoPct;
      }
    }
    // ③ 悬停明细（格上不再显示文字 ⇒ title 是补充信息的唯一去处；缩小层级也读得到）
    const aliveText = i18n.t('starfield.cell.alive', { a: s.alive.ally, e: s.alive.enemy });
    const oreCargo = i18n.t('starfield.cell.oreCargo', { ore: s.ore, cargo: s.cargoCount });
    const tip = `${typeName(s.typeId)} #${s.index} (${s.q},${s.r})\n${aliveText}\n${oreCargo}\n${phaseText(s)}`;
    if (ref.cache.tip !== tip) {
      ref.cell.title = tip;
      ref.cache.tip = tip;
    }
  }
}

/** 统一刷新（每 tick 调用一次；`queueMicrotask` 中执行 ⇒ 读到本 tick 结算后的状态） */
function refresh() {
  const sf = getStarfield();
  if (!mounted || !sf || !gridEl) return;
  // ★ 阶段 2：**侧栏跟随被选单位**（在刷格子之前先决定“当前该显示哪个星区”，保证同帧一致）
  followSelectedUnit(sf);
  refreshTopbar(sf);
  refreshCells(sf);
  paintNavFocus(); // ★ 阶段 2：选中单位的高亮格 + 剩余路径浅色描边（只改类名，不重建 DOM）
  if (sceneHost) sceneHost.refresh(); // ★ C-2：**只刷新当前选中星区**的侧栏战斗场景
}

/* ---------- ★★ 阶段 2：被选单位的「跟随」与「路径描边」 ---------- */

/** 侧栏跟随：被选单位**跨区移动** ⇒ 侧栏场景自动切到它所在的新星区，并**保持详情展开**；
 *  · 单位已不存在（阵亡/被移出场景）⇒ 收起详情 + 收起侧栏 + **一次短提示**（不报错）；
 *  · 只读口径：单位位置一律取容器 `unitNav().sectorIndex`，UI 不自算。
 *  ★ 幂等：`selectedIndex` 已是目标区 ⇒ 什么都不做（不打断用户在别处的浏览以外的任何交互）。 */
function followSelectedUnit(sf) {
  if (navSelId == null) return;
  const n = sf.unitNav(navSelId);
  if (!n) {
    const lost = navSelId;
    navSelId = null;
    selectSector(null); // 收起侧栏（内部会卸载场景 ⇒ 选中态随之清空）
    if (lost) showMoveMsg(i18n.t('starfield.follow.lost'));
    return;
  }
  if (n.sectorIndex !== selectedIndex) {
    // ★ 切换期间：新场景的“内部清空选中”通知不得清掉跟随目标（见 `onSelect` 的守卫）
    const want = navSelId;
    sceneSwitching = true;
    try {
      selectSector(n.sectorIndex); // 挂载新星区场景（内部 `mountSceneFor` + `refresh`）
      // ★ 详情保持展开：在新场景里按同一单位 id 重新打开（同一渲染链，`battleView.selectSceneUnit`）
      if (sceneHost) selectSceneUnit(want);
    } finally {
      sceneSwitching = false;
    }
    navSelId = want; // 兜底：无论如何都保持跟随目标（除非上一步判定为“已不存在”）
  }
}

/** 被选单位在地图上的**浅色描边**：有移动指令 ⇒ 画**剩余路径**（逐格）；无指令 ⇒ 只高亮其所在格。
 *  · 路径来自容器只读口径 `unitNav().navPath`（**引擎算好、UI 只渲染**）；
 *  · 只切换类名（`.sf-cell.nav-path` / `.sf-cell.nav-here`，均用既有 `--accent`，**不新增配色值**）；
 *  · 与「拖拽落点高亮 `.drop-target`」「星区选中 `.selected`」互不干扰（三个独立类名）。 */
function paintNavFocus() {
  for (const ref of navFocusCells) ref.classList.remove('nav-path', 'nav-here');
  navFocusCells.length = 0;
  const sf = getStarfield();
  if (!sf || navSelId == null) return;
  const n = sf.unitNav(navSelId);
  if (!n) return;
  const here = cellRefs.get(n.sectorIndex);
  if (here) {
    here.cell.classList.add('nav-here');
    navFocusCells.push(here.cell);
  }
  for (const idx of n.navPath || []) {
    const ref = cellRefs.get(idx);
    if (!ref) continue;
    ref.cell.classList.add('nav-path');
    navFocusCells.push(ref.cell);
  }
}

/* ---------- 缩放 / 平移 / 选中 ---------- */

function zoomTier() {
  if (scale < 0.8) return 'far';
  if (scale < 1.3) return 'mid';
  return 'near';
}

/** ★ `clampAxis()` 已按用户口径**删除**（原「内容不越出视口 ±PAN_PAD」的平移夹取）——
 *  自由平移：任何边缘星区都能拖到视口中心/对侧；越界内容由视口 `overflow:hidden` 裁剪，不外溢到其它 UI。 */

/* ---------- ★ C-2：侧栏战斗场景的挂载 / 切换 / 卸载 ---------- */

/** 把侧栏场景绑定到指定星区（`null` ⇒ 关闭/卸载）：
 *  · 切换星区或关闭侧栏 ⇒ **先 `destroy()` 旧场景**（严格还原本视图的模块级场景引用 ⇒ 无上一区残留）；
 *  · 场景渲染/交互 **100% 复用 `battleView` 的同一套实现**（`mountSectorScene`）⇒ 无第二套逻辑；
 *  · **星域容器仍是实例生命周期的唯一所有者**：这里只做 UI 挂载/卸载，绝不 `start/stop`、绝不碰 `ticker`。 */
function mountSceneFor(index) {
  if (sceneHost) {
    sceneHost.destroy();
    sceneHost = null;
  }
  if (!sbStageEl) return;
  const sf = getStarfield();
  const s = index == null || !sf ? null : sf.sectors.find((x) => x.index === index) || null;
  const b = s && sf.battleOf(index) ? sf.battleOf(index) : null;
  if (sbTitleEl) setText(sbTitleEl, s ? zoneNameOf(s) : ''); // 侧栏标题＝星区名（与星区栏同一口径）
  // ★ `zoneName` 由**地图视图按只读口径拼好**后交给战斗场景注入星区栏（`.zone-label`）⇒ UI 不自算、引擎零改动
  // ★ `zoneName`（星区显示名）与 `fleetPolicy`（**星域级「全队主要目标」单一来源**适配器）都由本视图
  //   按**容器只读口径**提供：读＝`sf.fleetPolicy`，写＝`sf.setFleetPolicy()`（容器再用引擎既有唯一接口
  //   `battle.setAllyPolicy` 下发给所有星区）⇒ 任一星区指挥栏的改动**跨所有星区同时生效**、切换星区不跳变。
  sceneHost = b
    ? mountSectorScene(sbStageEl, b, {
        zoneName: s ? zoneNameOf(s) : '',
        fleetPolicy: sf ? { get: () => sf.fleetPolicy, set: (kind) => sf.setFleetPolicy(kind) } : null,
        // ★ 阶段 2：星区间移动的**只读适配器**（单位卡的竖条/详情数值/可拖拽性全走它；写仍走唯一入口）
        nav: {
          of: (unitId) => {
            const cur = getStarfield();
            return cur ? cur.unitNav(unitId) : null;
          },
          beginDrag: (unitId) => {
            navDragUnitId = unitId;
          },
          endDrag: () => endNavDrag(),
          // ★ 侧栏「单位详情」的选中态回报（侧栏跟随移动单位 + 地图路径描边都基于它；`null` ＝ 收起详情）
          onSelect: (unitId) => {
            // ★ 场景切换过程中的内部清空（新场景 `selectedId = null`）**不代表用户收起详情** ⇒ 忽略，
            //   否则“跟随切换星区”会把详情自己关掉（切换后由 `selectSceneUnit()` 立即重新打开）
            if (unitId == null && sceneSwitching) return;
            navSelId = unitId == null ? null : unitId;
            paintNavFocus(); // 立即重画高亮（不等下一次 refresh）
          },
        },
      })
    : null;
  sbStageEl.classList.toggle('hidden', !sceneHost); // 无实例 ⇒ 隐藏舞台（避免空框）
  if (sceneHost) sceneHost.refresh();
}

function applyTransform() {
  if (!canvasEl) return;
  // ★★ **拖拽范围：不设限制（用户口径 · 方案 A）** —— 已**完全取消平移夹取**：
  //   · 原实现把 `tx/ty` 夹在「内容不越出视口（±PAN_PAD 容差）」内 ⇒ 处在星域边缘的星区**无法**被拖到
  //     视口中心、更无法拖到对侧；现在**自由平移**，任何边缘星区都能拖到中心或视口另一侧；
  //   · 副作用口径未变：视口仍 `overflow:hidden`（内容**绝不溢出**到其它 UI 之上）；
  //     缩放（滚轮锚点、0.5×~2.6×）与「重置视图」的居中逻辑**均未改动**（重置会把 translate 归位到初始居中）；
  //   · 迷路兜底：顶栏既有「重置视图」按钮即为唯一复位入口（**不新增控件**），并在提示文案里写明可自由拖拽。
  canvasEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  gridEl.classList.remove('sf-zoom-far', 'sf-zoom-mid', 'sf-zoom-near');
  gridEl.classList.add(`sf-zoom-${zoomTier()}`);
  if (zoomEl) setText(zoomEl, `${Math.round(scale * 100)}%`);
}

/** 以某点为锚点缩放（锚点保持不动；无锚点＝视口中心） */
function zoomAt(next, anchorX, anchorY) {
  const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
  if (k === scale) return;
  const view = viewportEl;
  const ax = anchorX == null ? (view ? view.clientWidth / 2 : 0) : anchorX;
  const ay = anchorY == null ? (view ? view.clientHeight / 2 : 0) : anchorY;
  tx = ax - (ax - tx) * (k / scale);
  ty = ay - (ay - ty) * (k / scale);
  scale = k;
  applyTransform();
}

function zoomBy(factor) {
  zoomAt(scale * factor);
}

function resetView() {
  scale = 1;
  const view = viewportEl;
  const baseW = gridEl.offsetWidth || 0;
  const baseH = gridEl.offsetHeight || 0;
  // 复位＝居中（内容小于视口时居中，大于时对齐起点）
  tx = Math.min(0, ((view ? view.clientWidth : 0) - baseW) / 2);
  ty = Math.min(0, ((view ? view.clientHeight : 0) - baseH) / 2);
  applyTransform();
}

/** 选中/取消选中某星区（`null` ⇒ 收起侧栏） */
function selectSector(index) {
  selectedIndex = index == null ? null : index;
  for (const [idx, ref] of cellRefs) ref.cell.classList.toggle('selected', idx === selectedIndex);
  if (!sidebarEl) return;
  const open = selectedIndex != null;
  sidebarEl.classList.toggle('hidden', !open);
  // ★ C-2：关闭侧栏 ⇒ 卸载场景（停止该区 UI 刷新）；切换星区 ⇒ 卸载旧区 + 挂载新区
  mountSceneFor(selectedIndex);
  if (open) refresh();
}

let dragState = null;
let suppressClick = false;

/* ---------- 侧栏宽度拖拽（会话内记忆；上限＝「地图仅剩一列星区」） ---------- */

let splitterDrag = null;

/** ★ **单列星区的实际渲染宽度**（用于推导侧栏上限）：`网格内容宽 ÷ 列数`——
 *  网格是 CSS grid（`repeat(cols, var(--sf-cell))` + gap），因此列步长＝内容宽/列数，天然把
 *  **格子宽 + 列间距**都算进去；容器内边距/滚动条由调用处的**留白常量**覆盖。 */
function oneColumnWidth() {
  if (!gridEl || gridCols <= 0) return 0;
  const w = gridEl.offsetWidth || gridEl.scrollWidth || 0;
  return w > 0 ? w / gridCols : 0;
}

/** ★ **夹取侧栏宽度**：`[SIDEBAR_MIN_W, 可用宽度 − 单列星区宽 − 留白]`
 *  · **上限推导**（不再用写死的 240px 常量）：`bodyW`＝`.sf-body` 实际可用宽（含视口 + 把手 + 侧栏），
 *    上限 ＝ `bodyW − 单列星区宽 − SF_SIDE_PAD(24px 留白)` ⇒ 拖到底时**地图恰好多出“一列星区”的宽度**；
 *  · **下限**：`SIDEBAR_MIN_W = 220px`（与既有口径一致）；
 *  · **默认值（★ 用户口径：半屏）**：`v == null`（＝用户**未拖动过**）⇒ 目标宽 ＝ `bodyW × 0.5`；
 *    用户拖动过（调用方传入数值）⇒ 以该数值为准（**会话内记忆优先**）；
 *  · **确定性退化规则**：若窗口极窄导致「上限 < 下限」（数学上不可行）⇒ 取 `SIDEBAR_MIN_W`
 *    （即**优先保住侧栏可用性**，地图可横向滚动）；`bodyW/单列宽` 取不到（首帧未布局）⇒ 退回默认宽。 */
function clampSidebarW(v) {
  const bodyW = viewportEl && viewportEl.parentElement ? viewportEl.parentElement.clientWidth : 0;
  const colW = oneColumnWidth();
  const hi = bodyW > 0 && colW > 0 ? bodyW - colW - SF_SIDE_PAD : SIDEBAR_DEFAULT_W;
  const want = Number.isFinite(v) ? v : bodyW > 0 ? bodyW * SIDEBAR_DEFAULT_RATIO : SIDEBAR_DEFAULT_W;
  if (!(hi >= SIDEBAR_MIN_W)) return SIDEBAR_MIN_W; // ★ 极窄窗口的确定性退化
  return Math.round(Math.max(SIDEBAR_MIN_W, Math.min(hi, want)));
}

/** 应用侧栏宽度（唯一写入口）：
 *  · `sidebarUserSet === false`（用户未拖动过）⇒ 传 `null` ⇒ **每次都按当前可用宽取半屏**
 *    （窗口 resize 后仍是半屏）；拖动过 ⇒ 用记忆值，只在 resize 时**夹取**、不回到半屏。 */
function applySidebarW() {
  if (sidebarEl) {
    sidebarW = clampSidebarW(sidebarUserSet ? sidebarW : null);
    sidebarEl.style.flexBasis = `${sidebarW}px`;
  }
  // 宽度变化后地图可用区域变了 ⇒ 重新夹取平移量（内容不越界的口径保持）
  applyTransform();
  // ★ 图例栏联动：拖拽改宽 / 窗口 resize 都汇聚到这里 ⇒ 同一处重新判定「2/3 阈值隐藏」
  syncLegendVisibility();
}

/* ---------- ★ 图例栏：不换行 ＋ 「压缩到自然宽的 2/3 就整栏隐藏」 ---------- */

let legendNaturalW = 0; // 图例栏**自然宽度**缓存（不写死像素：一次测量后缓存，resize/重建时重算）

/** 测量并缓存自然宽（`nowrap` 下 `scrollWidth` 即自然宽；隐藏状态测得 0 ⇒ 只在可见时重算，避免抖动） */
function measureLegend() {
  if (!legendEl || legendEl.classList.contains('hidden')) return;
  const w = legendEl.scrollWidth || 0;
  if (w > 0) legendNaturalW = w;
}

/** 阈值判定（**按实际渲染宽度推导**）：
 *  · 可用宽 ＝ `.sf-viewport.clientWidth`（图例是**绝对定位覆盖层** ⇒ 其显隐不改变该值 ⇒ 无反馈抖动）；
 *  · **隐藏**：可用宽 < 自然宽 × 2/3；**恢复显示**：可用宽 ≥ 自然宽 × 0.7（**滞回**，避免临界来回跳）；
 *  · 自然宽未知（首帧尚未测量）⇒ 不判定，保持现状。 */
function syncLegendVisibility() {
  if (!legendEl || !viewportEl || legendNaturalW <= 0) return;
  const avail = viewportEl.clientWidth || 0;
  if (avail <= 0) return;
  const hidden = legendEl.classList.contains('hidden');
  if (!hidden && avail < legendNaturalW * (2 / 3)) legendEl.classList.add('hidden');
  else if (hidden && avail >= legendNaturalW * 0.7) legendEl.classList.remove('hidden');
}

function onSplitterDown(e) {
  if (e.button !== 0) return;
  splitterDrag = { x: e.clientX, w: sidebarEl ? sidebarEl.offsetWidth : sidebarW };
  e.currentTarget.setPointerCapture(e.pointerId);
  document.body.classList.add('sf-col-resize');
  e.preventDefault();
}

function onSplitterMove(e) {
  if (!splitterDrag) return;
  // 侧栏在右 ⇒ 指针左移（dx < 0）增大宽度；★ 一旦拖动过 ⇒ 标记「用户已设定」⇒ 会话内记忆优先于半屏默认
  sidebarUserSet = true;
  sidebarW = clampSidebarW(splitterDrag.w - (e.clientX - splitterDrag.x));
  applySidebarW();
}

function onSplitterUp(e) {
  if (!splitterDrag) return;
  splitterDrag = null;
  document.body.classList.remove('sf-col-resize');
  if (e && e.currentTarget && e.currentTarget.releasePointerCapture) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 指针已释放（如 pointercancel）⇒ 忽略 */
    }
  }
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  dragState = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
  suppressClick = false;
}

function onPointerMove(e) {
  if (!dragState) return;
  const dx = e.clientX - dragState.x;
  const dy = e.clientY - dragState.y;
  if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) dragState.moved = true;
  if (!dragState.moved) return;
  suppressClick = true; // 拖拽过 ⇒ 抬起时的 click 不再当作“点击选中”
  tx = dragState.tx + dx;
  ty = dragState.ty + dy;
  applyTransform();
  viewportEl.classList.add('dragging');
}

function onPointerUp() {
  if (!dragState) return;
  dragState = null;
  if (viewportEl) viewportEl.classList.remove('dragging');
}

function onWheel(e) {
  e.preventDefault(); // 非被动监听（见挂载处的 {passive:false}）
  const rect = viewportEl.getBoundingClientRect();
  zoomAt(scale * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), e.clientX - rect.left, e.clientY - rect.top);
}

function onGridClick(e) {
  if (suppressClick) {
    suppressClick = false;
    return; // 刚做过拖拽平移 ⇒ 忽略本次点击
  }
  const cell = e.target instanceof Element ? e.target.closest('.sf-cell') : null;
  if (!cell || cell.classList.contains('sf-void')) return;
  const idx = Number(cell.dataset.index);
  if (!Number.isFinite(idx)) return;
  selectSector(selectedIndex === idx ? null : idx); // ★ 再点同一格 ⇒ 收起
}

/* ---------- ★★ 阶段 2：拖拽下达「星区间移动」（拖源＝侧栏单位卡；落点＝地图格子） ---------- */

/** 设置/清除落点高亮（同一时刻至多一格；`.sf-cell.drop-target` **仅描边**，见 `css/screens.css`） */
function setDropCell(cell) {
  if (dropCell === cell) return;
  if (dropCell) dropCell.classList.remove('drop-target');
  dropCell = cell || null;
  if (dropCell) dropCell.classList.add('drop-target');
}

/** 结束一次拖拽（清登记 + 清高亮；**幂等**） */
function endNavDrag() {
  navDragUnitId = null;
  setDropCell(null);
}

/** 失败原因文案：`reason` 与引擎 `moveUnitTo` 词表**一一对应**（缺词条 ⇒ 原样回显，不造词） */
function moveReasonText(reason) {
  const key = `starfield.move.${reason || 'none'}`;
  const t = i18n.t(key);
  return t && !t.startsWith('??') ? t : String(reason || '');
}

/** 顶栏**短提示**（非法下达专用；自动消隐 ⇒ 不常驻、不遮挡） */
function showMoveMsg(text) {
  if (!moveMsgEl) return;
  moveMsgEl.textContent = text;
  moveMsgEl.classList.remove('hidden');
  if (moveMsgTimer) clearTimeout(moveMsgTimer);
  moveMsgTimer = setTimeout(() => {
    moveMsgTimer = 0;
    if (moveMsgEl) moveMsgEl.classList.add('hidden');
  }, 2600);
}

/** `dragover`（网格级事件委托，**只对“单位卡拖拽”生效**）：
 *  · 非空位格 ⇒ `preventDefault()` 允许落下 + 高亮该格；空位/网格外 ⇒ 清除高亮（不拦截、不改变既有行为）。 */
function onGridDragOver(e) {
  if (!navDragUnitId) return; // 非本功能的拖拽（如文件拖入）⇒ 一律不管
  const cell = e.target instanceof Element ? e.target.closest('.sf-cell') : null;
  if (!cell || cell.classList.contains('sf-void')) {
    setDropCell(null);
    return;
  }
  e.preventDefault(); // HTML5 DnD：不 preventDefault 则不允许 drop
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  setDropCell(cell);
}

function onGridDragLeave(e) {
  if (!navDragUnitId) return;
  // 指针离开**整张网格**（而非在格子之间移动）时才清高亮
  const to = e.relatedTarget;
  if (!(to instanceof Node) || !gridEl || !gridEl.contains(to)) setDropCell(null);
}

function onGridDrop(e) {
  if (!navDragUnitId) return;
  e.preventDefault();
  const cell = e.target instanceof Element ? e.target.closest('.sf-cell') : null;
  const unitId = navDragUnitId;
  endNavDrag(); // 先收尾（无论成败都清高亮）
  if (!cell || cell.classList.contains('sf-void')) return;
  const idx = Number(cell.dataset.index);
  if (!Number.isFinite(idx)) return;
  const sf = getStarfield();
  if (!sf) return;
  // ★ **唯一写入口**：UI 只调用、不自算（可达性/冷却/能量判据全在引擎）
  const res = sf.moveUnitTo(unitId, idx);
  if (!res || !res.ok) {
    showMoveMsg(i18n.t('starfield.move.failed', { reason: moveReasonText(res && res.reason) }));
    return; // 非法 ⇒ 不改队列、不改任何字段（引擎侧本就无副作用）
  }
  // ★ **拖到“自身所在星区” ＝ 取消移动**（引擎成功返回 `cancelled`；**不是失败**）：
  //   仅当本次**确实清掉了一条指令**（`cleared === true`）才提示；本来就没有指令 ⇒ 静默无操作。
  if (res.cancelled) {
    if (res.cleared) showMoveMsg(i18n.t('starfield.move.cancelled'));
    refresh(); // 取消后立即清掉卡片上的 `⇥#n` 与地图路径描边
    return;
  }
  refresh(); // 立即反映“排队标记 / 已冻结冷却”，不等下一 tick
}

/* ---------- tick 驱动（打开期间推进星域；离开路由即停） ---------- */

function onTick() {
  if (!mounted || router.current !== 'starfieldMap') return;
  const sf = getStarfield();
  if (!sf) return;
  // ★ 时间耗尽/手动停止后不再推进（容器自身也会拒绝 step；此处只是省掉空调用）
  if (!sf.finished && !sf.stopped) sf.step(1);
  // ★ 延后一拍：本帧所有 tick 同步回调跑完后再刷新 ⇒ 读到本 tick 结算后的状态（体例同 battleView）
  queueMicrotask(() => {
    if (mounted && router.current === 'starfieldMap') refresh();
  });
}

function bindGlobalListeners() {
  if (bindGlobalListeners.bound) return;
  bindGlobalListeners.bound = true;
  bus.on('tick', onTick);
  // ★ 窗口尺寸变化 ⇒ 用**同一夹取函数**重算侧栏宽度（保证「地图至少剩一列星区」在 resize 后仍成立）
  window.addEventListener('resize', () => applySidebarW());
  bus.on('route', ({ name }) => {
    if (name !== 'starfieldMap') {
      // ★ 离开视图 ⇒ 停止驱动（不再 step）；DOM 由 router 换掉，引用清空即可
      mounted = false;
      dragState = null;
      splitterDrag = null; // 调宽拖拽同样清空（宽度值本身保留在 `sidebarW` ⇒ 会话内记忆）
      // ★ 阶段 2：清拖拽中间态 + 提示定时器 + 跟随目标/描边（DOM 即将被 router 换掉 ⇒ 引用一并置空）
      navDragUnitId = null;
      dropCell = null;
      navSelId = null;
      navFocusCells.length = 0;
      sceneSwitching = false;
      if (moveMsgTimer) {
        clearTimeout(moveMsgTimer);
        moveMsgTimer = 0;
      }
      moveMsgEl = null;
      // ★ C-2：离开地图 ⇒ **卸载侧栏场景**（还原 battleView 的场景引用；**不停星区实例**）
      mountSceneFor(null);
      sbStageEl = null;
      sbTitleEl = null;
    }
  });
}

/* ---------- 视图入口 ---------- */

function root() {
  bindGlobalListeners();
  mountSceneFor(null); // ★ C-2 防御：重绘前先卸载旧侧栏场景（严格还原 battleView 的场景引用）
  // ★ 阶段 2：重绘 ⇒ 拖拽中间态、提示定时器、描边引用一并归零（DOM 全量重建，旧引用不再有效）
  endNavDrag();
  navFocusCells.length = 0; // ★ 描边引用指向旧 DOM ⇒ 必须清空（`cellRefs` 会随建图重建）
  if (moveMsgTimer) {
    clearTimeout(moveMsgTimer);
    moveMsgTimer = 0;
  }
  const sf = ensureStarfield(); // 兜底：尚无星域实例时用「默认配置 h1 + 随机种子」建一个（见 starfieldSession.js）
  const body = el('div', { class: 'sf-body' });
  viewportEl = el('div', { class: 'sf-viewport' }, [buildGrid(sf)]);
  legendEl = null;
  buildLegend(sf);
  viewportEl.appendChild(legendEl);
  // ★ 侧栏宽度拖拽把手（体例同战斗屏战报框下缘的 `.log-resize` 手柄：pointer 事件 + 指针捕获）
  const splitter = el('div', { class: 'sf-splitter', title: i18n.t('starfield.map.resize') });
  body.append(viewportEl, splitter, buildSidebar());
  applySidebarW(); // 恢复**会话内记忆**的侧栏宽度
  const section = el('section', { class: 'screen screen-starfield' }, [
    buildTopbar(),
    body,
    // ★ 地图下方的操作说明**已按用户口径整段移除**（原 `starfield.map.hint` 与阶段 2 追加的
    //   `starfield.move.hint` 两行 `.sf-hint` 段落、其 CSS 规则与两条 i18n 键一并清理；
    //   顶栏（难度/种子/倒计时/状态）与缩放按钮等其它元素**一字未动**）。
  ]);

  // 事件绑定（每次重绘重新绑；DOM 一并重建 ⇒ 无残留监听）
  viewportEl.addEventListener('wheel', onWheel, { passive: false });
  viewportEl.addEventListener('pointerdown', onPointerDown);
  viewportEl.addEventListener('pointermove', onPointerMove);
  viewportEl.addEventListener('pointerup', onPointerUp);
  viewportEl.addEventListener('pointerleave', onPointerUp);
  gridEl.addEventListener('click', onGridClick);
  // ★ 阶段 2：拖拽下达（只用 `drag*` 事件族 ⇒ 与既有 `pointer*` 平移/点击链路**互不干扰**）
  gridEl.addEventListener('dragover', onGridDragOver);
  gridEl.addEventListener('dragleave', onGridDragLeave);
  gridEl.addEventListener('drop', onGridDrop);
  splitter.addEventListener('pointerdown', onSplitterDown);
  splitter.addEventListener('pointermove', onSplitterMove);
  splitter.addEventListener('pointerup', onSplitterUp);
  splitter.addEventListener('pointercancel', onSplitterUp);

  mounted = true;
  // 首帧：等布局完成后再算尺寸（transform 依赖 offsetWidth/clientWidth）
  requestAnimationFrame(() => {
    applySidebarW(); // 布局完成后按真实宽度再夹取一次（保证地图至少留一列星区）
    measureLegend(); // ★ 布置完成后测量图例自然宽（用于「压缩到 2/3 即整栏隐藏」判定）
    syncLegendVisibility();
    resetView();
    refresh();
    selectSector(selectedIndex); // 重绘后恢复侧栏开合状态
  });
  return section;
}

export const starfieldMapView = { root };

export default starfieldMapView;
