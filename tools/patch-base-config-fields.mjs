#!/usr/bin/env node
/* ===== tools/patch-base-config-fields.mjs —— 货物配置（js/data/cargos/*.js）基地侧字段批量修订 =====
 *
 * 【用途】M3a 修订 · 用户口径第 5 项 —— 把 **7 个货物配置**里的基地侧字段统一改成新口径：
 *   ① `blueprintOutput`：**删除** `bonusField` / `bonusMode`（货物没有"加成模式"），
 *      **新增** `bonus`（**直接决定加成**的字段，M3 先按 0 加成＝产出等于基础数量）；
 *   ② `researchCost`：**删除** `count`（**一次研究一个货物、一个即有产出** ⇒ 没有"件数"消耗）；
 *   ③ 同步改写注释语义：产出数量 ＝ `baseByLevel[等级].count` 经 `bonus` 加成后的结果；
 *   ④ 顺带清理其它"研究所需数量"类残留键（`researchCount` / `researchQuantity` / `researchNeedCount`）；
 *   ⑤ 顺手还原 M3a 首版的小瑕疵：把被字段块挤到 `blueprintOutput` 行末尾的行内注释
 *      （`// i18n -> …`）**移回 `nameKey` 行**（**不影响运行**，仅为注释归位）。
 *
 * 【用法】在项目根目录 `LinStar/` 下执行：
 *     node tools/patch-base-config-fields.mjs --dry-run    # 预演：只打印"将要改哪个文件的哪些键"，**不落盘**
 *     node tools/patch-base-config-fields.mjs              # 实改：写回文件（幂等）
 *     node tools/patch-base-config-fields.mjs --help       # 帮助
 *
 * 【幂等保证】每一次替换都**先判断目标串是否还在**（在才替换，替换后必然不在）；
 *   新增 `bonus` 前先检查该行是否已有 `bonus` 键（已有 ⇒ 跳过）。
 *   ⇒ 第二次执行时所有"改动计数"恒为 0、文件**逐字节不变**；脚本末尾会自行复检并打印残留计数。
 *
 * 【收尾】
 *   · 复检残留（`bonusField` / `bonusMode` / `researchCost.count` / `researchCount`）⇒ 打印命中数（期望 0）；
 *   · 打印建议的 `node --check` 命令（本脚本**不**代替语法检查，交由上层执行）。
 *
 * ★ 本文件**不参与应用加载**：位于 `tools/`（不在 `js/` 下），不被任何模块 import，也不写入 `index.html`。
 * ★ 只改 `js/data/cargos/<id>.js` 这 7 个数据文件（**不动** `js/data/cargos/index.js` 注册表）。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..'); // ⇒ LinStar/
const cargoDir = join(projectRoot, 'js', 'data', 'cargos');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：node tools/patch-base-config-fields.mjs [--dry-run]');
  process.exit(0);
}

if (!existsSync(cargoDir)) {
  console.error(`✗ 找不到货物配置目录：${cargoDir}`);
  console.error('  （请在项目根目录 LinStar/ 下执行本脚本）');
  process.exit(1);
}

/** 需要复检的残留模式（脚本结束后逐文件扫描，期望全部 0 命中） */
const RESIDUE_PATTERNS = [
  { label: 'bonusField', re: /bonusField/g },
  { label: 'bonusMode', re: /bonusMode/g },
  { label: 'researchCost.count', re: /researchCost\s*:\s*\{[^}]*\bcount\s*:/g },
  { label: 'researchCount 类残留键', re: /^\s*(?:researchCount|researchQuantity|researchNeedCount)\s*:/gm },
];

/**
 * 对单个文件正文做统一改动。
 * @param {string} text 文件正文
 * @returns {{ out: string, changes: string[] }} 新正文与"改了哪几个键"的摘要
 */
function transform(text) {
  const changes = [];
  const note = (label) => changes.push(label);
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    /* ---------- ④ 残留键：整行删除（本批配置里通常不存在 ⇒ 属安全网） ---------- */
    if (/^\s*(?:researchCount|researchQuantity|researchNeedCount)\s*:/.test(line)) {
      note(`删除残留键 ${line.trim().split(':')[0].trim()}`);
      lines[i] = '';
      continue;
    }

    /* ---------- ① blueprintOutput：删 bonusField / bonusMode，新增 bonus ---------- */
    if (line.includes('blueprintOutput:')) {
      const a = line;
      line = line.replace(/,\s*bonusField\s*:\s*(?:'[^']*'|"[^"]*")/g, '');
      if (line !== a) note('blueprintOutput.bonusField 删除');

      const b = line;
      line = line.replace(/,\s*bonusMode\s*:\s*(?:'[^']*'|"[^"]*")/g, '');
      if (line !== b) note('blueprintOutput.bonusMode 删除');

      if (!/(^|[^A-Za-z0-9_])bonus\s*:/.test(line) && line.includes('baseByLevel:')) {
        const c = line;
        // 插到 baseByLevel 之后（`baseByLevel: [...]` 内部无嵌套 `]` ⇒ 正则安全）
        line = line.replace(/(baseByLevel\s*:\s*\[[^\]]*\])\s*,/, '$1, bonus: 0,');
        if (line !== c) note('blueprintOutput.bonus 新增（占位 0）');
        else note('⚠ blueprintOutput 行未能定位 baseByLevel（需人工检查）');
      }
    }

    /* ---------- ② researchCost：删掉 count（一次研究一个货物 ⇒ 无件数） ---------- */
    if (line.includes('researchCost:')) {
      const a = line;
      line = line.replace(/researchCost\s*:\s*\{\s*count\s*:\s*[^,}]*,\s*/, 'researchCost: { ');
      const b = line;
      line = line.replace(/researchCost\s*:\s*\{\s*([^}]*?),\s*count\s*:\s*[^,}]*\s*\}/, 'researchCost: { $1 }');
      if (line !== a || line !== b) note('researchCost.count 删除（一次研究一个货物 ⇒ 无件数消耗）');
    }

    /* ---------- ③ 注释语义同步（两条：bonus 语义、(件数 + 能量币) 口径） ---------- */
    if (line.includes('`bonusField`') && line.includes('`bonusMode`')) {
      const indent = (line.match(/^\s*\*\s*/) || [''])[0];
      lines[i] =
        `${indent}\`bonus\` 加成【占位预填 · 待用户调校】（M3 先按 0 加成 ⇒ 产出＝基础数量）：\n` +
        `${indent}产出数量 ＝ \`baseByLevel[等级].count\` 经 \`bonus\` 加成后的结果（加成口径与实装属 M3e）；`;
      note('注释：bonusField/bonusMode 说明 → bonus 语义说明');
      continue;
    }
    if (line.includes('（件数 + 能量币）')) {
      line = line.replace('（件数 + 能量币）', '（能量币；一次研究一个货物 ⇒ **无件数**）');
      note('注释：（件数 + 能量币）→（能量币；一次研究一个货物 ⇒ 无件数）');
    }

    lines[i] = line;
  }

  /* ---------- ⑤ 还原被"插入块"挤走的行内注释（M3a 首版遗留的小瑕疵，顺手修掉） ----------
   * 现象：5 个货物文件的 `nameKey: 'x', // i18n -> …` 行内注释被 M3 字段块挤到了
   *   `blueprintOutput: …` 那一行末尾（**不影响运行**，但注释挂错了行）。
   * 口径：把该注释**移回 `nameKey` 行**；已还原过 ⇒ `blueprintOutput` 行不再含该注释 ⇒ 自然幂等。 */
  const bpIdx = lines.findIndex((l) => l.includes('blueprintOutput:') && /\/\/\s*i18n\s*->/.test(l));
  const nkIdx = lines.findIndex((l) => /^\s*nameKey\s*:/.test(l));
  if (bpIdx >= 0 && nkIdx >= 0 && !/\/\/\s*i18n\s*->/.test(lines[nkIdx])) {
    const m = lines[bpIdx].match(/\s*(\/\/\s*i18n\s*->.*)$/);
    if (m) {
      lines[bpIdx] = lines[bpIdx].slice(0, m.index).replace(/\s+$/, '');
      lines[nkIdx] = `${lines[nkIdx].replace(/\s+$/, '')} ${m[1].trim()}`;
      note('行内注释还原：`// i18n -> …` 从 blueprintOutput 行移回 nameKey 行');
    }
  }

  return { out: lines.join('\n'), changes };
}

/* ---------- 主流程 ---------- */

const files = readdirSync(cargoDir)
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .sort();

console.log(`货物配置批量修订${dryRun ? '（**预演 dry-run：不落盘**）' : ''} —— 目录：${cargoDir}`);
console.log(`待处理文件：${files.length} 个\n`);

let touched = 0;
let changeCount = 0;
const changedFiles = [];

for (const file of files) {
  const path = join(cargoDir, file);
  const src = readFileSync(path, 'utf8');
  const { out, changes } = transform(src);

  if (!changes.length) {
    console.log(`· ${file}：无改动（已符合新口径）`);
    continue;
  }

  touched += 1;
  changeCount += changes.length;
  changedFiles.push(file);
  console.log(`· ${file}：${changes.length} 处改动`);
  for (const c of changes) console.log(`    - ${c}`);

  if (!dryRun) writeFileSync(path, out, 'utf8');
}

console.log(
  `\n合计：${touched}/${files.length} 个文件有改动，共 ${changeCount} 处` +
    (dryRun ? '（预演，未落盘）' : '（已写回）')
);

/* ---------- 残留复检（幂等 + 口径核对） ---------- */
console.log('\n残留复检（期望全部 0 命中）：');
let residueTotal = 0;
for (const file of files) {
  const text = readFileSync(join(cargoDir, file), 'utf8');
  for (const p of RESIDUE_PATTERNS) {
    p.re.lastIndex = 0;
    const hits = (text.match(p.re) || []).length;
    if (hits) {
      residueTotal += hits;
      console.log(`  ✗ ${file}：${p.label} × ${hits}`);
    }
  }
}
console.log(residueTotal === 0 ? '  ✓ 0 命中（bonusField / bonusMode / researchCost.count / researchCount）' : `  ✗ 共 ${residueTotal} 处残留`);

/* ---------- 语法检查提示（本脚本不代替执行） ---------- */
console.log('\n建议语法检查（请在上层执行）：');
for (const file of files) console.log(`  node --check js/data/cargos/${file}`);

process.exit(residueTotal === 0 ? 0 : 1);
