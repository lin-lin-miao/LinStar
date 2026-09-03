/* ===== ui/router.js —— 屏幕路由（菜单 / 战斗 / 主基地…） =====
 * 视图契约：{ root() -> Element }；每次 show 都重新生成 DOM，
 * 保证语言切换后重绘即可全量刷新文案。
 */
import { bus } from '../core/eventBus.js';

const views = new Map();
let container = null;
let current = null;

export const router = {
  get current() { return current; },

  /** 绑定屏幕容器 DOM */
  mount(dom) {
    container = dom;
  },

  /** 注册视图 */
  register(name, view) {
    views.set(name, view);
  },

  /** 切换到指定屏幕 */
  show(name) {
    const view = views.get(name);
    if (!view) {
      console.error(`[router] 未注册的屏幕: ${name}`);
      return;
    }
    if (!container) {
      console.error('[router] 屏幕容器未挂载');
      return;
    }
    if (view.beforeShow) view.beforeShow();
    container.replaceChildren(view.root());
    current = name;
    bus.emit('route', { name });
  },

  /** 重绘当前屏幕（如语言切换后） */
  repaint() {
    if (current) this.show(current);
  },
};

export default router;
