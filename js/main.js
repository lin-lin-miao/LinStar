/* ===== main.js —— 启动引导 =====
 * 顺序：载入存档 -> 设置语言 -> 挂载路由/HUD -> 显示菜单 -> 启动 tick -> 自动保存
 * 调试：window.LS（M0.8）
 */
import { bus } from './core/eventBus.js';
import { ticker } from './core/tick.js';
import { log } from './core/log.js';
import { i18n } from './i18n/index.js';
import { save } from './systems/save.js';
import { router } from './ui/router.js';
import { hud } from './ui/hud.js';
import { menuView } from './ui/menuView.js';
import { battleView } from './ui/battleView.js';

const AUTOSAVE_MS = 10_000; // 每 10 秒自动保存一次

function boot() {
  // 1. 存档与语言
  save.load();
  i18n.set(save.settings.locale || 'zh-CN');
  document.documentElement.lang = i18n.locale;

  // 2. 路由与视图
  router.mount(document.getElementById('app-screen'));
  router.register('menu', menuView);
  router.register('battle', battleView);

  // 3. 顶栏
  hud.mount(document.getElementById('app-header'));

  // 4. 首屏与时钟
  router.show('menu');
  ticker.start();

  // 5. 全局事件接线
  bus.on('i18n:changed', ({ locale }) => {
    save.settings.locale = locale;
    document.documentElement.lang = locale;
    save.persist();
    router.repaint();
  });

  bus.on('save:imported', () => {
    // 导入档可能携带不同语言设置
    if (i18n.set(save.settings.locale || 'zh-CN')) {
      document.documentElement.lang = i18n.locale;
    }
    router.show(router.current || 'menu');
  });

  bus.on('save:import-error', ({ err }) => {
    // eslint-disable-next-line no-alert
    window.alert(i18n.t('save.importError', { err }));
  });

  // 6. 自动保存
  setInterval(() => save.persist(), AUTOSAVE_MS);
  window.addEventListener('beforeunload', () => save.persist());

  // 7. 调试控制台
  attachDebug();

  log.info('LinStar M0 启动完成');
}

/* ===== window.LS 调试控制台（M0.8） ===== */
function attachDebug() {
  window.LS = {
    version: '0.1-m0',
    state: () => save.data,
    goto: (name) => router.show(name),
    tick: {
      get count() { return ticker.count; },
      pause: () => ticker.pause(),
      resume: () => ticker.resume(),
      setSpeed: (v) => ticker.setSpeed(v),
    },
    i18n: {
      set: (loc) => i18n.set(loc),
      get locale() { return i18n.locale; },
    },
    save: {
      now: () => save.persist(),
      export: () => save.export(),
      reset: () => { save.reset(); router.show('menu'); },
      raw: () => JSON.stringify(save.exportData(), null, 2),
    },
    log: {
      dump: () => log.dump(),
      clear: () => log.clear(),
    },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
