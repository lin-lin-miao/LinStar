/* ===== ui/starfieldSession.js —— 界面侧「当前星域」持有者（★ 只持引用，不驱动、不改引擎） =====
 * 为什么需要它：星域实例由**控制台**（`LS.starfield.create`）或**地图视图**（进入时兜底创建）产生，
 *   两处必须是**同一个**星域 ⇒ 把“当前星域”的持有权收进这一个模块（唯一来源），
 *   控制台入口与地图视图都从这里取/放，避免出现两个各说各话的副本。
 * 职责边界（**严格只做持有**）：
 *   · `getStarfield()`    取当前星域（无 ⇒ null）；
 *   · `setStarfield(sf)`  放入（并同步 `window.__starfield` 只读镜像，体例同 `window.__battle`）；
 *   · `ensureStarfield()` 兜底创建：**尚无实例时**用默认配置 + 默认种子建一个（见下方口径）。
 * ★ **不在此驱动 tick、不在此读引擎内部状态、不做任何数值/生成**（tick 驱动见 `starfieldMapView.js`）。
 *
 * ★ 默认实例口径（**C-1 占位，待 C-3 由「星域配置界面」正式提供**）：
 *   · 默认配置 id ＝ `h1`（`data/starfields/` 的最低难度档，A-4 已注册）；
 *   · 默认种子 ＝ `core/rng.js randomSeed()` —— **A-1 规定的“唯一非确定性入口”，且只允许界面使用**
 *     （生成器 `generateStarfield` 自身在缺种子时**抛错**、绝不回落随机 ⇒ 随机种子必须由界面给出）；
 *   · C-3 落地后：难度/种子改由配置界面选择（种子仍只在该界面输入），本兜底仅用于控制台/测试路径。
 */
import { createStarfield } from '../systems/starfield.js';
import { randomSeed } from '../core/rng.js';

/** 默认星域配置 id（占位；C-3 由配置界面提供真实选择） */
export const DEFAULT_STARFIELD_ID = 'h1';

let current = null;

/** 取当前星域（无 ⇒ null） */
export function getStarfield() {
  return current;
}

/** 放入当前星域（并同步 window.__starfield 只读镜像）；返回该实例 */
export function setStarfield(sf) {
  current = sf || null;
  if (typeof window !== 'undefined') window.__starfield = current;
  return current;
}

/** 兜底创建（幂等）：无当前星域时用「默认配置 + 随机种子」建一个；有则原样返回 */
export function ensureStarfield() {
  if (current) return current;
  return setStarfield(createStarfield(DEFAULT_STARFIELD_ID, randomSeed()));
}

export default { getStarfield, setStarfield, ensureStarfield, DEFAULT_STARFIELD_ID };
