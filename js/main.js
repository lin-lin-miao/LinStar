/* ===== main.js —— 启动引导 =====
 * 顺序：载入存档 -> 设置语言 -> 挂载路由/HUD -> 显示菜单 -> 启动 tick -> 自动保存
 * 调试：window.LS（M0.8）
 */
import { bus } from './core/eventBus.js';
import { el } from './core/utils.js';
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
    window.alert(err === 'busy' ? i18n.t('save.importBusy') : i18n.t('save.importError', { err }));
  });

  // 6. 自动保存
  setInterval(() => save.persist(), AUTOSAVE_MS);
  window.addEventListener('beforeunload', () => save.persist());

  // 7. 调试控制台
  attachDebug();

  log.info('LinStar M1.9 启动完成');
}

/* ===== window.LS 调试控制台（M0.8） ===== */
function attachDebug() {
  window.LS = {
    version: '0.5-m1.9',
    state: () => save.data,
    goto: (name) => router.show(name),
    tick: {
      get count() { return ticker.count; },
      get tps() { return ticker.tps; },
      pause: () => ticker.pause(),
      resume: () => ticker.resume(),
      step: () => ticker.step(),           // 暂停下逐帧推进一帧
      setSpeed: (v) => ticker.setSpeed(v),
    },
    // 战斗状态模拟（供测试 HUD 与存档门控；M1 起由 battle.js 自动广播）
    combat: {
      on: () => bus.emit('combat:state', { active: true }),
      off: () => bus.emit('combat:state', { active: false }),
      get active() { return save.combatActive; },
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

/* ===== window 级错误红条（诊断用）：任何运行时报错都会显示在页面上 ===== */
function installErrorReporter() {
  function show(title, msg) {
    try {
      const box = el('div', {
        class: 'fatal-overlay',
        style:
          'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
          'background:rgba(20,5,8,0.92);padding:24px;',
      });
      const panel = el('div', {
        style:
          'max-width:720px;max-height:80vh;overflow:auto;border:1px solid #ff5d6c;border-radius:12px;' +
          'background:#1a0f14;padding:18px 22px;color:#ffd7db;font:13px/1.6 Consolas,monospace;white-space:pre-wrap;',
      });
      panel.append(
        el('div', {
          style: 'font-size:16px;font-weight:700;color:#ff8a94;margin-bottom:8px;',
          text: title,
        }),
        el('div', { text: msg }),
        el('button', {
          class: 'btn small',
          style: 'margin-top:12px;',
          text: '重载 Reload',
          onclick: () => location.reload(),
        })
      );
      box.append(panel);
      document.body.append(box);
    } catch {
      // 无法渲染时保持控制台输出
    }
  }
  window.addEventListener('error', (e) => {
    show(`运行时错误 Runtime Error（${e.message || 'unknown'}）`, e.error?.stack || `${e.filename || ''}:${e.lineno || ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    show('未处理的 Promise 拒绝 Unhandled Rejection', String(e.reason));
  });
}

/* ===== 启动引导 ===== */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    installErrorReporter();
    boot();
  });
} else {
  installErrorReporter();
  boot();
}
