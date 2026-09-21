/* ===== ui/menuView.js —— 主菜单 =====
 * ★★ M3a 修订（用户口径）：**主菜单只保留「主基地」一个入口** ——
 *   其余入口（星域配置界面 / 演练编队 `LS.drill()` 等）**一律从 UI 摘除，仅供测试控制台调出**；
 *   界面文案里**不写**任何"用命令打开"的说明（命令清单由文档维护，不进 UI）。
 */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { save } from '../systems/save.js';
import { router } from './router.js';

function root() {
  const storageNotice = save.storageAvailable
    ? null
    : el('div', { class: 'notice', text: i18n.t('save.unavailable') });

  return el('section', { class: 'screen screen-menu' }, [
    el('h1', { text: i18n.t('menu.title') }),
    el('p', { class: 'subtitle', text: i18n.t('menu.subtitle') }),
    // ★ 唯一入口（主基地）；路由 `base` ⇒ 左列表 + 右面板 + 顶部资源栏
    el('button', {
      class: 'btn primary',
      text: i18n.t('menu.base'),
      onclick: () => router.show('base'),
    }),
    storageNotice,
    el('div', { class: 'hint', text: i18n.t('menu.hint') }),
  ]);
}

export const menuView = {
  root,
};

export default menuView;
