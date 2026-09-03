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

/** 深拷贝（JSON 兼容对象） */
export function deepClone(obj) {
  return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}

/** 延时 promise */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
