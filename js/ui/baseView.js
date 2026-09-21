/* ===== ui/baseView.js —— 主基地屏（M3a 骨架：顶部资源栏 + 左列表 + 右面板） =====
 * 定位（主基地框架说明 §3）：左侧**建筑列表**，右侧**当前建筑面板**，顶部**五资源栏** + 返回主菜单。
 * ★ 只读口径：本视图**只读** `systems/base.js` 的 `snapshot()` 与只读的 `previewFleetSpec()`；
 *   **不自算**任何资源、上限、消耗、造价、返还、槽位（⇒ 界面里没有任何数值与公式）。
 *   · 资源栏 与 星球面板的资源用途：遍历 `data/resources.js` 的 `RESOURCE_LIST`（注册表驱动，不硬编码顺序）；
 *   · 左列表：遍历 `data/baseBuildings/index.js` 的 `BASE_LIST_ITEMS`（**不硬编码列表顺序 / 列表项 id**）；
 *   · 默认选中项 ＝ 列表**首项**（配置 `order` 升序 ⇒ 星门），**不写死** `'stargate'` 字符串。
 * ★ 切换方式（体例沿用 `ui/starfieldConfigView.js` 的"只改变化项"）：
 *   点击左列表**不重建整屏** —— 只①切换新旧两个按钮的选中态、②重建**右侧面板**的内容。
 *
 * ★★ M3a 修订（用户口径）：
 *   ① **「舰队」不再是左列表项**（左列表 ＝ 5 个建筑）；舰队并入**船坞**；
 *   ② **面板副标题随建筑变化**：取值键 ＝ `snapshot().listItems[].metaKey`（约定 `building.<id>.meta`）；
 *      ★ 标题、副标题、「等级 / 上限」**三者同处一行**（等级/上限靠右、自身不换行）；
 *   ③ **资源上限**：资源栏显示当前值，悬浮 `title` ＝「当前 / 上限」；达上限给 `.is-full`（只用既有 `--warn`）；
 *   ④ 界面内**不写任何控制台 / 命令说明**（调试入口只在 `main.js` 的 `window.LS`）。
 *
 * ★★ M3b（**船坞实装**）：面板按**配置的 `zones[].key` 分派**（**不硬编码建筑 id**）：
 *   · `fleet` ⇒ **舰队表格**（配置 + 建造 + 拆解**合并为同一张表**）；其它 `key` ⇒ M3a 占位。
 *   ★ **数值零自算**：图标 / 造价 / 返还 / 容量 / 槽位 / 模块筹码 / 能否建造·拆解·删除 全部来自
 *     `snapshot().fleet`；弹窗草稿用 `previewFleetSpec()`（同样由引擎给出 chips / 槽位 / 造价 / 原因）。
 *   ★ 交互口径：资源不足 / 容量已满 / 蓝图不够 / 尚有船在编 ⇒ **按钮禁用 ＋ 悬浮 `title` 说明**
 *     （文案＝`base.reason.<code>`），**不弹窗、不报错、不打日志**。
 *   ★ 刷新口径（"只改变化项、不重建整屏"）：动作后 ①**就地更新顶部资源栏的数值节点**，
 *     ②只**重建右侧面板**与**弹窗挂载点**（左列表 DOM 与顶栏结构保持不动）。
 *
 * ★★ M3b 迭代（**用户四项要求**）：
 *   ① **模块可重复 + 可设等级**：同一 `moduleId` 可在一格里出现多次（唯一上限仍是槽位数）；
 *      每个已装模块条目可**单独设等级**（1..该模块 `maxLevel`）；造价按**模块等级**取 `installCost`；
 *   ② **配置编辑＝弹窗（Dialog）**：交互与视觉对齐 `ui/setupView.js`（编队屏）的既有体例 ——
 *      单位图标走 `ui/unitIcon.js`、模块筹码走 `.module-chip` 同一类名与层级、
 *      模块等级用下拉、按钮成行；浮层**沿用战斗屏 `.battle-overlay` 的体例**，内层盒子**直接用既有的
 *      `.settle-panel`**（本文件只加布局修饰 `.base-dialog`）——**不另创一套弹窗风格**；
 *      含 **Enter 保存 / Esc 关闭 / 点击遮罩关闭 / 打开即初始化默认值 / 关闭后焦点归位**；
 *   ③ **一行一条配置**：列序**严格**＝①配置名称 ②单位图标 ③单位类型 ④等级 ⑤模块图标行（含空槽位占位）
 *      ⑥**预留空列** ⑦造价 ⑧返还 ⑨数量；**操作按钮另起一行**；
 *      原先"配置区 + 舰队区各显示一遍数量 / 造价"的重复冗余已消除（表头 + 等宽栅格，列宽稳定）；
 *   ④ **减少冗余文字**：不可操作 ⇒ 灰按钮，原因**只在悬浮 `title`** 里（短语）；
 *      行内不再铺黄字；仅保留"已新建 / 已合并"这类**必要且简短**的提示。
 *
 * ★★ M3b 迭代 3 / 4 / 5（**用户口径**）：
 *   ① 二级弹窗显示**该模块当前等级的造价**（`moduleCostAt()` ⇒ `installCost` 装配 + `removeCost` 拆下，
 *      与表格造价**同一助手** ⇒ 同源同值；呈现仍是"小标签 + 图标 + 数量"）；
 *   ② **增 / 删全部搬进二级弹窗**：底部顺序固定（迭代 4）＝【确认】【新增】【移除】【取消】；
 *      确认＝替换当前槽位、新增＝追加新槽位（可重复）、移除＝删除当前槽位、取消＝不改草稿；
 *      配置弹窗的模块列**只剩图标（含等级）与空槽位占位**（空槽位仍可点 ⇒ 走"新增"；行内不再有"新增"按钮）；
 *   ③ **拖动把手＝`.base-fleet-row` 内最左元素**（`.base-fleet-handle`，迭代 5：**竖向三件套**，
 *      自上而下 ＝ ↑ / ⠿ / ↓，居中；整块可抓可拖、有 hover 反馈）；
 *   ④ **信息列与操作行都 `flex-wrap`** ⇒ 窄屏/长内容自然换行、**不溢出**（固定列宽、`min-width`、横向滚动、
 *      以及与之绑定的表头一行**全部下线**；各字段改为自带悬浮短语，"造价 / 返还"另有可见小标签）；
 *      ★ 迭代 4：**造价 / 返还 / 数量作为一个整体右对齐**（`.base-fleet-info-right`）；
 *   ⑤ 操作行**两组成对**：左组＝编辑 / 删除，右组＝建造 / 拆解（**靠右**）；
 *   ⑥ 默认配置名 ＝ **该语言的船型名**（`base.fleet.defaultName` 模板去掉"编队 / Squad"后缀；这是**单位配置**）。
 *
 * ★★ M3b 迭代 2（**用户口径 A/B 两组**）：
 *   A① **二级弹窗「选择模块」**：在配置弹窗里**点击某个模块图标**即打开 —— 可按**分类筛选**（分类 key 与顺序＝
 *      `data/modules.js` 的 `CATEGORY_ORDER`，两处同一来源）、**独立列表**（图标 + 名称，图标沿用
 *      `ui/moduleGlyph.js`）、**可改该模块等级**（1..该模块 `maxLevel`）、**确认后回填对应条目**
 *      （`index ≥ 0` 替换该条 / `−1` 追加；**同一模块可重复添加、每条各自等级**）；
 *      交互与主弹窗一致（Enter 确认 / Esc 关闭 / 遮罩关闭 / 焦点归位），**关二级弹窗不动主弹窗草稿**。
 *      ★ 数据来源**全部**是引擎的 `modulePickerData()`（分类表 + 模块清单 + 每项 `maxLevel/icon/nameKey`）⇒ 界面零自算。
 *      ★ 随之**移除**了"添加模块下拉 + 添加按钮"与每条的等级下拉：添加改由**空槽位**点击进入同一弹窗，
 *        移除仍由筹码旁的 `×` 负责（两个动作**不再混在一个按钮上**）。
 *   A② **弹窗内模块图标放大**（`.base-dialog .module-chip` 34px / 二级列表 30px，图标 24px）⇒ 可点区域明确；
 *      只在 `.base-dialog` 作用域内改尺寸，**战斗屏与表格的尺寸不受影响**，配色仍走 battle.css 的分类色。
 *   A③ **默认配置名走 i18n 模板**（`base.fleet.defaultName`，参数 `{ship}`）—— 由**引擎**在创建时物化，
 *      界面只把它用作输入框 `placeholder`；**不再使用船型 id 字面量**。
 *   B① **造价 / 返还只显示资源图标 + 数量**（图标＝资源注册表 `marker`，配色＝该资源 `colorKey`）；
 *      在外数量文案改为 `{count} 艘 | {out} 在外`（i18n `base.fleet.counts`）。
 *   B② 改名的合并口径：**合并时以草稿的显式新名为准**（引擎 `createFleetConfigIn`，详见其注释）。
 *   B③ **左侧竖向上移/下移按钮＝拖动把手**：顺序持久化在**状态数组顺序**（`reorderFleetConfig(id, 下标)`），
 *      快照按该顺序输出；越界/非法 ⇒ 引擎拒绝且**零改动**。
 *   B④ **操作按钮靠右**（`.base-fleet-ops` 右对齐，窄屏换行不溢出）。
 *
 * ★★ M3b 缺陷修复（两条"看着能跑、其实恒坏"的坑，务必不要再犯）：
 *   ① **禁用只用 property**：`btn.disabled = <bool>`。**绝不**经 `el()` 的 props 传布尔
 *      —— `el()` 对非函数属性一律 `setAttribute` ⇒ `disabled: false` 变成 `disabled="false"`，
 *      而 `disabled` 是**布尔属性：只要出现即生效**（与取值无关）⇒ 按钮**恒灰且无原因**
 *      （体例见 `ui/setupView.js`：`btn.disabled = !ok`；或 `hud.js` 的 `disabled: cond ? 'disabled' : null`）。
 *   ② **面板项唯一来源 ＝ `snapshot().listItems[]`**（见 `renderPanel`）
 *      —— `data/baseBuildings` 的**建筑配置对象里没有 `level`**（等级属于状态），
 *      把它当面板项传入就会渲染出「等级 undefined · 上限 5」。等级与上限**都从快照读，界面不自算**。
 *
 * ★ 语言切换：`router.repaint()` 会重新调用 `root()` 全量重建（体例同其它屏）。
 */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { router } from './router.js';
import { unitIcon } from './unitIcon.js';
import { moduleGlyphEl } from './moduleGlyph.js';
import {
  snapshot,
  previewFleetSpec,
  createFleetConfig,
  cloneFleetConfig,
  deleteFleetConfig,
  build,
  scrap,
  moveFleetConfig,
  reorderFleetConfig,
  modulePickerData,
  moduleCostAt,
  applyModuleSlot,
} from '../systems/base.js';
import { RESOURCE_LIST } from '../data/resources.js';
import { BASE_LIST_ITEMS, getBaseListItem } from '../data/baseBuildings/index.js';
import { SHIPS, SHIP_IDS } from '../data/ships.js';
import { MODULES } from '../data/modules.js';

/** 词条取值（缺失 ⇒ 回退文本；**绝不显示 `??key`**） */
function textOf(key, fallback) {
  if (key && i18n.has(key)) return i18n.t(key);
  return fallback === undefined ? '' : String(fallback);
}

/** 条目显示名（词条缺失时回退条目 id） */
function nameOf(item) {
  return textOf(item && item.nameKey, (item && item.id) || '');
}

/** ★ 面板副标题（**每建筑一句**；键来自快照的 `metaKey` ⇒ 随建筑变化，不再共用一句） */
function metaOf(item) {
  return textOf(item && item.metaKey, '');
}

/** 给元素挂上"该资源的代表色"（**只用注册表给的 CSS 变量名**，不新增色值） */
function tint(node, colorKey) {
  if (colorKey) node.style.setProperty('--base-res-color', `var(${colorKey})`);
  return node;
}

/** ★ 单条资源（图标 + 名称 + 数值）：数值＝**当前值**（直接来自快照，界面不自算）；
 *  悬浮 `title` ＝ 「当前 / 上限」；已达上限 ⇒ `.is-full`（既有 `--warn` 轻微标识）。 */
function resourceItem(it) {
  const node = el(
    'span',
    {
      class: it.full ? 'base-res-item is-full' : 'base-res-item',
      title: `${it.value} / ${it.cap}`,
      // ★ 资源键挂到 DOM 上：动作后**就地更新数值节点**（只改变化项，不重建顶栏）
      'data-res': it.key,
    },
    [
      el('span', { class: 'base-res-marker', text: it.marker }),
      el('span', { class: 'base-res-name', text: textOf(it.nameKey, it.key) }),
      el('span', { class: 'base-res-value', text: String(it.value) }),
    ]
  );
  return tint(node, it.colorKey);
}

/** 顶部资源栏（五种资源 + 返回主菜单；资源顺序＝注册表 `order`） */
function topBar(snap) {
  return el('div', { class: 'base-top' }, [
    el('div', { class: 'base-head' }, [
      el('h2', { class: 'base-title', text: i18n.t('base.title') }),
      el('p', { class: 'base-sub', text: i18n.t('base.subtitle') }),
    ]),
    el(
      'div',
      { class: 'base-res', title: i18n.t('base.resBar') },
      snap.resourceItems.map((r) => resourceItem(r))
    ),
    el('button', { class: 'btn small', text: i18n.t('menu.back'), onclick: () => router.show('menu') }),
  ]);
}

/** 左列表按钮（全部为建筑：名称 +（等级 / 上限）） */
function listButton(item, onSelect) {
  return el(
    'button',
    {
      class: 'base-item',
      type: 'button',
      onclick: () => onSelect(item.id),
    },
    [
      el('span', { class: 'base-item-name', text: nameOf(item) }),
      el('span', { class: 'base-item-meta' }, [
        el('span', { text: i18n.t('base.level', { n: item.level }) }),
        el('span', { class: 'base-item-sep', text: '·' }),
        el('span', { text: i18n.t('base.maxLevel', { n: item.maxLevel }) }),
      ]),
    ]
  );
}

/** ★ 资源种类与用途（星球面板用；§2 表格的精简版 —— 文案全走 i18n，顺序读注册表） */
function resourceUsage() {
  return el('div', { class: 'base-usage' }, [
    el('div', { class: 'base-usage-title', text: i18n.t('base.resUsageTitle') }),
    ...RESOURCE_LIST.map((r) =>
      tint(
        el('div', { class: 'base-usage-row' }, [
          el('span', { class: 'base-res-marker', text: r.marker }),
          el('span', { class: 'base-res-name', text: i18n.t(r.nameKey) }),
          el('span', { class: 'base-usage-desc', text: i18n.t(r.descKey) }),
        ]),
        r.colorKey
      )
    ),
  ]);
}

/* ================= ★ M3b：船坞（**单张合并表格** + 弹窗表单；数值全部来自引擎） ================= */

/** 资源显示名（由注册表 key 反查词条名；未知 ⇒ 原样 key） */
function resourceName(key) {
  const def = RESOURCE_LIST.find((r) => r.key === key);
  return def ? textOf(def.nameKey, key) : String(key);
}

/** 模块显示名（词条缺失 ⇒ 模块 id） */
function moduleName(id) {
  const def = MODULES[id];
  return textOf(def && def.nameKey, id);
}

/** ★ 引擎失败原因 ⇒ 界面**短语**（`base.reason.<code>`；缺词条 ⇒ 回退 code 本身，**绝不显示 `??key`**）
 *  —— 这是"按钮为什么灰着"的**唯一**表达方式（只进 `title`，不弹窗、不在行内铺文字）。 */
function reasonText(reason) {
  if (!reason || !reason.code) return '';
  const key = `base.reason.${reason.code}`;
  if (!i18n.has(key)) return String(reason.code);
  const params = { ...reason };
  if (params.resource) params.resource = resourceName(params.resource);
  if (params.moduleId) params.moduleId = moduleName(params.moduleId);
  return i18n.t(key, params);
}

/** ★ **造价 / 返还的显示**（用户口径 B-1：**只显示资源图标 + 数量，不出现资源名文本**）
 *  · 图标 ＝ 资源注册表既有的 `marker` 字符（**不新增素材**），配色 ＝ 该资源的 `colorKey`（`tint`）；
 *  · 只列**真正 > 0** 的资源（顺序＝注册表 `order`）；全 0 ⇒ 空态短语（`base.fleet.free` / `none`）；
 *  · 完整信息（资源名 + 数量）放在 `title` 里 ⇒ 不占版面、仍可查。 */
function costIcons(costObj, emptyKey) {
  const items = RESOURCE_LIST.filter((r) => costObj && Number(costObj[r.key]) > 0);
  if (!items.length) return [el('span', { class: 'base-cost-empty', text: i18n.t(emptyKey) })];
  return items.map((r) =>
    tint(
      el('span', { class: 'base-cost-item', title: `${textOf(r.nameKey, r.key)} ${costObj[r.key]}` }, [
        el('span', { class: 'base-res-marker', text: r.marker }),
        el('span', { class: 'base-cost-num', text: String(costObj[r.key]) }),
      ]),
      r.colorKey
    )
  );
}

/** ★ 模块筹码（**表格的"模块"字段与弹窗共用**）：**同 `class="module-chip …"` 结构与层级**
 *  （直接复用 `css/battle.css` 既有样式 ⇒ 与战斗单位卡一致，**不另创一套风格**）：
 *   · 已装 ⇒ `<span class="module-chip <category>">` ＋ `ui/moduleGlyph.js` 的图标节点 ＋ `<span class="module-lv">L{n}</span>`；
 *   · 空槽 ⇒ `<span class="module-slot-empty">`（与战斗单位卡**同一空槽类名**）；
 *   · 数据全部来自引擎的筹码描述（**含空槽位占位**）⇒ 界面**不自算槽位数**。 */
function moduleChipEl(chip) {
  if (!chip || chip.empty) return el('span', { class: 'module-slot-empty' });
  const node = el('span', { class: `module-chip ${chip.category || ''}`.trim() });
  node.append(moduleGlyphEl({ id: chip.moduleId, icon: chip.icon, nameKey: chip.nameKey }));
  node.append(el('span', { class: 'module-lv', text: `L${chip.level}` }));
  node.title = i18n.t('base.fleet.moduleOf', { name: moduleName(chip.moduleId), level: chip.level });
  return node;
}

/** 第 5 列：模块图标行（**含空槽位占位** ⇒ 槽位占用一望可知） */
function moduleChipsRow(chips) {
  return el('span', { class: 'base-fleet-chips' }, (chips || []).map((c) => moduleChipEl(c)));
}

/** ★ 操作按钮：能做 ⇒ 正常（`title` ＝ 提示）；不能做 ⇒ **禁用 + 悬浮原因**
 *  （**不弹窗、不报错、不打日志**）
 *  ★ 用一层 `span` 承载 `title`：**禁用按钮在浏览器里不弹悬浮提示**，包一层后悬浮对"灰按钮"同样有效。
 *  ★★ **禁用必须用 property 赋值**（`btn.disabled = …`），**绝不能**经 `el()` 的 props 传布尔：
 *     `core/utils.js el()` 把非函数属性一律 `setAttribute` ⇒ `disabled: false` 会被写成 `disabled="false"`，
 *     而 **`disabled` 是布尔属性（只要出现即生效、与取值无关）** ⇒ 按钮**恒灰且无原因**。 */
function actButton(label, hint, reason, onClick) {
  const ok = !reason;
  const btn = el('button', {
    class: 'btn small base-fleet-act',
    type: 'button',
    text: label,
    onclick: ok ? onClick : null,
  });
  btn.disabled = !ok; // ★ property，不是 attribute（见上方说明）
  return el('span', { class: 'base-act-wrap', title: ok ? hint : `${hint} —— ${reasonText(reason)}` }, [btn]);
}

/** 小统计块（标签 + 数值；数值直接来自快照） */
function statChip(label, value) {
  return el('span', { class: 'base-fleet-stat', title: `${label} ${value}` }, [
    el('span', { class: 'base-fleet-stat-label', text: label }),
    el('span', { class: 'base-fleet-stat-value', text: value }),
  ]);
}

/** 只读槽位 / 等级上限（**走引擎干跑**：空模块预览 ⇒ 只由配置决定，界面不自算） */
function slotInfoOf(spec) {
  const p = previewFleetSpec({ shipId: spec.shipId, level: spec.level, modules: [] });
  return p.ok ? { slots: p.slots, maxLevel: p.maxLevel } : { slots: 0, maxLevel: 1 };
}

/** ★ 造价 / 返还**字段**（同一写法）：`title` ＝ 列短语，行内**可见小标签** ＋ **只资源图标 + 数量**
 *  ★ 迭代 3：表头已下线 ⇒ 这两串"图标 + 数字"长得一样，必须有小标签才分得清「造价 / 返还」。 */
function costField(cls, label, costObj, emptyKey) {
  return el('span', { class: cls, title: label }, [
    el('span', { class: 'base-fleet-flabel', text: label }),
    ...costIcons(costObj, emptyKey),
  ]);
}

/** ★ 排序小按钮（↑ / ↓）：可用 ⇒ 正常；不可用 ⇒ **禁用 + 原因只进 `title`**（体例同 `actButton`）
 *  ★ 与 `actButton` 一样用一层 `.base-act-wrap` 承载 `title`：**禁用按钮在浏览器里不弹悬浮提示**，
 *    包一层后"已到边界"这类原因对灰按钮同样可见。 */
function orderButton(label, hint, okFlag, onClick) {
  const ok = !!(okFlag && okFlag.ok);
  const btn = el('button', { class: 'base-order-btn', type: 'button', text: label, onclick: ok ? onClick : null });
  btn.disabled = !ok; // ★ property（不是 attribute）
  return el('span', { class: 'base-act-wrap', title: hint }, [btn]);
}

/** ★★ 一条配置 ＝ 一行卡片（全项目**唯一**的舰队行渲染）。用户口径（迭代 3 / 4 / 5）：
 *  · **最左元素 ＝ 拖动把手**（`draggable` 挂在它身上）：**竖向三件套**，DOM 顺序＝
 *    上移箭头 → 握把 → 下移箭头（CSS 竖向排布 ⇒ 自上而下呈现 ↑ / ⠿ / ↓；同一区域、**不另起容器**）；
 *  · **信息列**（名称 → 图标 → 类型 → 等级 → 模块 → **造价 / 返还 / 数量 作为一个整体右对齐**）
 *    与**操作行**都 `flex-wrap` ⇒ **自然换行、不溢出**（不再有固定列宽 / 横向滚动）；
 *    表头已下线 ⇒ 各字段自带 `title` 短语，造价 / 返还另有**可见小标签**；
 *  · **操作行分两组**：左组＝编辑 / 删除（常规排布），右组＝建造 / 拆解（**靠右**）。 */
function fleetRow(c, ctx) {
  const typeName = textOf(c.typeNameKey, c.shipId);
  const up = i18n.t('base.fleet.orderUp');
  const down = i18n.t('base.fleet.orderDown');
  const upHint = c.canMoveUp.ok ? up : `${up} —— ${reasonText(c.canMoveUp.reason)}`;
  const downHint = c.canMoveDown.ok ? down : `${down} —— ${reasonText(c.canMoveDown.reason)}`;
  // ⓪ 把手（**`.base-fleet-row` 内最左元素** · 迭代 5：**竖向三件套**，自上而下 ＝ ↑ / ⠿ / ↓）
  //    —— `draggable` 挂在这一整个把手区 ⇒ **该区域即可拖动**；hover / 拖拽反馈沿用既有变量。
  const handle = el('div', { class: 'base-fleet-handle', draggable: 'true', title: i18n.t('base.fleet.orderDrag') }, [
    orderButton('↑', upHint, c.canMoveUp, () => {
      moveFleetConfig(c.id, -1);
      ctx.refresh();
    }),
    el('span', { class: 'base-handle-grip', text: '⠿' }),
    orderButton('↓', downHint, c.canMoveDown, () => {
      moveFleetConfig(c.id, 1);
      ctx.refresh();
    }),
  ]);

  // ① 信息列（字段顺序不变；左段＝身份信息，右段＝**造价 / 返还 / 数量**，右段整体靠右）
  const chipsRow = moduleChipsRow(c.moduleChips); // 含空槽位占位
  chipsRow.title = i18n.t('base.fleet.colModules');
  const info = el('div', { class: 'base-fleet-info' }, [
    el('span', { class: 'base-fleet-name', title: `${i18n.t('base.fleet.colName')} · ${c.name}`, text: c.name }),
    el('span', { class: 'base-fleet-icon', title: i18n.t('base.fleet.colType') }, [unitIcon(c.iconShip)]), // ★ 唯一图标口径
    el('span', { class: 'base-fleet-type', title: i18n.t('base.fleet.colType'), text: typeName }),
    el('span', { class: 'base-fleet-level', title: i18n.t('base.fleet.colLevel'), text: `Lv${c.level}` }),
    chipsRow,
    // ★ 迭代 4：造价 / 返还 / 数量 —— **整体右对齐**（`.base-fleet-info-right`：`margin-left:auto` ＋ 内部
    //   `justify-content:flex-end`；自身也可换行 ⇒ 整段换到下一行时**仍在右侧**，不溢出）
    el('div', { class: 'base-fleet-info-right' }, [
      costField('base-fleet-cost', i18n.t('base.fleet.colCost'), c.cost, 'base.fleet.free'), // ★ 只显示资源图标 + 数量
      costField('base-fleet-refund', i18n.t('base.fleet.colRefund'), c.refundPerUnit, 'base.fleet.none'),
      el('span', {
        class: 'base-fleet-count',
        title: i18n.t('base.fleet.colCount'),
        text: i18n.t('base.fleet.counts', { count: c.count, out: c.out }),
      }),
    ]),
  ]);

  // ② 操作行：**左组＝编辑 / 删除**（常规排布），**右组＝建造 / 拆解**（靠右；两组成对，窄屏换行不溢出）
  const ops = el('div', { class: 'base-fleet-ops' }, [
    el('div', { class: 'base-ops-left' }, [
      actButton(i18n.t('base.fleet.edit'), i18n.t('base.fleet.editHint'), null, () => ctx.openEdit(c)),
      actButton(
        i18n.t('base.fleet.delete'),
        i18n.t('base.fleet.deleteHint'),
        c.canDelete.ok ? null : c.canDelete.reason,
        () => {
          deleteFleetConfig(c.id);
          ctx.refresh();
        }
      ),
    ]),
    el('div', { class: 'base-ops-right' }, [
      actButton(i18n.t('base.fleet.buildOne'), i18n.t('base.fleet.buildHint'), c.canBuild.ok ? null : c.canBuild.reason, () => {
        build(c.id, 1);
        ctx.refresh();
      }),
      actButton(i18n.t('base.fleet.scrapOne'), i18n.t('base.fleet.scrapHint'), c.canScrap.ok ? null : c.canScrap.reason, () => {
        scrap(c.id, 1);
        ctx.refresh();
      }),
    ]),
  ]);

  const row = el('div', { class: 'base-fleet-row', 'data-idx': String(c.order) }, [
    handle,
    el('div', { class: 'base-fleet-body' }, [info, ops]),
  ]);
  // ★ 拖动排序（B-3）：顺序**由引擎落到状态**（`reorderFleetConfig(id, 最终下标)`），界面只搬运
  handle.addEventListener('dragstart', (e) => {
    ctx.dragId = c.id;
    row.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.id);
    }
  });
  handle.addEventListener('dragend', () => {
    ctx.dragId = null;
    row.classList.remove('is-dragging');
  });
  row.addEventListener('dragover', (e) => {
    if (!ctx.dragId || ctx.dragId === c.id) return;
    e.preventDefault();
    row.classList.add('is-drop');
  });
  row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('is-drop');
    if (ctx.dragId) ctx.dropTo(c.order);
  });
  return row;
}

/** ★ 舰队列表（**全屏唯一一张**：容量总览 + 逐条配置行 + 新建入口）
 *  数据**只**来自 `snapshot().fleet`（单一数据源 ⇒ 数量 / 造价各只显示一次，无两区重复）。
 *  ★ 迭代 3：**表头与固定列宽已下线**（"列头 + 栅格"与"自然换行"互斥）—— 各字段行内自带短语，
 *    行是一张**自适应卡片**：最左把手、右侧信息列与操作行都可换行。
 *  ★ 收尾修正：容量条与列表之间的**提示行始终渲染**（`.base-fleet-notice`，空态 `visibility:hidden` 占位）
 *    ⇒ 提示出现 / 消失**不引起列表跳动**。 */
function fleetTable(ctx) {
  const st = snapshot().fleet;
  const nodes = [
    el('div', { class: 'base-fleet-bar' }, [
      statChip(i18n.t('base.fleet.capacity'), String(st.capacity)),
      statChip(i18n.t('base.fleet.used'), String(st.total)),
      statChip(i18n.t('base.fleet.outCount'), String(st.out)),
      statChip(i18n.t('base.fleet.remaining'), String(st.remaining)),
      actButton(i18n.t('base.fleet.create'), i18n.t('base.fleet.createTitle'), null, () => ctx.openCreate()),
    ]),
  ];
  // ★ 保存后的**必要且简短**提示（「已新建 X」/「已合并到 X」）—— 收尾修正：**始终渲染**，
  //   无内容时加 `.is-empty`（`visibility: hidden`）⇒ **不可见但仍占位**，避免提示消失/出现导致下方列表跳动。
  //   （文字仍来自引擎结果 / i18n，界面不自算；单行省略时全文仍可悬浮查看）
  const noticeText = ctx.form.notice || '';
  nodes.push(
    el('p', {
      class: noticeText ? 'base-note base-fleet-notice' : 'base-note base-fleet-notice is-empty',
      text: noticeText,
      title: noticeText,
    })
  );
  nodes.push(
    el('div', { class: 'base-fleet-table' }, [
      ...(st.configs.length ? st.configs.map((c) => fleetRow(c, ctx)) : [el('p', { class: 'base-note', text: i18n.t('base.fleet.empty') })]),
    ])
  );
  return nodes;
}

/** 弹窗：保存（新建 / 编辑＝另存为新配置）—— 保存前**再干跑一次**（与按钮禁用同一口径） */
function commitForm(ctx) {
  const f = ctx.form;
  const pv = previewFleetSpec({ name: f.name, shipId: f.shipId, level: f.level, modules: f.modules });
  if (!pv.ok) {
    // 非法草稿 ⇒ **不落库、不写提示**：弹窗内已就地显示短语原因（保存按钮此时也是灰的，带同一原因）
    ctx.refresh();
    return;
  }
  const spec = { name: f.name, shipId: f.shipId, level: f.level, modules: f.modules };
  const r = f.mode === 'edit' ? cloneFleetConfig(f.sourceId, spec) : createFleetConfig(spec);
  f.notice = r.ok
    ? i18n.t(r.merged ? 'base.fleet.merged' : 'base.fleet.saved', { name: r.name })
    : reasonText(r.reason);
  f.open = false;
  f.mode = 'create';
  f.sourceId = null;
  Object.assign(f.pick, { open: false, index: -1, moduleId: '', level: 1, category: '', opener: null, focusPending: false, focusLevel: false });
  ctx.refresh();
  ctx.refocus(f.opener); // 关闭后**焦点归位**（面板已重建，按钮可能换代 ⇒ 由 refocus 决定目标）
}

/** ★ 弹窗（Dialog）：名称 / 船型 / 等级 / 模块（可重复 · 各自等级 · **点图标开二级弹窗**）/ 槽位 / 造价
 *  · 交互与视觉对齐 `ui/setupView.js`：单位图标 `ui/unitIcon.js`、模块筹码 `.module-chip` 同一类名与层级、
 *    模块等级用下拉、按钮成行；
 *  · 浮层**沿用战斗屏 `.battle-overlay` 的体例**，内层盒子**直接用既有的 `.settle-panel`**；
 *  · **Enter 保存 / Esc 关闭 / 点击遮罩关闭**；打开时默认值已初始化（`openCreate` 给首个可建造船型 + Lv1）。 */
function dialogNodes(ctx) {
  const f = ctx.form;
  const isEdit = f.mode === 'edit';
  const info = slotInfoOf(f); // 等级下拉范围（引擎给）
  const pv = previewFleetSpec({ name: f.name, shipId: f.shipId, level: f.level, modules: f.modules });
  const chips = pv.chips || []; // ★ 引擎给的筹码描述（含空槽位占位 + 每项 maxLevel）
  const slots = Number.isInteger(pv.slots) ? pv.slots : info.slots;
  const titleText = i18n.t(isEdit ? 'base.fleet.editTitle' : 'base.fleet.createTitle');

  // ① 名称（★ 打字只写状态、**不重建** ⇒ 不丢焦点；留空 ⇒ **引擎给 i18n 默认名**）
  const hullName = textOf(pv.ok && pv.nameKey, f.shipId);
  const nameInput = el('input', {
    class: 'base-form-input base-dialog-name',
    type: 'text',
    value: f.name,
    placeholder: i18n.t('base.fleet.defaultName', { ship: hullName }),
    title: i18n.t('base.fleet.nameHint'),
  });
  nameInput.addEventListener('input', () => {
    f.name = nameInput.value;
  });

  // ② 船型（**全部可选**；不可建造者由引擎给 `notBuildable`，只体现在保存按钮的悬浮原因里）
  const shipSel = el('select', { class: 'base-form-input base-form-select' });
  for (const id of SHIP_IDS) shipSel.append(el('option', { value: id, text: textOf(SHIPS[id] && SHIPS[id].nameKey, id) }));
  shipSel.value = f.shipId;
  shipSel.addEventListener('change', () => {
    f.shipId = shipSel.value;
    f.level = 1; // 换船型 ⇒ 等级回 1（各船型等级表不同；**界面不替用户猜等级**）
    f.modules = []; // 换船型 ⇒ 模块清空（槽位口径随船型变化）
    ctx.refresh();
  });

  // ③ 等级（选项范围＝该船型 `maxLevel`，**由引擎给出**）
  const levelSel = el('select', { class: 'base-form-input base-form-select' });
  for (let lv = 1; lv <= info.maxLevel; lv += 1) levelSel.append(el('option', { value: String(lv), text: `Lv${lv}` }));
  levelSel.value = String(f.level);
  levelSel.addEventListener('change', () => {
    f.level = Number(levelSel.value) || 1;
    // 降级后模块数可能超过该等级槽位 ⇒ 从**尾部**裁掉多余（只裁剪、不重排）
    const s = slotInfoOf(f).slots;
    while (f.modules.length > s) f.modules.pop();
    ctx.refresh();
  });

  // ④ 模块（**可重复** + **每条各自等级**）：本列**只有图标（含等级）与空槽位占位**，
  //    **不再有"新增"按钮与"移除（×）"按钮** —— 增 / 删**全部**在二级弹窗内完成（用户口径）；
  //    点模块图标 ⇒ 二级弹窗（更换 / 改等级 / 移除）；点空槽位 ⇒ 同一弹窗（**新增**一条）。
  const modList = el('div', { class: 'base-mod-list' });
  chips.forEach((chip, i) => {
    if (chip.empty) {
      modList.append(
        el('button', {
          class: 'module-slot-empty base-mod-slot',
          type: 'button',
          title: i18n.t('base.fleet.pickAdd'),
          onclick: () => ctx.openPick(-1),
        })
      );
      return;
    }
    const btn = el('button', {
      class: `module-chip ${chip.category || ''} base-mod-open`.trim(),
      type: 'button',
      'data-idx': String(i),
      title: `${moduleName(chip.moduleId)} Lv${chip.level} —— ${i18n.t('base.fleet.pickEdit')}`,
      onclick: () => ctx.openPick(i),
    });
    btn.append(moduleGlyphEl({ id: chip.moduleId, icon: chip.icon, nameKey: chip.nameKey }));
    btn.append(el('span', { class: 'module-lv', text: `L${chip.level}` }));
    modList.append(btn);
  });

  // ⑤ 预览（槽位占用 / 单艘造价 / 不合法短语）—— 数值全来自引擎；造价**只显示资源图标 + 数量**
  const previewRow = [
    el('span', { class: 'base-form-stat', text: i18n.t('base.fleet.slots', { used: f.modules.length, slots }) }),
    el('span', { class: 'base-form-stat base-form-cost' }, [
      el('span', { class: 'base-form-cost-label', text: i18n.t('base.fleet.cost') }),
      ...costIcons(pv.ok ? pv.cost : {}, 'base.fleet.free'),
    ]),
  ];
  if (!pv.ok) previewRow.push(el('span', { class: 'base-form-warn', text: reasonText(pv.reason) }));

  const panel = el('div', { class: 'settle-panel base-dialog' }, [
    el('div', { class: 'base-dialog-title' }, [
      unitIcon(pv.iconShip || { typeId: f.shipId, side: 'ally', typeCfg: { icon: null } }),
      el('span', { text: titleText }),
    ]),
    el('div', { class: 'base-form-row' }, [
      el('label', { class: 'base-form-label', text: i18n.t('base.fleet.name') }),
      nameInput,
    ]),
    el('div', { class: 'base-form-row' }, [
      el('label', { class: 'base-form-label', text: i18n.t('base.fleet.ship') }),
      shipSel,
      el('label', { class: 'base-form-label', text: i18n.t('base.fleet.level') }),
      levelSel,
    ]),
    el('div', { class: 'base-form-row' }, [
      el('label', { class: 'base-form-label', text: i18n.t('base.fleet.modules') }),
      modList,
    ]),
    el('div', { class: 'base-form-row' }, previewRow),
    el('div', { class: 'base-dialog-foot' }, [
      actButton(
        i18n.t(isEdit ? 'base.fleet.saveAsNew' : 'base.fleet.create'),
        isEdit ? i18n.t('base.fleet.editHint') : i18n.t('base.fleet.createTitle'),
        pv.ok ? null : pv.reason,
        () => commitForm(ctx)
      ),
      el('button', {
        class: 'btn small base-fleet-act',
        type: 'button',
        text: i18n.t('base.fleet.cancel'),
        title: i18n.t('base.fleet.cancel'),
        onclick: () => ctx.closeForm(),
      }),
    ]),
  ]);

  // ★ 点击**遮罩**关闭（点在面板内部不关：`target !== overlay`）
  const overlay = el('div', { class: 'base-dialog-overlay' }, [panel]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) ctx.closeForm();
  });
  // ★ 二级弹窗（模块选择）叠在主弹窗之上；**它关闭不影响主弹窗草稿**
  return f.pick && f.pick.open ? [overlay, pickerNodes(ctx)] : [overlay];
}

/** ★★ **二级弹窗：单模块选择 / 增删改**（用户口径 A-1 + 迭代 3 的 1、2）
 *  · **数据来源＝引擎** `modulePickerData()`：分类表（顺序＝`CATEGORY_ORDER`）+ 可装配模块清单
 *    （`moduleId / nameKey / icon / category / categoryNameKey / maxLevel`）——界面**只渲染、只筛选**；
 *  · 分类筛选：首项＝「全部」（i18n `base.fleet.pickAll`），其余＝引擎给的分类 key（名走 `module.cat.<cat>`）；
 *  · 列表项＝**图标 + 名称**（图标沿用 `ui/moduleGlyph.js` 既有渲染，**不新造**）；
 *  · 等级下拉范围＝所选模块的 `maxLevel`（引擎给）⇒ **界面不自算上限**；
 *  · ★ **造价**：`moduleCostAt(moduleId, level)` ⇒ 显示该模块**当前等级**的
 *    `installCost`（＝装配消耗，与表格单艘造价里的模块部分**同一助手** ⇒ 同源同值）
 *    与 `removeCost`（拆下费用，**仅供参考**：配置里它是"消耗"、引擎尚未消费）；
 *    呈现口径与表格完全一致（**只资源图标 + 数量**，全 0 ⇒ 短语）；
 *  · ★ **增删改全在本弹窗**（底部四个按钮，**顺序固定 · 迭代 4 口径**）：
 *      【确认】【新增】【移除】【取消】
 *      `确认` ＝ 用当前选择**替换**当前槽位（`set`；无当前槽位 ⇒ 禁用 + 原因）；
 *      `新增` ＝ 把当前选择**追加**为新槽位（`add`；槽位满 ⇒ 禁用 + 原因；**允许重复模块**）；
 *      `移除` ＝ **删除**当前槽位（`remove`；无当前槽位 ⇒ 禁用 + 原因）；
 *      `取消` ＝ 不改草稿，直接关闭。
 *    ★ 三个动作的**被拒原因与可用性全部来自引擎** `applyModuleSlot()`（界面不判、不夹取）；
 *  · 交互与主弹窗一致：**Enter 主操作 / Esc 关闭 / 点击遮罩关闭 / 打开即聚焦 / 改等级后就地刷新并回焦**
 *    （`Enter`：有当前槽位 ⇒ 「确认」；"新增"态 ⇒ 「新增」—— 与该按钮的可用性同源，不会静默无效）。 */
function pickerNodes(ctx) {
  const f = ctx.form;
  const pk = f.pick;
  const data = modulePickerData();
  const list = pk.category ? data.modules.filter((m) => m.category === pk.category) : data.modules;
  const cur = data.modules.find((m) => m.moduleId === pk.moduleId) || null;
  // ★ 槽位数与费用都来自引擎（界面只读）：槽位数用于"新增"的满槽判定，费用用于展示
  const pv = previewFleetSpec({ name: f.name, shipId: f.shipId, level: f.level, modules: f.modules });
  const slots = Number.isInteger(pv.slots) ? pv.slots : f.modules.length;
  const cost = cur ? moduleCostAt(cur.moduleId, pk.level) : null;
  // ★ 三个动作先在引擎里**干跑**取可用性/原因（`applyModuleSlot` 是纯函数 ⇒ 不改草稿、无副作用）
  const opSet = applyModuleSlot(f.modules, { action: 'set', index: pk.index, moduleId: pk.moduleId, level: pk.level, slots });
  const opAdd = applyModuleSlot(f.modules, { action: 'add', moduleId: pk.moduleId, level: pk.level, slots });
  const opRemove = applyModuleSlot(f.modules, { action: 'remove', index: pk.index });
  // 清单为空（无可装配模块）⇒ 用界面本地原因码（更贴切）；其余一律用引擎原因码
  const noModule = !cur ? { code: 'noModuleLeft' } : null;
  const setReason = noModule || (opSet.ok ? null : opSet.reason);
  const addReason = noModule || (opAdd.ok ? null : opAdd.reason);
  const removeReason = opRemove.ok ? null : opRemove.reason;

  // 分类筛选按钮（选中态用既有 `.selected` 体例；**不新增配色**）
  const catRow = el('div', { class: 'base-pick-cats' }, [
    el('button', {
      class: pk.category ? 'base-pick-cat' : 'base-pick-cat selected',
      type: 'button',
      text: i18n.t('base.fleet.pickAll'),
      onclick: () => {
        pk.category = '';
        ctx.refreshDialog();
      },
    }),
    ...data.categories.map((cat) =>
      el('button', {
        class: pk.category === cat ? 'base-pick-cat selected' : 'base-pick-cat',
        type: 'button',
        text: textOf(`module.cat.${cat}`, cat),
        onclick: () => {
          pk.category = cat;
          ctx.refreshDialog();
        },
      })
    ),
  ]);

  // 模块列表（图标 + 名称；点选 ⇒ 选中态 + 等级下拉随所选模块换上限）
  const items = list.length
    ? list.map((m) => {
        const on = m.moduleId === pk.moduleId;
        const btn = el('button', {
          class: on ? 'base-pick-item selected' : 'base-pick-item',
          type: 'button',
          'data-module': m.moduleId,
          title: `${textOf(m.nameKey, m.moduleId)} Lv1-${m.maxLevel}`,
          onclick: () => {
            pk.moduleId = m.moduleId;
            pk.level = Math.min(pk.level, m.maxLevel) || 1;
            ctx.refreshDialog();
          },
        });
        // ★ 图标沿用**既有模块图标渲染**：`moduleGlyphEl` 只产出"脸"节点，外面套**同一 `.module-chip` 盒子**
        const box = el('span', { class: `module-chip ${m.category || ''}`.trim() });
        box.append(moduleGlyphEl({ id: m.moduleId, icon: m.icon, nameKey: m.nameKey }));
        btn.append(box);
        btn.append(el('span', { class: 'base-pick-name', text: textOf(m.nameKey, m.moduleId) }));
        return btn;
      })
    : [el('p', { class: 'base-note', text: i18n.t('base.fleet.pickEmpty') })];

  // 等级（1..该模块 `maxLevel`，**引擎给的范围**）★ 改等级 ⇒ 不是只改草稿值：造价与按钮可用性都要跟着刷 ⇒ 就地重绘
  const maxLevel = cur ? cur.maxLevel : 1;
  const levelSel = el('select', {
    class: 'base-form-input base-form-select base-pick-level',
    'aria-label': i18n.t('base.fleet.modLevelHint'),
  });
  for (let lv = 1; lv <= maxLevel; lv += 1) levelSel.append(el('option', { value: String(lv), text: `Lv${lv}` }));
  levelSel.value = String(Math.min(pk.level, maxLevel));
  levelSel.addEventListener('change', () => {
    pk.level = Number(levelSel.value) || 1;
    pk.focusLevel = true; // 重绘后把焦点**还给等级下拉**（确定性，不猜）
    ctx.refreshDialog();
  });

  // ★ 造价行（该模块**当前等级**）：装配（`installCost`）与 拆下（`removeCost`）——**只图标 + 数量**
  const costRow = el('div', { class: 'base-form-row base-pick-costs' }, [
    el('span', { class: 'base-pick-cost', title: `${i18n.t('base.fleet.colCost')} · Lv${pk.level}` }, [
      el('span', { class: 'base-fleet-flabel', text: i18n.t('base.fleet.pickCost') }),
      ...(cost && cost.ok ? costIcons(cost.install, 'base.fleet.free') : [el('span', { class: 'base-cost-empty', text: i18n.t('base.fleet.none') })]),
    ]),
    ...(cost && cost.ok
      ? [
          el('span', { class: 'base-pick-cost', title: `${i18n.t('base.fleet.pickRemoveCost')} · Lv${pk.level}` }, [
            el('span', { class: 'base-fleet-flabel', text: i18n.t('base.fleet.pickRemoveCost') }),
            ...costIcons(cost.remove, 'base.fleet.none'),
          ]),
        ]
      : []),
  ]);

  // 底部按钮：**顺序固定**（迭代 4 用户口径）＝【确认】【新增】【移除】【取消】
  const foot = el('div', { class: 'base-dialog-foot base-pick-foot' }, [
    actButton(i18n.t('base.fleet.pickConfirm'), i18n.t('base.fleet.pickConfirmHint'), setReason, () => ctx.commitPick('set')),
    actButton(i18n.t('base.fleet.pickAddBtn'), i18n.t('base.fleet.pickAddHint'), addReason, () => ctx.commitPick('add')),
    actButton(i18n.t('base.fleet.pickRemove'), i18n.t('base.fleet.pickRemoveHint'), removeReason, () => ctx.commitPick('remove')),
    el('button', {
      class: 'btn small base-fleet-act',
      type: 'button',
      text: i18n.t('base.fleet.cancel'),
      title: i18n.t('base.fleet.cancel'),
      onclick: () => ctx.closePick(),
    }),
  ]);

  const panel = el('div', { class: 'settle-panel base-dialog base-pick' }, [
    el('div', { class: 'base-dialog-title' }, [
      el('span', { text: i18n.t('base.fleet.pickTitle') }),
      el('span', { class: 'base-pick-sub', text: cur ? textOf(cur.categoryNameKey, cur.category) : '' }),
    ]),
    catRow,
    el('div', { class: 'base-pick-list' }, items),
    el('div', { class: 'base-form-row' }, [
      el('label', { class: 'base-form-label', text: i18n.t('base.fleet.modLevelHint') }),
      levelSel,
    ]),
    costRow,
    foot,
  ]);
  const overlay = el('div', { class: 'base-dialog-overlay base-pick-overlay' }, [panel]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) ctx.closePick();
  });
  // ★ 打开后的聚焦**不在这里做**（此刻节点尚未挂进文档，`focus()` 无效）——
  //   统一交给 `renderDialog()` 在 `replaceChildren` 之后处理（与主弹窗的 `focusPending` 同一体例）。
  return overlay;
}

/** ★ 分区块：**按配置的 `zones[].key` 分派**（不硬编码建筑 id）
 *  · M3b 迭代后船坞只有**一个**分区 `fleet` ⇒ 渲染**唯一一张合并列表**（每条配置一张自适应卡片）；
 *  · 其它 key ⇒ 保持 M3a 占位（"将在 {stage} 实装"）。 */
function zoneBlock(zone, ctx) {
  const nodes = [el('div', { class: 'base-zone-title', text: textOf(zone.nameKey, zone.key) })];
  if (zone.key === 'fleet') nodes.push(...fleetTable(ctx));
  else nodes.push(el('div', { class: 'base-todo', text: i18n.t('base.panelTodo', { stage: zone.stage }) }));
  if (zone.noteKey) nodes.push(el('p', { class: 'base-note', text: textOf(zone.noteKey, '') }));
  return el('div', { class: 'base-zone' }, nodes);
}

/** ★ 等级 / 上限（**与标题同一行**显示：靠右；自身不换行、不占独立行）
 *  ★★ **唯一来源 ＝ `snapshot().listItems[]` 的 `level` / `maxLevel`**（前者来自状态、后者来自配置，
 *     由引擎派生）；界面**只读这两个键**，**不自算、不从建筑配置对象推导**。
 *  ★ 历史缺陷（用户实测「等级 undefined · 上限 5」）：面板曾把 `data/baseBuildings` 的**建筑配置对象**
 *     当作面板项传入，而配置里**没有** `level`（等级是状态）⇒ 只有 `maxLevel` 有值。
 *     现在：`renderPanel()` 只传快照项；本函数再对非整数做一次兜底（**只为不显示 undefined/NaN**，
 *     **不是**允许缺字段）——`baseSelfCheck()` ⑯ 会断言快照项一律含 ≥1 的整数 `level` 与 `maxLevel`。 */
function levelInfo(item) {
  const level = Number.isInteger(item && item.level) ? item.level : 0;
  const maxLevel = Number.isInteger(item && item.maxLevel) ? item.maxLevel : 0;
  const levelText = i18n.t('base.level', { n: level });
  const maxText = i18n.t('base.maxLevel', { n: maxLevel });
  // `title` ＝ 完整文本：作为窄屏省略（text-overflow: ellipsis）时的悬浮兜底
  return el('span', { class: 'base-panel-levels', title: `${levelText} · ${maxText}` }, [
    el('span', { text: levelText }),
    el('span', { class: 'base-item-sep', text: '·' }),
    el('span', { text: maxText }),
  ]);
}

/** 右侧面板内容（建筑面板；船坞的舰队表格已实装 M3b 的配置 / 建造 / 拆解） */
function panelNodes(item, ctx) {
  const nameText = nameOf(item);
  const metaText = metaOf(item);
  // ★ 面板头**只有一行**：标题靠左 ＋ 副标题紧随 ＋「等级 / 上限」靠右
  const head = el('div', { class: 'base-panel-head' }, [
    el('h3', { class: 'base-panel-title', text: nameText, title: nameText }),
    el('span', { class: 'base-panel-meta', text: metaText, title: metaText }),
    levelInfo(item),
  ]);

  // ★ 本阶段未开放（星球）：显示占位提示 + 各资源种类与用途
  if (item.placeholder) {
    return [
      head,
      el('div', { class: 'base-locked', text: i18n.t('base.panelLocked') }),
      el('p', { class: 'base-note', text: i18n.t('base.planetNote') }),
      resourceUsage(),
    ];
  }

  // ★ 有分区（船坞）：逐区渲染（分区结构来自配置 `zones`，界面不硬编码分区名与业务归属）
  if (Array.isArray(item.zones) && item.zones.length) {
    return [head, ...item.zones.map((z) => zoneBlock(z, ctx))];
  }

  // ★ M3x 待实现（其余建筑）：仅占位说明，**不实现任何业务**
  return [head, el('div', { class: 'base-todo', text: i18n.t('base.panelTodo', { stage: item.stage }) })];
}

/** 首个**可建造**船型 id（表单默认值；配置 `buildable !== false`；全部不可建造 ⇒ 取注册表首项） */
function firstBuildableShipId() {
  return SHIP_IDS.find((id) => SHIPS[id] && SHIPS[id].buildable !== false) || SHIP_IDS[0];
}

function root() {
  const snap = snapshot();
  const listEl = el('div', { class: 'base-list' });
  const panelEl = el('div', { class: 'base-panel' });
  const dialogHost = el('div', { class: 'base-dialog-host' }); // 弹窗挂载点（**独立于面板**，不被面板重建影响）
  const buttons = new Map();
  const resNodes = new Map(); // 资源键 -> 顶栏节点（动作后就地更新）
  let renderedId = null;
  let dialogKeyHandler = null;

  /** ★ 表单（草稿）状态（**跨面板重建保留**：切走再切回不丢草稿；保存 / 取消后归位）
   *  · `opener` ＝ 打开弹窗前的焦点元素（关闭后**焦点归位**）；
   *  · `focusPending` ＝ 下次渲染后把焦点交给名称输入框（**打开弹窗时只做一次**）。 */
  const form = {
    open: false,
    mode: 'create',
    sourceId: null,
    name: '',
    shipId: firstBuildableShipId(),
    level: 1,
    modules: [],
    notice: '',
    opener: null,
    focusPending: false,
    /** ★ 二级弹窗（模块选择）状态（用户口径 A-1）：`index` ＝ 目标模块条目下标（`-1` ⇒ **追加**） */
    pick: { open: false, index: -1, moduleId: '', level: 1, category: '', opener: null, focusPending: false, focusLevel: false },
  };

  /** ★ 就地同步**顶栏资源数值**（不重建顶栏 DOM：只改数值文本、悬浮文本与"已满"标记） */
  function syncTopBar() {
    const s = snapshot();
    for (const it of s.resourceItems) {
      const node = resNodes.get(it.key);
      if (!node) continue;
      const v = node.querySelector('.base-res-value');
      if (v) v.textContent = String(it.value);
      node.setAttribute('title', `${it.value} / ${it.cap}`);
      node.classList.toggle('is-full', !!it.full);
    }
  }

  /** ★ 只更新**选中态**（不重建 DOM）：仅改动"旧选中"与"新选中"两个按钮 */
  function paintSelection(nextId) {
    if (renderedId === nextId) return;
    for (const id of [renderedId, nextId]) {
      const btn = id ? buttons.get(id) : null;
      if (!btn) continue;
      const on = id === nextId;
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-current', on ? 'true' : 'false');
    }
    renderedId = nextId;
  }

  /** 重建**右侧面板**（左列表 DOM 与顶栏结构保持不动）
   *  ★★ 面板项**只取 `snapshot().listItems[]`**（引擎快照：`level` 来自状态、`maxLevel` 来自配置、
   *     `nameKey/metaKey/zones/placeholder/stage` 一并在内）。
   *     **绝不能**把 `data/baseBuildings` 的**建筑配置对象**当面板项 —— 配置里**没有** `level`，
   *     那样会渲染出「等级 undefined」（用户实测缺陷的真因）。 */
  function renderPanel() {
    const s = snapshot();
    const id = renderedId || BASE_LIST_ITEMS[0].id;
    const item = s.listItems.find((it) => it.id === id) || s.listItems[0];
    if (!item) {
      panelEl.replaceChildren();
      return;
    }
    panelEl.replaceChildren(...panelNodes(item, ctx));
  }

  /** 重建**弹窗挂载点**（表单开着就有；关闭则清空并摘掉全局键盘监听）
   *  ★ 键盘监听挂在 **document** 上（而非浮层元素）：面板重建会换掉浮层 DOM，
   *    挂在文档上才能保证"重建后 Esc / Enter 依然有效"；关闭或视图脱离文档时**自动摘除**（不泄漏）。 */
  function renderDialog() {
    if (!form.open) {
      form.pick.open = false; // 主弹窗关了 ⇒ 二级弹窗必然也关（不残留）
      if (dialogKeyHandler) {
        document.removeEventListener('keydown', dialogKeyHandler);
        dialogKeyHandler = null;
      }
      dialogHost.replaceChildren();
      return;
    }
    dialogHost.replaceChildren(...dialogNodes(ctx));
    if (!dialogKeyHandler) {
      dialogKeyHandler = (e) => {
        if (!dialogHost.isConnected) {
          document.removeEventListener('keydown', dialogKeyHandler);
          dialogKeyHandler = null;
          return;
        }
        // ★ Esc：**先关二级弹窗**（二级弹窗关闭**不影响主弹窗状态**），再关主弹窗
        if (e.key === 'Escape') {
          e.preventDefault();
          if (form.pick.open) closePick();
          else closeForm();
          return;
        }
        // Enter ＝ 确认（二级弹窗）/ 保存（主弹窗）；仅在输入框 / 下拉聚焦时接管，避免与按钮双触发
        const tag = e.target && e.target.tagName ? e.target.tagName : '';
        if (e.key === 'Enter' && (tag === 'INPUT' || tag === 'SELECT')) {
          e.preventDefault();
          // ★ 二级弹窗里：Enter ＝**主操作** —— 有当前槽位 ⇒ 确认（`set`）；"新增"态（无当前槽位）⇒ 新增（`add`）
          //   （与按钮可用性同源：无当前槽位时"确认"本就是灰的 ⇒ Enter 落到"新增"，不会静默无效）
          if (form.pick.open) commitPick(form.pick.index >= 0 ? 'set' : 'add');
          else commitForm(ctx);
        }
      };
      document.addEventListener('keydown', dialogKeyHandler);
    }
    if (form.focusPending) {
      form.focusPending = false;
      const inp = dialogHost.querySelector('.base-dialog-name');
      if (inp) inp.focus();
    }
    // ★ 二级弹窗的打开聚焦（节点已挂进文档 ⇒ `focus()` 有效）：优先当前选中项，其次等级下拉
    if (form.pick.open && form.pick.focusPending) {
      form.pick.focusPending = false;
      const node =
        dialogHost.querySelector(`.base-pick-item[data-module="${form.pick.moduleId}"]`) ||
        dialogHost.querySelector('.base-pick-level');
      if (node && typeof node.focus === 'function') node.focus();
    }
    // ★ 改等级后重绘 ⇒ 焦点**回到等级下拉**（只重绘弹窗、不动草稿；用户可连续调级看造价）
    if (form.pick.open && form.pick.focusLevel) {
      form.pick.focusLevel = false;
      const lv = dialogHost.querySelector('.base-pick-level');
      if (lv && typeof lv.focus === 'function') lv.focus();
    }
  }

  /** ★ 动作后的统一刷新：①顶栏数值就地更新 ②只重建右面板与弹窗挂载点 */
  function refresh() {
    syncTopBar();
    renderPanel();
    renderDialog();
  }

  /** 弹窗：新建（默认值已可用：首个可建造船型 + Lv1 + 无模块）
   *  ★ **只重建弹窗**、不重建面板 —— 面板内容没变，重建会把"打开弹窗的那个按钮"从文档里换掉，
   *    那样关闭时就无法把焦点**还给它**（可访问性要求）。 */
  function openCreate() {
    form.opener = document.activeElement;
    Object.assign(form, {
      open: true,
      mode: 'create',
      sourceId: null,
      name: '',
      shipId: firstBuildableShipId(),
      level: 1,
      modules: [],
      notice: '',
      focusPending: true,
    });
    Object.assign(form.pick, { open: false, index: -1, moduleId: '', level: 1, category: '', opener: null, focusPending: false, focusLevel: false });
    renderDialog();
  }

  /** 弹窗：编辑（＝以该配置为模板**另存为新配置**；字段全部预填，原条目不动；同样只重建弹窗） */
  function openEdit(c) {
    form.opener = document.activeElement;
    Object.assign(form, {
      open: true,
      mode: 'edit',
      sourceId: c.id,
      name: c.name,
      shipId: c.shipId,
      level: c.level,
      modules: (c.modules || []).map((m) => ({ moduleId: m.moduleId, level: m.level })),
      notice: '',
      focusPending: true,
    });
    Object.assign(form.pick, { open: false, index: -1, moduleId: '', level: 1, category: '', opener: null, focusPending: false, focusLevel: false });
    renderDialog();
  }

  /** ★ 关闭弹窗后**焦点归位**：优先还给"打开它的那个按钮"；该按钮已随面板重建而脱离文档时，
   *  回落到表格栏里的「新建配置」按钮（**确定性**：不猜、不遍历整个文档）。 */
  function refocus(opener) {
    const target = opener && opener.isConnected ? opener : panelEl.querySelector('.base-fleet-act');
    if (target && typeof target.focus === 'function') target.focus();
  }

  /** 弹窗：取消（放弃草稿；**不改任何状态**、无需重建面板；焦点归位到打开它的按钮） */
  function closeForm() {
    const opener = form.opener;
    Object.assign(form, { open: false, mode: 'create', sourceId: null, name: '', modules: [], notice: '', focusPending: false });
    Object.assign(form.pick, { open: false, index: -1, moduleId: '', level: 1, category: '', opener: null, focusPending: false, focusLevel: false });
    renderDialog();
    refocus(opener);
  }

  /* ---------- ★ 二级弹窗：单模块选择（A-1） ---------- */

  /** 打开二级弹窗：`index ≥ 0` ⇒ 编辑该模块条目；`index ＝ -1` ⇒ **追加**一条（空槽位入口） */
  function openPick(index) {
    const pk = form.pick;
    const data = modulePickerData();
    const entry = index >= 0 && index < form.modules.length ? form.modules[index] : null;
    const first = data.modules.length ? data.modules[0].moduleId : '';
    Object.assign(pk, {
      open: true,
      index: entry ? index : -1,
      moduleId: entry ? entry.moduleId : first,
      level: entry && Number.isInteger(entry.level) ? entry.level : 1,
      category: '',
      opener: document.activeElement,
      focusPending: true,
    });
    renderDialog(); // ★ 只重绘弹窗（面板与顶栏不动；主弹窗草稿状态**原样保留**）
  }

  /** 关闭二级弹窗：**只关它**（主弹窗与草稿状态零改动）＋ 焦点归位到原来点的那颗筹码 */
  function closePick() {
    const pk = form.pick;
    const opener = pk.opener;
    Object.assign(pk, { open: false, index: -1, moduleId: '', level: 1, category: '', opener: null, focusPending: false, focusLevel: false });
    renderDialog();
    refocusPick(opener);
  }

  /** ★ **二级弹窗的三个动作**（用户口径：增删改全在二级弹窗内完成）——草稿不落库，保存仍由主弹窗负责：
   *  · `'set'`（**确认**）＝ 用当前选择**替换**当前槽位；`'add'`（**新增**）＝ **追加**为新槽位；
   *    `'remove'`（移除）＝ **删除**当前槽位；
   *  · ★ 实际改动**全部交给引擎** `applyModuleSlot()`（纯函数、返回新数组、含等级范围与满槽判定）
   *    —— 被拒（原因与按钮禁用同源）⇒ **草稿零改动**、弹窗也不关（让用户看到原因）；
   *  · 成功 ⇒ 关闭二级弹窗（**主弹窗仍开着、其余草稿字段零改动**）并把焦点交给刚编辑/新增的那颗筹码。 */
  function commitPick(action) {
    const pk = form.pick;
    if (!pk.open) return;
    const pv = previewFleetSpec({ name: form.name, shipId: form.shipId, level: form.level, modules: form.modules });
    const slots = Number.isInteger(pv.slots) ? pv.slots : form.modules.length;
    const r = applyModuleSlot(form.modules, {
      action,
      index: pk.index,
      moduleId: pk.moduleId,
      level: pk.level,
      slots,
    });
    if (!r.ok) return; // 引擎拒绝 ⇒ 零改动（按钮本就禁用；此处是二次防线）
    form.modules = r.modules; // ★ 引擎返回**新数组**（纯函数）⇒ 不共享引用
    // 移除后原来的下标可能越界 ⇒ 回落到"同位置的下一颗 / 最后一颗"，再由下方兜底到空槽位入口
    const idx = r.action === 'remove' ? Math.min(r.index, form.modules.length - 1) : r.index;
    Object.assign(pk, {
      open: false,
      index: -1,
      moduleId: '',
      level: 1,
      category: '',
      opener: null,
      focusPending: false,
      focusLevel: false,
    });
    renderDialog();
    // 焦点归位：回到刚编辑/新增的那颗模块筹码（**确定性**：按下标定位，不遍历文档）
    const chip = idx >= 0 ? dialogHost.querySelector(`.base-mod-open[data-idx="${idx}"]`) : null;
    const target = chip || dialogHost.querySelector('.base-mod-slot') || dialogHost.querySelector('.base-dialog-name');
    if (target && typeof target.focus === 'function') target.focus();
  }

  /** 二级弹窗的焦点归位（原筹码已随重绘换代时，回落到名称输入框 / 空槽位入口） */
  function refocusPick(opener) {
    const fallback = dialogHost.querySelector('.base-mod-slot') || dialogHost.querySelector('.base-dialog-name');
    const target = opener && opener.isConnected ? opener : fallback;
    if (target && typeof target.focus === 'function') target.focus();
  }

  /** ★ 拖动落点：把「正在拖的配置」移到该下标（**顺序由引擎落到状态**；被拒则零改动） */
  function dropTo(idx) {
    const id = ctx.dragId;
    ctx.dragId = null;
    if (!id) return;
    reorderFleetConfig(id, idx);
    refresh();
  }

  const ctx = {
    form,
    dragId: null,
    refresh,
    refreshDialog: renderDialog, // 二级弹窗内部交互只重绘弹窗
    openCreate,
    openEdit,
    closeForm,
    openPick,
    closePick,
    commitPick,
    refocus,
    dropTo,
    commitForm: () => commitForm(ctx),
  };

  /** 切换左列表项：只改选中态 + 重建右面板（**不重建整屏**） */
  function select(id) {
    if (!getBaseListItem(id)) return;
    paintSelection(id);
    renderPanel();
  }

  for (const item of snap.listItems) {
    const btn = listButton(item, select);
    buttons.set(item.id, btn);
    listEl.append(btn);
  }

  const sideEl = el('div', { class: 'base-side' }, [
    el('div', { class: 'base-side-title', text: i18n.t('base.buildings') }),
    listEl,
  ]);

  const section = el('section', { class: 'screen screen-base' }, [
    topBar(snap),
    el('div', { class: 'base-body' }, [sideEl, panelEl]),
    dialogHost,
  ]);

  // 顶栏资源节点索引（`data-res` 由 `resourceItem` 写入）⇒ 动作后可就地更新
  for (const node of section.querySelectorAll('.base-res-item')) {
    const key = node.getAttribute('data-res');
    if (key) resNodes.set(key, node);
  }

  // 默认选中**列表首项**（配置 order 升序 ⇒ 星门）；这里才首次建立右面板内容
  select(BASE_LIST_ITEMS[0].id);

  return section;
}

export const baseView = { root };
export default baseView;
