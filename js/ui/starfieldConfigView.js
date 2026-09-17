/* ===== ui/starfieldConfigView.js —— 星域配置界面（★ 本步骤＝占位页） =====
 * 定位（设计文档 §7 界面规划 / §10 阶段 0 S0-1）：
 *   · **正式主入口**：原「编队配置（单星区模拟）」的**界面入口位置改为本界面**；
 *   · 本轮（S0-1）只落**占位页**（最小可辨识：标题「星域配置」＋“待开发”说明＋**返回入口**），
 *     **步骤 C-3** 在此正式实装：选难度/玩法（`H1`…`Hn`）、**种子仅在此输入**（默认随机、生成后显示）、
 *     半径、类型增减、各类型数量区间、各类型默认 NPC 列表与 NPC 列表编辑、预览生成结果、
 *     **导出/导入（与内置星域配置文件同格式）**；确认后进入星域大地图。
 * 入口与路由：
 *   · 主菜单主按钮（**原编队配置入口位置**）⇒ `router.show('starfield')`（见 `ui/menuView.js`）；
 *   · 本视图在 `js/main.js` 注册为屏幕 `'starfield'` ⇒ **已接入既有屏幕路由、无死链**
 *     （视图契约＝`{ root() -> Element }`，每次 `show` 重新生成 DOM ⇒ 语言切换后 `repaint` 即全量刷新）；
 *   · 返回 ⇒ `router.show('menu')`（与其它屏同一体例）。
 * ★ 编队界面（单星区模拟）**不再有界面入口**，改为控制台指令 **`LS.drill()`**（见 `js/main.js`）；
 *   该界面本身与其功能、开战流程**完全未改动**（仍走 `setupView` + 唯一开战入口 `enterBattle`）。
 * 样式：复用既有占位屏类 `.screen-placeholder` / `.panel-placeholder`（`css/screens.css`）
 *   ⇒ **本视图未新增任何 CSS**。
 * i18n：`starfield.config.title` / `starfield.config.todo` / `starfield.config.drillHint` / `menu.back`。
 */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { router } from './router.js';
import { ensureStarfield } from './starfieldSession.js';

function root() {
  return el('section', { class: 'screen screen-placeholder' }, [
    el('div', { class: 'panel-placeholder' }, [
      el('h2', { text: i18n.t('starfield.config.title') }),
      el('p', { text: i18n.t('starfield.config.todo') }),
      // ★ 指令提示：编队界面（开发测试用）已从界面入口移除，改为控制台指令 ⇒ 在此告知测试者
      el('p', { text: i18n.t('starfield.config.drillHint') }),
      // ★ **C-1 入口（占位）**：进入星域大地图。本轮尚无正式配置流程 ⇒ 若当前没有星域实例，
      //   由 `ui/starfieldSession.js ensureStarfield()` 用「默认配置 `h1` + 随机种子」兜底创建
      //   （随机种子＝A-1 规定的唯一非确定性入口、且只允许界面使用；**C-3** 起改由本界面正式选择难度/种子）。
      el('p', { text: i18n.t('starfield.config.mapHint') }),
      el('button', {
        class: 'btn',
        text: i18n.t('starfield.config.enterMap'),
        onclick: () => {
          ensureStarfield();
          router.show('starfieldMap');
        },
      }),
      el('button', {
        class: 'btn small',
        text: i18n.t('menu.back'),
        onclick: () => router.show('menu'),
      }),
    ]),
  ]);
}

export const starfieldConfigView = {
  root,
};

export default starfieldConfigView;
