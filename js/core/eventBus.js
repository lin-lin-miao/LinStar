/* ===== core/eventBus.js —— 轻量事件总线（系统解耦） ===== */
const map = new Map(); // event -> Set<fn>

export const bus = {
  /** 订阅事件，返回取消订阅函数 */
  on(event, fn) {
    if (!map.has(event)) map.set(event, new Set());
    map.get(event).add(fn);
    return () => this.off(event, fn);
  },

  off(event, fn) {
    map.get(event)?.delete(fn);
  },

  /** 广播事件；单个监听器异常不阻断其它监听器 */
  emit(event, payload) {
    map.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[eventBus] listener error on "${event}"`, err);
      }
    });
  },

  /** 列出当前事件（调试用） */
  listEvents() {
    return [...map.keys()];
  },
};

export default bus;
