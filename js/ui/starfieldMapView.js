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
 */
import { el } from '../core/utils.js';
import { bus } from '../core/eventBus.js';
import { i18n } from '../i18n/index.js';
import { formatTickSeconds } from '../core/tick.js';
import { getSectorType } from '../data/sectorTypes/index.js';
import { router } from './router.js';
import { ensureStarfield, getStarfield } from './starfieldSession.js';
import { unitIcon } from './unitIcon.js'; // ★ 单位图标**唯一口径**（与战斗屏共用；见 `ui/unitIcon.js`）

/* ---------- 交互常量（纯表现层参数，非游戏数值） ---------- */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.6;
const ZOOM_STEP = 1.15; // 滚轮/按钮每档倍率
const DRAG_THRESHOLD = 4; // 位移小于该像素数 ⇒ 视为“点击选中”而非“拖拽平移”
const PAN_PAD = 40; // 平移夹取的容差（像素）
/* ★ **格内单位预览的图标上限与省略规则**（用户口径要求：写进注释并回报）：
 *  · 只统计**存活**单位（`u.alive`）；死亡/已移除者**不显示预览**；
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

/* ★ 侧栏宽度（**会话内记忆**：模块级变量 ⇒ 切换星区/重绘/离开再进入都保持；刷新页面自然重置） */
const SIDEBAR_MIN_W = 220;
const SIDEBAR_MAX_W = 560;
const SIDEBAR_DEFAULT_W = 300;
let sidebarW = SIDEBAR_DEFAULT_W;

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
let sbTypeEl = null;
let sbRowsEl = null;
let selectedIndex = null;
let scale = 1;
let tx = 0;
let ty = 0;
const cellRefs = new Map(); // index → { cell, units, unitSig, bars:{ore,cargo}, cache:{…} }（DOM 复用 + 变化才写）
let sbRenderedIndex = null; // 侧栏当前已渲染的星区 index（null＝需重建行结构）
let sbValueRefs = []; // 侧栏各行的值节点（`dd`，与 SIDEBAR_ROW_KEYS 同序；每 tick 只改变化的值）
/** 侧栏行的**标签词条 key**（顺序＝显示顺序；值节点与之一一对应） */
const SIDEBAR_ROW_KEYS = [
  'starfield.sidebar.index',
  'starfield.sidebar.coord',
  'starfield.sidebar.type',
  'starfield.sidebar.alive',
  'starfield.sidebar.ore',
  'starfield.sidebar.cargo',
  'starfield.sidebar.cd',
  'starfield.sidebar.logLines',
  'starfield.sidebar.phase',
];

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
  zoomEl = el('div', { class: 'sf-zoom-label', text: '100%' });
  const bar = el('div', { class: 'sf-topbar' }, [
    back,
    el('div', { class: 'sf-title', text: i18n.t('starfield.map.title') }),
    el('div', { class: 'sf-top-meta' }, [metaEl, remainEl, statusEl]),
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
        // ★ 格内预览（本轮改版）：**上＝存活单位图标行**（缩放层级 1）、**下＝矿物/货物进度条**（层级 2）；
        //   **不再显示文字摘要**（文字信息保留在悬停 title 与右侧侧栏里）。
        const units = el('div', { class: 'sf-detail sf-detail-1 sf-units' });
        // 两条条各自独立（**当前值为 0 ⇒ 该条隐藏**；两条都隐藏 ⇒ 整块隐藏）：
        //   矿物条＝`--ore` 主题色、货物条＝`--cargo` 主题色（**不新增配色**），样式族复用 `.bar-track`/`.bar-fill`
        const oreRow = el('div', { class: 'sf-bar sf-bar-ore' }, [
          el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: { background: 'var(--ore)' } })]),
        ]);
        const cargoRow = el('div', { class: 'sf-bar sf-bar-cargo' }, [
          el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: { background: 'var(--cargo)' } })]),
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

/** 侧栏（本轮＝**星区摘要面板**；★ C-2 的完整战斗场景挂到 `.starfield-sidebar-stage`） */
function buildSidebar() {
  sbTypeEl = el('div', { class: 'sf-sb-type' });
  sbRowsEl = el('dl', { class: 'sf-sb-rows' });
  sidebarEl = el(
    'aside',
    { class: 'starfield-sidebar hidden' },
    [
      el('div', { class: 'sf-sb-head' }, [
        el('span', { class: 'sf-sb-title', text: i18n.t('starfield.sidebar.title') }),
        el('button', {
          class: 'btn tiny',
          text: i18n.t('starfield.sidebar.close'),
          onclick: () => selectSector(null),
        }),
      ]),
      el('div', { class: 'sf-sb-body' }, [sbTypeEl, sbRowsEl]),
      // ★★ **C-2 挂载点**：后续步骤在此渲染该星区的**完整战斗场景**（可操作指挥；数据取自
      //    `starfield.battleOf(index)` 的既有只读口径 + `battle.log`）。本轮**只留容器**，不渲染任何战斗内容。
      el('div', { class: 'starfield-sidebar-stage' }),
      el('p', { class: 'sf-sb-todo', text: i18n.t('starfield.sidebar.stageTodo') }),
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

/** 侧栏内容（全部来自 `sectors` 快照；UI 不自算）
 *  ★ DOM 复用：**切换星区/首次打开时**才重建行结构（标签 + dd 容器），此后每 tick 只把**变化的**值写进
 *    已存在的 `dd`（体例同既有货物芯片/单位卡的“变化才更新”）⇒ 侧栏开着时也不会每 tick 重建 DOM。 */
function refreshSidebar(sf) {
  if (selectedIndex == null) return;
  const s = sf.sectors.find((x) => x.index === selectedIndex);
  if (!s) {
    // 选中项已不存在（例如换了星域）⇒ 自动收起
    selectSector(null);
    return;
  }
  const cdIds = Object.keys(s.cd || {});
  const cdText = cdIds.length
    ? cdIds.map((id) => `${i18n.t(`module.${id}`)} ${formatTickSeconds(s.cd[id])}s`).join(' · ')
    : i18n.t('starfield.sidebar.none');
  const values = [
    `#${s.index}`,
    `(${s.q}, ${s.r})`,
    typeName(s.typeId),
    i18n.t('starfield.cell.alive', { a: s.alive.ally, e: s.alive.enemy }),
    `${s.ore} / ${s.oreInit}`, // 矿物：当前 / 初始（与格内矿物条**同一分母口径**）
    `${s.cargoCount} / ${s.cargoInit}`, // 货物：当前件数 / **初始件数**（与格内货物条同一分母口径）
    cdText,
    String(s.logLines),
    phaseText(s),
  ];
  if (sbRenderedIndex !== s.index) {
    // 结构重建（切换星区 / 语言切换后重绘 / 首次打开）
    const def = typeOf(s.typeId);
    paintCell(sbTypeEl, def);
    // ★ 贴图（预留）：与地图格子同一口径 —— 有 `texture` ⇒ 渲染贴图（C-2 的正式侧栏同样用它）；
    //   为空/加载失败 ⇒ 回退 marker（CSS `.has-tex .sf-sb-marker{display:none}`）。
    const sbTex = buildTexture(def);
    sbTypeEl.replaceChildren(
      ...(sbTex ? [sbTex, el('span', { class: 'sf-sb-marker' })] : [el('span', { class: 'sf-sb-marker' })]),
      el('span', { class: 'sf-sb-typename', text: `#${s.index} ${typeName(s.typeId)}` })
    );
    sbTypeEl.classList.toggle('has-tex', !!sbTex);
    sbRowsEl.replaceChildren(
      ...SIDEBAR_ROW_KEYS.map((key) =>
        el('div', { class: 'sf-sb-row' }, [el('dt', { text: i18n.t(key) }), el('dd')])
      )
    );
    sbValueRefs = [...sbRowsEl.querySelectorAll('dd')];
    sbRenderedIndex = s.index;
  }
  values.forEach((v, i) => setText(sbValueRefs[i], v)); // ★ 只有值变化时才写 DOM（setText 内部比较）
}

/** 统一刷新（每 tick 调用一次；`queueMicrotask` 中执行 ⇒ 读到本 tick 结算后的状态） */
function refresh() {
  const sf = getStarfield();
  if (!mounted || !sf || !gridEl) return;
  refreshTopbar(sf);
  refreshCells(sf);
  refreshSidebar(sf);
}

/* ---------- 缩放 / 平移 / 选中 ---------- */

function zoomTier() {
  if (scale < 0.8) return 'far';
  if (scale < 1.3) return 'mid';
  return 'near';
}

function clampAxis(v, content, view) {
  const lo = Math.min(0, view - content) - PAN_PAD;
  const hi = Math.max(0, view - content) + PAN_PAD;
  return Math.max(lo, Math.min(hi, v));
}

function applyTransform() {
  if (!canvasEl) return;
  // ★ 内容尺寸＝未缩放的网格尺寸（offsetWidth/Height 不受 transform 影响）
  const view = viewportEl;
  const baseW = gridEl.offsetWidth || 0;
  const baseH = gridEl.offsetHeight || 0;
  const viewW = view ? view.clientWidth : 0;
  const viewH = view ? view.clientHeight : 0;
  tx = clampAxis(tx, baseW * scale, viewW);
  ty = clampAxis(ty, baseH * scale, viewH);
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
  sbRenderedIndex = null; // 开合/切换 ⇒ 下次刷新重建行结构
  if (open) refresh();
}

let dragState = null;
let suppressClick = false;

/* ---------- 侧栏宽度拖拽（会话内记忆；夹取在 MIN/MAX 与「地图至少留 240px」之间） ---------- */

let splitterDrag = null;

/** 夹取侧栏宽度：`[SIDEBAR_MIN_W, SIDEBAR_MAX_W]`，并保证**地图视口至少留 240px** */
function clampSidebarW(v) {
  const bodyW = viewportEl && viewportEl.parentElement ? viewportEl.parentElement.clientWidth : 0;
  const byBody = bodyW ? Math.max(SIDEBAR_MIN_W, bodyW - 240) : SIDEBAR_MAX_W;
  const hi = Math.min(SIDEBAR_MAX_W, byBody);
  return Math.round(Math.max(SIDEBAR_MIN_W, Math.min(hi, v)));
}

/** 应用侧栏宽度（唯一写入口；`sidebarW` 为**会话内记忆**的模块级变量） */
function applySidebarW() {
  if (sidebarEl) {
    sidebarW = clampSidebarW(sidebarW);
    sidebarEl.style.flexBasis = `${sidebarW}px`;
  }
  // 宽度变化后地图可用区域变了 ⇒ 重新夹取平移量（内容不越界的口径保持）
  applyTransform();
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
  // 侧栏在右 ⇒ 指针左移（dx < 0）增大宽度
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
  bus.on('route', ({ name }) => {
    if (name !== 'starfieldMap') {
      // ★ 离开视图 ⇒ 停止驱动（不再 step）；DOM 由 router 换掉，引用清空即可
      mounted = false;
      dragState = null;
      splitterDrag = null; // 调宽拖拽同样清空（宽度值本身保留在 `sidebarW` ⇒ 会话内记忆）
    }
  });
}

/* ---------- 视图入口 ---------- */

function root() {
  bindGlobalListeners();
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
    el('p', { class: 'sf-hint', text: i18n.t('starfield.map.hint') }),
  ]);

  // 事件绑定（每次重绘重新绑；DOM 一并重建 ⇒ 无残留监听）
  viewportEl.addEventListener('wheel', onWheel, { passive: false });
  viewportEl.addEventListener('pointerdown', onPointerDown);
  viewportEl.addEventListener('pointermove', onPointerMove);
  viewportEl.addEventListener('pointerup', onPointerUp);
  viewportEl.addEventListener('pointerleave', onPointerUp);
  gridEl.addEventListener('click', onGridClick);
  splitter.addEventListener('pointerdown', onSplitterDown);
  splitter.addEventListener('pointermove', onSplitterMove);
  splitter.addEventListener('pointerup', onSplitterUp);
  splitter.addEventListener('pointercancel', onSplitterUp);

  mounted = true;
  // 首帧：等布局完成后再算尺寸（transform 依赖 offsetWidth/clientWidth）
  requestAnimationFrame(() => {
    applySidebarW(); // 布局完成后按真实宽度再夹取一次（保证地图至少留 240px）
    resetView();
    refresh();
    selectSector(selectedIndex); // 重绘后恢复侧栏开合状态
  });
  return section;
}

export const starfieldMapView = { root };

export default starfieldMapView;
