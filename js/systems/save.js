/* ===== systems/save.js —— 存档系统 =====
 * 存档 = 单个 JSON 对象：{ schemaVersion, savedAt, settings, data }
 *  - settings：locale 等偏好
 *  - data    ：游戏进度（基地/舰队/研究/解锁等，后续里程碑写入）
 * 能力：localStorage 本地持久化 / 自动保存 / 导出下载 / 导入校验 / 版本迁移
 *
 * 保存时机规则（M0 起）：
 *  - 战斗中（combat:state {active:true}）禁止保存/导出/导入；
 *  - 战斗结束（combat:state {active:false}，即结算完成后）自动持久化一次；
 *  - 其余非战斗时刻可随时保存（自动保存定时器 / 离开页面时）。
 *
 * 事件：'save:persisted' / 'save:imported' / 'save:import-error'
 */
import { bus } from '../core/eventBus.js';
import { log } from '../core/log.js';
import { i18n } from '../i18n/index.js';

const STORAGE_KEY = 'linsar.save.v1';
const SCHEMA_VERSION = 1;

/** 版本迁移表：migrations[v] 把 v 版升级到 v+1 版 */
const migrations = {
  // 1: 初始版本（M0 空进度），无迁移函数
};

function defaultData() {
  return {
    player: {},      // 玩家信息（占位）
    flags: {},       // 各类解锁标记（M3+）
    stats: {},       // 累计统计（M2+ 战斗统计）
  };
}

function defaultSettings() {
  return { locale: 'zh-CN' };
}

/** 深拷贝（JSON 兼容数据，避免存档对象被外部意外共享引用） */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 校验并迁移外部存档对象到当前 schemaVersion */
function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('不是有效的存档对象');
  }
  let obj = clone(raw);
  let v = Number(obj.schemaVersion) || 0;
  if (v > SCHEMA_VERSION) {
    throw new Error(`存档版本(${v})高于当前支持版本(${SCHEMA_VERSION})`);
  }
  while (v < SCHEMA_VERSION) {
    const up = migrations[v];
    obj = up ? up(obj) : obj;
    v += 1;
    obj.schemaVersion = v;
  }
  return obj;
}

function checkStorage() {
  try {
    const probe = '__linsar_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function tsName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `linsar-save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

export const save = (() => {
  let data = defaultData();
  let settings = defaultSettings();
  let combatActive = false;
  const storageOk = checkStorage();

  if (!storageOk) {
    log.warn('localStorage 不可用，将仅支持手动导出/导入');
  }

  /** 监听战斗状态：开始禁止保存；结束（结算完成后）立即自动保存 */
  bus.on('combat:state', ({ active } = {}) => {
    const wasActive = combatActive;
    combatActive = Boolean(active);
    if (wasActive && !combatActive) persistNow();
  });

  /** 编码当前状态为可序列化存档对象 */
  function encode() {
    return {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      settings: clone(settings),
      data: clone(data),
    };
  }

  /** 用存档对象覆盖当前状态（含迁移） */
  function decode(obj) {
    const valid = migrate(obj);
    settings = Object.assign(defaultSettings(), valid.settings || {});
    data = Object.assign(defaultData(), valid.data || {});
  }

  function persistNow() {
    if (!storageOk) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(encode()));
      bus.emit('save:persisted');
      return true;
    } catch (err) {
      log.error(`保存本地存档失败：${err}`);
      return false;
    }
  }

  return {
    /** 运行期游戏进度对象（可读写） */
    get data() { return data; },
    /** 运行期设置对象（可读写，如 settings.locale） */
    get settings() { return settings; },
    get storageAvailable() { return storageOk; },
    /** 是否处于战斗中（战斗中禁止存档） */
    get combatActive() { return combatActive; },
    /** 当前是否允许保存/导出/导入 */
    get isSaveAllowed() { return !combatActive; },

    /** 从 localStorage 载入存档（无则保持默认） */
    load() {
      if (!storageOk) return false;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        decode(JSON.parse(raw));
        return true;
      } catch (err) {
        log.error(`读取本地存档失败：${err}`);
        return false;
      }
    },

    /** 持久化当前状态到 localStorage；战斗中返回 false（静默跳过） */
    persist() {
      if (combatActive) return false;
      return persistNow();
    },

    /** 导出：生成 JSON 文件并触发下载；战斗中拒绝 */
    export() {
      if (combatActive) {
        log.warn(i18n.t('save.exportBusy'));
        return false;
      }
      download(tsName(), JSON.stringify(encode(), null, 2));
      log.info(i18n.t('save.exported'));
      return true;
    },

    /** 导出数据（供 LS / 调试使用） */
    exportData() {
      return encode();
    },

    /** 从 JSON 文本导入（校验 + 迁移 + 覆盖）；失败抛出异常 */
    importText(text) {
      if (combatActive) {
        throw new Error('busy');
      }
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        throw new Error('JSON 解析失败');
      }
      decode(obj); // 内部会迁移/校验
      log.info(i18n.t('save.imported'));
      bus.emit('save:imported', { settings: clone(settings) });
      return true;
    },

    /** 从 File 对象导入（UI 文件选择用），失败时广播错误事件 */
    importFile(file) {
      if (combatActive) {
        log.warn(i18n.t('save.importBusy'));
        bus.emit('save:import-error', { err: 'busy' });
        return;
      }
      file
        .text()
        .then((text) => this.importText(text))
        .catch((err) => {
          log.error(`存档导入失败：${err}`);
          bus.emit('save:import-error', { err: String(err) });
        });
    },

    /** 重置为默认档（测试用） */
    reset() {
      data = defaultData();
      settings = defaultSettings();
      this.persist();
      log.warn('存档已重置为默认');
    },
  };
})();

export default save;
