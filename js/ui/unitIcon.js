/* ===== ui/unitIcon.js —— ★ 单位图标渲染的**唯一口径**（战斗屏与星域地图共用） =====
 * 从 `ui/battleView.js` **原样抽出**（行为、优先级、降级路径**一字未改**），供多处复用：
 *   · 召唤(无人机)单位：使用所属召唤模块的图标（`ship.summonIcon`）；模块无图标时直接降级 ▲；
 *   · 常规单位：图标优先级＝`ship.summonIcon` > **船型等级解析出的 `icon`**（`ship.typeCfg.icon`，
 *     船型任意条目可逐级覆写） > 既有按 `typeId + side` 约定的素材路径 `./assets/img/ship-<type>-<side>.svg`；
 *   · 加载失败（含 `ship.tempNoIcon`）⇒ **降级为 ▲**（`error` 事件 + `fallback` 类，CSS 上色）。
 * ★ 调用方只负责「把返回的 `<span class="unit-icon-wrap">` 放进自己的容器并决定尺寸」
 *   （战斗单位卡 36px / 星域地图格子用小尺寸，均由各自 CSS 作用域控制）——**本文件不含任何尺寸**。
 */
import { el } from '../core/utils.js';

/** 单位图标（唯一口径）：返回 `<span class="unit-icon-wrap">`（内含 `<img class="unit-icon-img">` 或降级 ▲） */
export function unitIcon(ship) {
  const wrap = el('span', { class: 'unit-icon-wrap' });
  if (ship.tempNoIcon) {
    wrap.classList.add('fallback');
    wrap.appendChild(document.createTextNode('▲'));
    return wrap;
  }
  const img = el('img', {
    class: 'unit-icon-img',
    alt: '',
    draggable: 'false',
    // 图标优先级：召唤模块图标（summon.attrs.icon / 模块 icon） > **船型等级解析出的 icon**
    // （`ship.typeCfg.icon`，船型任意条目可逐级覆写） > 既有按 typeId+side 约定的素材路径。
    src:
      ship.summonIcon ||
      (ship.typeCfg && ship.typeCfg.icon) ||
      `./assets/img/ship-${ship.typeId}-${ship.side}.svg`,
  });
  img.addEventListener('error', () => {
    wrap.replaceChildren(document.createTextNode('▲'));
    wrap.classList.add('fallback');
  });
  wrap.append(img);
  return wrap;
}

export default unitIcon;
