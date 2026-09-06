/* ===== ui/widgets.js —— 通用 UI 组件 ===== */
import { el } from '../core/utils.js';

/**
 * 数值条：label + 轨道 + 数值文本
 * bar('HP', 'var(--hp)') -> { el, update(value, max) }
 */
export function bar(labelText, colorVar) {
  const fill = el('div', { class: 'bar-fill', style: `width:0%;background:${colorVar};` });
  const track = el('div', { class: 'bar-track' }, [fill]);
  const label = el('span', { class: 'bar-label', text: labelText });
  const text = el('span', { class: 'bar-value', text: '0/0' });
  const rootEl = el('div', { class: 'bar' }, [label, track, text]);

  function update(value, max) {
    const v = Math.max(0, value);
    const m = Math.max(1, max);
    const pct = Math.min(100, (v / m) * 100);
    fill.style.width = `${pct.toFixed(1)}%`;
    text.textContent = `${Math.ceil(v)}/${Math.ceil(m)}`;
  }
  function setColor(colorVar) {
    fill.style.background = colorVar;
  }
  function glow(css) {
    fill.style.boxShadow = css || '';
  }

  return { el: rootEl, update, setColor, glow };
}

export default bar;
