#!/usr/bin/env node
/* ===== tools/patch-ship-unlock-fields.mjs —— 船型配置（js/data/ships/*.js）新增解锁字段位 =====
 *
 * 【用途】M3b · 第 1 项 —— 给**每个船型配置**新增字段位 **`unlockByLevel`**：
 *   · 语义：该船型**逐级的"后续特性 / 特殊条件"解锁条件**（★ 用户口径：高等级建造的
 *     解锁 / 升级条件**不由货物决定**，故在此单列一个空数组占位）；
 *   · M3b 取值恒为 `[]`（＝**无条件**）；引擎口径见 `systems/base.js` 的 `unlockOkOf()`：
 *     列表为空 ⇒ 解锁通过；列表非空 ⇒ 视为"条件尚未实装"⇒ **拒绝建造**（保守：绝不静默忽略未知条件）。
 *   · 本脚本**只加字段**，不改任何既有数值（`buildCost` / `upgradeCost` / `slotGrowth` / `levels[]` 一字不动）。
 *
 * 【用法】在项目根目录 `LinStar/` 下执行：
 *     node tools/patch-ship-unlock-fields.mjs --dry-run   # 预演：只打印将要改哪些文件，**不落盘**
 *     node tools/patch-ship-unlock-fields.mjs             # 实改：写回文件（幂等）
 *     node tools/patch-ship-unlock-fields.mjs --help      # 帮助
 *
 * 【幂等保证】先判断文件里是否已有 `unlockByLevel` 键（有 ⇒ 整文件跳过）；
 *   插入锚点＝`slotGrowth` 那一行（插入到其后）。⇒ 第二次执行时改动计数恒为 0、文件逐字节不变。
 *
 * 【收尾】逐文件复检 `unlockByLevel` 命中数并打印（4/4 ＝ 全部就位），再打印建议的 `node --check` 列表。
 * ★ 本文件**不参与应用加载**（位于 `tools/`，不被任何模块 import）。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..'); // ⇒ LinStar/
const shipDir = join(projectRoot, 'js', 'data', 'ships');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：node tools/patch-ship-unlock-fields.mjs [--dry-run]');
  process.exit(0);
}
if (!existsSync(shipDir)) {
  console.error(`✗ 找不到船型配置目录：${shipDir}`);
  console.error('  （请在项目根目录 LinStar/ 下执行本脚本）');
  process.exit(1);
}

/** 新增字段行（缩进 2 空格；注释与 `data/ships/*.js` 既有体例一致） */
const NEW_LINE =
  '  /* ★ `unlockByLevel` 逐级**后续特性 / 特殊条件**的解锁条件（用户口径：**不由货物决定**）——' +
  'M3b 为空数组＝无条件；非空 ⇒ 视为"条件尚未实装"、引擎保守拒绝建造。 */\n' +
  '  unlockByLevel: [], // 【占位预填 · 待用户调校】';

/**
 * 单个文件的改动。
 * @returns {{ out: string, changes: string[] }}
 */
function transform(text) {
  const changes = [];
  if (/unlockByLevel\s*:/.test(text)) return { out: text, changes }; // 已就位 ⇒ 幂等跳过

  const lines = text.split('\n');
  let anchor = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*slotGrowth\s*:/.test(lines[i])) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) {
    changes.push('⚠ 未找到 `slotGrowth` 锚点（需人工插入 unlockByLevel）');
    return { out: text, changes };
  }
  lines.splice(anchor + 1, 0, NEW_LINE);
  changes.push('新增字段位 unlockByLevel: []（空数组＝无条件；位于 slotGrowth 之后）');
  return { out: lines.join('\n'), changes };
}

/* ---------- 主流程 ---------- */

const files = readdirSync(shipDir)
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .sort();

console.log(`船型配置解锁字段位${dryRun ? '（**预演 dry-run：不落盘**）' : ''} —— 目录：${shipDir}`);
console.log(`待处理文件：${files.length} 个\n`);

let touched = 0;
for (const file of files) {
  const path = join(shipDir, file);
  const src = readFileSync(path, 'utf8');
  const { out, changes } = transform(src);
  if (!changes.length) {
    console.log(`· ${file}：无改动（unlockByLevel 已就位）`);
    continue;
  }
  touched += 1;
  console.log(`· ${file}：${changes.length} 处改动`);
  for (const c of changes) console.log(`    - ${c}`);
  if (!dryRun) writeFileSync(path, out, 'utf8');
}

console.log(`\n合计：${touched}/${files.length} 个文件有改动${dryRun ? '（预演，未落盘）' : '（已写回）'}`);

/* ---------- 就位复检 ---------- */
console.log('\n字段位复检（期望每个文件 1 处 `unlockByLevel`）：');
let missing = 0;
for (const file of files) {
  const hits = (readFileSync(join(shipDir, file), 'utf8').match(/unlockByLevel\s*:/g) || []).length;
  if (hits !== 1) missing += 1;
  console.log(`  ${hits === 1 ? '✓' : '✗'} ${file}：unlockByLevel × ${hits}`);
}
console.log(missing === 0 ? '  ✓ 全部就位' : `  ✗ ${missing} 个文件未就位`);

console.log('\n建议语法检查（请在上层执行）：');
for (const file of files) console.log(`  node --check js/data/ships/${file}`);

process.exit(missing === 0 ? 0 : 1);
