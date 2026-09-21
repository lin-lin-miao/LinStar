/* ===== ui/moduleGlyph.js —— ★ 模块"脸"节点渲染的**唯一口径**（战斗筹码 / 基地舰队表格共用） =====
 * 从 `ui/battleView.js` **原样抽出**（节点形态、类名、`error` 回退路径**一字未改**），供多处复用：
 *   · 有 `icon`（模块配置的 SVG 路径）⇒ `<img class="module-icon-img">`；
 *   · 无 `icon`、或 `icon` 素材缺失（`error`）⇒ **名称首字** `<span>`（同一分支、同一形态）。
 * ★ 调用方只负责把返回节点放进 `.module-chip` 等容器；**本文件不含尺寸与配色**（由各自 CSS 作用域控制）。
 * ★ 与召唤单位的 `ui/unitIcon.js` 是**同一写法体例**（`<img>` + `error` 回退）——两者各管一类图标，
 *   不要互相替代：单位图标走 `unitIcon`，模块图标走本文件。
 */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { MODULES } from '../data/modules.js';

/** 模块显示名（词条缺失时回退配置里的 `name` / id）——与 `battleView` / `setupView` 同口径 */
function moduleName(id) {
  const m = MODULES[id];
  if (!m) return id;
  const t = i18n.t(m.nameKey);
  return t && !t.startsWith('??') ? t : (m.name || id);
}

/** 模块"脸"节点：有 SVG 图标(cfg.icon)用 `<img>`，否则降级显示名称首字。
 *  ★ **缺图回退**：写了 `icon` 但素材缺失/路径失效时，`<img>` 触发 `error` → **就地替换**为
 *    与"无 `icon`"**完全同一条渲染分支**的「名称首字」节点（同一元素形态：无 class 的 `<span>`、
 *    同取 `moduleName` 首字）⇒ 与无图时的呈现**逐字一致**，不新造视觉、不新增类名。 */
export function moduleGlyphEl(cfg) {
  // 「名称首字」降级节点（唯一渲染分支：无 `icon` 与 `icon` 加载失败**共用**此函数）
  const firstCharEl = () => {
    const name = moduleName(cfg.id);
    return el('span', { text: name ? Array.from(name)[0] : '?' });
  };
  if (cfg.icon) {
    const img = el('img', { class: 'module-icon-img', src: cfg.icon, alt: '' });
    img.draggable = false;
    // 加载失败 → 用「名称首字」节点**原位替换**该 <img>：
    //   · `replaceWith` 是"换掉自己"，故**不会重复插入**、也不会累积子节点；
    //   · 替换后该 <img> 已脱离文档，其 `error` 不会再触发（且 `parentNode` 守卫兜住极端时序）
    //     ⇒ **不残留破图占位**；
    //   · 元素尚未挂到文档时 `replaceWith` 按规范为**空操作**（不抛错）—— 实践中 `error` 事件总在
    //     当前任务之后派发，而各调用方都在同一同步块内把筹码挂进 DOM，故回退恒能生效。
    img.addEventListener('error', () => {
      if (!img.parentNode) return; // 已脱离文档（已被替换/移除）→ 不再处理
      img.replaceWith(firstCharEl());
    });
    return img;
  }
  return firstCharEl();
}

export default moduleGlyphEl;
