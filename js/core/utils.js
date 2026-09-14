/* ===== core/utils.js —— 通用纯函数工具 ===== */

/** document.querySelector 简写 */
export const $ = (sel, root = document) => root.querySelector(sel);

/** document.querySelectorAll 简写（返回数组） */
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

/**
 * 创建元素：
 * el('div', { class: 'x', text: '你好', onclick: fn, dataset: {...}, style: '...' }, [children])
 * children 元素或字符串/数字，可嵌套数组。
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (child instanceof Node) node.append(child);
    else node.append(document.createTextNode(String(child)));
  }
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 生成短 id（同一时刻多次调用也尽量唯一） */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function pad2(n) { return String(n).padStart(2, '0'); }

/** 时间戳 -> HH:MM:SS */
export function clockTime(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** ★ **倍率 → 增量百分比**的唯一换算口径（`bonus` 是**倍率**、中性值 1 ⇒ 展示的是**增量**）：
 *  `增量% = (bonus − 1) × 100`，例如 1 → `'0'`、1.1 → `'10'`、1.15 → `'15'`、1.125 → `'12.5'`、0.9 → `'-10'`。
 *  · 返回值是**纯数字字符串**（**不含 `%`**）—— 百分号属展示措辞，由调用方走 i18n 模板拼（体例同
 *    `core/tick.js formatTickSeconds` 只返回数字、秒的 `s` 由 i18n 提供）；
 *  · **四舍五入到 1 位小数并去掉无意义 `.0`**（`toFixed(1)` 后转 Number 再转字符串，顺带消掉浮点尾巴）；
 *  · **负加成用同一公式**（如 0.9 → `'-10'`），不做特判；`bonus` 非数值按中性值 1 处理（→ `'0'`）。
 *  ★ 展示层唯一来源：任何界面需要显示“加成 x%”都调用本函数，**禁止各自手写 `(b-1)*100` 私有公式**。 */
export function formatBonusPercent(bonus) {
  const b = Number(bonus);
  const inc = (Number.isFinite(b) ? b - 1 : 0) * 100;
  return String(Number(inc.toFixed(1)));
}

/** 深拷贝（JSON 兼容对象） */
export function deepClone(obj) {
  return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}

/** 深合并补丁对象 patch 到 base（就地改 base）：普通对象递归合并，数组/原始值直接覆盖（数组拷贝）。
 *  用于等级表的"逐级只写差异、未填字段回退上一级"（船型 levels 见 data/ships/index.js；
 *  模块 levels 见 entities/module.js 的同名本地实现，体例一致）。 */
export function deepMerge(base, patch) {
  if (!patch) return base;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        deepMerge(base[k], v);
      } else {
        base[k] = deepClone(v);
      }
    } else {
      base[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return base;
}

/** 延时 promise */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
