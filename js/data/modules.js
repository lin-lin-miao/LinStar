/* ===== data/modules.js —— 模块注册总表（index） =====
 * 组织（用户定稿 A）：每个模块一个文件 data/modules/<id>.js，
 * 本文件汇总成 MODULES 注册表。原导入路径(data/modules.js)保持不变。
 *
 * 模块文件统一结构（base 即 Lv1）：
 *   id / nameKey / category / target / effects / maxLevel
 *   可选占位字段：icon(SVG 路径，无则显示名称首字)、name(名称降级占位)、
 *                 desc(描述降级占位，i18n 无该词条时用)。
 *   levels[]      = 高阶等级差异表（逐级绝对表；某级未填字段回退“上一级”）。
 *   levels 每项可覆盖 effects（数值词条 + type 钩子）与 target（kinds/countMode…）。
 *
 * 铁律：模块的功能与数值一律由用户人工设定；数值只在各模块文件里维护。
 * 注：regenShield/rampCannon 曾仅作测试，已按用户要求移除注册(文件留存)，不再重做。
 */
import cannon from './modules/attack/cannon.js';
import concussionCannon from './modules/attack/concussionCannon.js';
import heavyCannon from './modules/attack/heavyCannon.js';
import laser from './modules/attack/laser.js';
import dualLaser from './modules/attack/dualLaser.js';
import denseBarrage from './modules/attack/denseBarrage.js';
import laserDroneSpawn from './modules/drone/laserDroneSpawn.js';
import rocketLauncher from './modules/attack/rocketLauncher.js';
import rocketWarhead from './modules/attack/rocketWarhead.js';
import missileLauncher from './modules/attack/missileLauncher.js';
import missileWarhead from './modules/attack/missileWarhead.js';
import omegaMissileWarhead from './modules/attack/omegaMissileWarhead.js';
import alphaShield from './modules/shield/alphaShield.js';
import regenShield from './modules/shield/regenShield.js';
import hardShield from './modules/shield/hardShield.js';
import reflectShield from './modules/shield/reflectShield.js';
import allianceShield from './modules/shield/allianceShield.js';
import blastShield from './modules/shield/blastShield.js';
import emp from './modules/function/emp.js';
import singleHanded from './modules/function/singleHanded.js';
import impregnable from './modules/function/impregnable.js';
import timeWarp from './modules/function/timeWarp.js';
import slowTime from './modules/function/slowTime.js';
import overload from './modules/function/overload.js';
import stealth from './modules/function/stealth.js';
import omegaMissileLauncher from './modules/function/omegaMissileLauncher.js';
import reactorCoil from './modules/function/reactorCoil.js';
import hullArmor from './modules/function/hullArmor.js';
import shieldBattery from './modules/function/shieldBattery.js';
import recycle from './modules/function/recycle.js';
import energyTransfer from './modules/function/energyTransfer.js';
import cargoHold from './modules/transport/cargoHold.js';
import oreHold from './modules/mining/oreHold.js';

export const MODULES = {
  cannon,
  concussionCannon,  // 攻击 · 震荡炮（爆炸范围 blast_range）
  heavyCannon,
  laser,
  dualLaser,
  denseBarrage,
  laserDroneSpawn,
  rocketLauncher,   // 攻击 · 召唤一次性火箭（C06）
  rocketWarhead,    // 内部：火箭携带的一次性弹药（picker:false，不进入编队可选）
  missileLauncher,  // 攻击 · 召唤导弹（爆炸范围 blast_range）
  missileWarhead,   // 内部：导弹携带的爆炸弹头（picker:false，不进入编队可选）
  omegaMissileWarhead, // 内部：欧米茄导弹携带的爆炸弹头（picker:false；伤害/blast_range/引信均高于导弹弹头）
  alphaShield,      // 护盾 · 对自身持续的"无敌"护盾
  regenShield,      // 护盾 · 持续型再生护盾（耗能回盾）
  hardShield,       // 护盾 · 厚实大护盾(大上限·持续)
  reflectShield,    // 护盾 · 反射护盾（自身层被击时按系数返还）
  allianceShield,   // 护盾 · 同盟护盾（跨友方共享层）
  blastShield,      // 护盾 · 防爆护盾（跨友方共享层 · 只挡爆炸型伤害）
  emp,              // 功能 · 电磁脉冲（自身/目标/波及：清空能量上限并持续一段时间）
  singleHanded,     // 功能 · 单枪匹马（条件型自身增益：友方只剩自己时加法提升自身攻击系数）
  impregnable,      // 功能 · 固若金汤（时长型：强制选定目标攻击自己 + 自身受伤减免）
  timeWarp,         // 功能 · 时间扭曲（时长型：目标+波及+自身 时间系数为负＝加速；多来源加性求和）
  slowTime,         // 功能 · 放缓时间（时长型：目标+波及+自身 时间系数为正＝放缓；时间扭曲的镜像反向）
  overload,         // 功能 · 辐能过载（C20 报仇雪恨：低血门控 + 后触发延迟爆炸 + 爆炸范围）
  stealth,          // 功能 · 潜行（C23：自身潜行＝不可被选为主要攻击目标；仍受溅射/仍受锁定；清空自身能量上限）
  omegaMissileLauncher, // 功能 · 欧米茄导弹发射器（C22：召唤不锁定目标、带护盾、在场上限 2 的欧米茄导弹）
  reactorCoil,      // 功能 · 强辐线圈（C24 反应堆增幅 · 常驻增幅器：自身能量上限 + 能量恢复，无冷却/耗能/持续）
  hullArmor,        // 功能 · 船体装甲（常驻增幅器：自身血量上限提升，无冷却/耗能/持续）
  shieldBattery,    // 功能 · 护盾电池（常驻增幅器：自身护盾系数 +0.1 / 能量上限 −100，无冷却/耗能/持续）
  recycle,          // 功能 · 回收利用（常驻被动：按**上一 tick**非召唤单位阵亡数恢复自身生命）
  energyTransfer,   // 功能 · 能量输送（主动·单体友方：消耗自身能量给目标加能量 energy_target，钳到目标上限）
  cargoHold,        // 运输 · 货舱（C25 常驻增幅器：自身货物容量 cargo_cap_bonus，无冷却/耗能/持续）
  oreHold,          // 采矿 · 矿舱（C34 语义「采矿载货强化」常驻增幅器：自身矿物容量 ore_cap_bonus）
};

/** 模块类别展示顺序（后续 UI/筛选用）：攻击/护盾/功能/运输/采矿/无人机 */
export const CATEGORY_ORDER = ['attack', 'shield', 'function', 'transport', 'mining', 'drone'];

export default MODULES;
