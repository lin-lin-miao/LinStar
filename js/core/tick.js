/* ===== core/tick.js —— 游戏刻主循环 =====
 * 1 秒 = 20 tick（TICK_MS = 50ms），与《我的世界》一致。
 * 采用固定步长累加器：定时器以 50ms 固定频率触发，按 speed 倍率累加应走的时间，
 * 每满 50ms 结算 1 tick。暂停时只停累加，不销毁定时器。
 * 提供 tps（实测每秒 tick 数，滚动 1s 窗口），供 HUD 显示"tick/s"。
 */
import { bus } from './eventBus.js';

const TICK_MS = 50;             // 每 tick 的毫秒数（20 tps）
const SPEED_MIN = 0.25;         // 0.25x 慢速档下限（倍速可为分数）
const SPEED_MAX = 8;
const TPS_WINDOW_MS = 1000;     // TPS 统计窗口

let acc = 0;                    // 累加器（毫秒）
let count = 0;                  // 已走过的 tick 总数
let speed = 1;
let running = true;
let timer = null;
const history = [];             // 最近 tick 的时间戳（performance.now），升序

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 丢弃窗口外的时间戳 */
function pruneHistory(now) {
  while (history.length && now - history[0] > TPS_WINDOW_MS) history.shift();
}

function emitState() {
  bus.emit('ticker:state', { running, speed, count });
}

function pump() {
  if (!running) return;
  acc += TICK_MS * speed;
  const now = nowMs();
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    count += 1;
    history.push(now);
    bus.emit('tick', { count, tps: measureTps(now) });
  }
}

/** 实测最近 1 秒内的 tick 数（暂停时为 0） */
function measureTps(now = nowMs()) {
  if (!running || history.length === 0) return 0;
  pruneHistory(now);
  const cutoff = now - TPS_WINDOW_MS;
  let n = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i] >= cutoff) n += 1;
    else break;
  }
  return n;
}

export const ticker = {
  get count() { return count; },
  get speed() { return speed; },
  get running() { return running; },
  /** 实测每秒 tick（HUD 显示用） */
  get tps() { return measureTps(); },

  start() {
    if (!timer) timer = setInterval(pump, TICK_MS);
  },

  pause() {
    if (!running) return;
    running = false;
    acc = 0;
    history.length = 0;
    emitState();
  },

  resume() {
    if (running) return;
    running = true;
    history.length = 0; // 清空旧时间戳，避免暂停恢复瞬间 TPS 虚高
    emitState();
  },

  toggle() { running ? this.pause() : this.resume(); },

  /** 逐帧：仅暂停状态下手动推进一帧（结算 1 tick）。运行中调用无效果。 */
  step() {
    if (running) return false;
    count += 1;
    history.push(nowMs());
    bus.emit('tick', { count, tps: 0 });
    emitState();
    return true;
  },

  setSpeed(v) {
    const n = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number(v) || 1));
    if (n === speed) return;
    speed = n;
    history.length = 0; // 变速后重新计量
    emitState();
  },

  /** 仅供测试：重置计数 */
  reset() {
    count = 0;
    acc = 0;
    history.length = 0;
    emitState();
  },
};
