// Muvyo 插件本地沙箱：在 Node 的 vm 里加载插件入口，提供与 Muvyo QuickJS 环境同形的 mv 对象。
// 只用于本地开发与测试，不是安全边界，也不能替代真实 Muvyo 验收。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DEFAULTS = {
  executionMs: 60000,
  maxRequests: 30,
  maxBodyBytes: 1024 * 1024,
  maxResponseBytes: 4 * 1024 * 1024,
  maxStorageBytes: 64 * 1024,
  maxCacheEntryBytes: 256 * 1024,
  maxCacheEntries: 512,
  maxCacheBytes: 20 * 1024 * 1024,
  maxLogs: 200,
  maxLogChars: 500,
};

const ENTRY_FUNCTIONS = [
  'search', 'resolve', 'vlibItems',
  'contentList', 'contentCategories', 'contentSearch', 'contentDetail', 'contentPlay',
  'metadataSearch', 'metadataDetail', 'naming', 'webhookEvent', 'scheduledTask',
];

const CACHE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function cloneJson(value, label) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error(`${label} 必须是可 JSON 序列化的值`);
  }
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function lowerHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) out[String(key).toLowerCase()] = String(value);
  return out;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

// 用 curl 发真实请求，供手动试跑（--live）使用；返回 mv.fetch 的响应形状。
export function curlFetch({ url, method = 'GET', headers = {}, body = '' }) {
  const args = ['-s', '-S', '-L', '--max-time', '20', '-X', method, '-o', '-', '-w', '\n%{http_code}\n%{url_effective}'];
  for (const [key, value] of Object.entries(headers)) args.push('-H', `${key}: ${value}`);
  if (body) args.push('--data-binary', body);
  args.push(url);
  const result = spawnSync('curl.exe', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(`curl 执行失败：${result.error.message}`);
  if (result.status !== 0) throw new Error(`curl 退出码 ${result.status}：${String(result.stderr || '').trim()}`);
  const text = result.stdout || '';
  const lastBreak = text.lastIndexOf('\n');
  const secondLast = text.lastIndexOf('\n', lastBreak - 1);
  const status = Number(text.slice(secondLast + 1, lastBreak));
  const finalUrl = text.slice(lastBreak + 1).trim();
  return { status, headers: {}, body: text.slice(0, secondLast), url: finalUrl || url };
}

export function loadPlugin(options = {}) {
  const { pluginDir } = options;
  if (!pluginDir) throw new Error('loadPlugin 需要 pluginDir');
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
  const entry = manifest.entry || 'main.js';
  const filename = path.join(pluginDir, entry);
  const code = fs.readFileSync(filename, 'utf8');
  return runPlugin({ ...options, manifest, code, filename });
}

export function runPlugin({
  manifest,
  code,
  config = {},
  service = '',
  storage = {},
  muvyo = {},
  fetch,
  limits = {},
  filename = 'main.js',
} = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('runPlugin 需要 manifest');
  if (typeof code !== 'string') throw new Error('runPlugin 需要入口代码');
  const lim = { ...DEFAULTS, ...limits };

  const state = {
    requests: 0,
    logs: [],
    storage: new Map(Object.entries(cloneJson(storage, 'storage') || {})),
    cache: new Map(),
    cacheOps: 0,
  };

  const assertStorageSize = () => {
    const size = byteLength(Object.fromEntries(state.storage));
    if (size > lim.maxStorageBytes) {
      throw new Error(`mv.storage 超过 ${lim.maxStorageBytes} 字节上限（当前 ${size}）`);
    }
  };

  const storageApi = {
    get(key) {
      const value = state.storage.get(String(key));
      return value === undefined ? null : cloneJson(value, 'mv.storage 的值');
    },
    set(key, value) {
      state.storage.set(String(key), cloneJson(value, 'mv.storage.set 的值'));
      assertStorageSize();
    },
    remove(key) {
      state.storage.delete(String(key));
    },
  };

  const cacheApi = {
    limits: {
      entry_bytes: lim.maxCacheEntryBytes,
      plugin_bytes: lim.maxCacheBytes,
      plugin_entries: lim.maxCacheEntries,
      transfer_bytes: 16 * 1024 * 1024,
      operations: 1024,
      max_ttl_seconds: 604800,
    },
    get(key) {
      const name = String(key);
      const hit = state.cache.get(name);
      if (!hit) return null;
      if (hit.expiresAt <= Date.now()) {
        state.cache.delete(name);
        return null;
      }
      return cloneJson(hit.value, 'mv.cache 的值');
    },
    set(key, value, ttlSeconds) {
      const name = String(key);
      if (!CACHE_KEY.test(name)) throw new Error('mv.cache 的 key 不合规');
      const ttl = Number(ttlSeconds);
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > 604800) throw new Error('mv.cache.set 的 ttl_seconds 需为 1–604800');
      const copy = cloneJson(value, 'mv.cache.set 的值');
      if (byteLength(copy) > lim.maxCacheEntryBytes) throw new Error('mv.cache 单条超过 256 KiB');
      state.cacheOps += 1;
      if (state.cacheOps > 1024) throw new Error('mv.cache 单次调用最多 1024 次操作');
      state.cache.set(name, { value: copy, expiresAt: Date.now() + ttl * 1000 });
      if (state.cache.size > lim.maxCacheEntries) throw new Error('mv.cache 条目数超过上限');
      const total = [...state.cache.values()].reduce((sum, item) => sum + byteLength(item.value), 0);
      if (total > lim.maxCacheBytes) throw new Error('mv.cache 总体积超过上限');
    },
    delete(key) {
      state.cacheOps += 1;
      if (state.cacheOps > 1024) throw new Error('mv.cache 单次调用最多 1024 次操作');
      state.cache.delete(String(key));
    },
  };

  const pushLog = (level, message) => {
    if (state.logs.length >= lim.maxLogs) return;
    state.logs.push({ level, message: String(message).slice(0, lim.maxLogChars) });
  };

  const cryptoApi = {
    sha256: (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'),
    md5: (text) => crypto.createHash('md5').update(String(text), 'utf8').digest('hex'),
    hmacSha256: (key, text) => crypto.createHmac('sha256', String(key)).update(String(text), 'utf8').digest('hex'),
    base64Encode: (text) => Buffer.from(String(text), 'utf8').toString('base64'),
    base64Decode: (text) => Buffer.from(String(text), 'base64').toString('utf8'),
    randomHex: (n) => {
      const size = Number(n);
      if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error('mv.crypto.randomHex 参数需为 1–256');
      return crypto.randomBytes(size).toString('hex');
    },
  };

  const mvFetch = (request) => {
    const req = typeof request === 'string' ? { url: request } : request || {};
    const url = String(req.url || '');
    const method = String(req.method || 'GET').toUpperCase();
    if (!url) throw new Error('mv.fetch 需要 url');
    if (!['GET', 'POST', 'HEAD'].includes(method)) throw new Error('mv.fetch 只支持 GET、POST、HEAD');
    const body = req.body == null ? '' : String(req.body);
    if (Buffer.byteLength(body, 'utf8') > lim.maxBodyBytes) throw new Error('mv.fetch 请求体超过 1 MB');
    if (state.requests >= lim.maxRequests) throw new Error(`单次调用最多 ${lim.maxRequests} 个请求`);
    state.requests += 1;
    if (typeof fetch !== 'function') {
      throw new Error('本地沙箱未配置 fetch 处理器：测试里通过 fetch 选项注入模拟响应，或给 run-plugin 传 --fetch-map');
    }
    const response = fetch({ url, method, headers: { ...(req.headers || {}) }, body }) || {};
    const text = typeof response.body === 'string' ? response.body : response.body == null ? '' : JSON.stringify(response.body);
    if (Buffer.byteLength(text, 'utf8') > lim.maxResponseBytes) throw new Error('mv.fetch 响应超过 4 MB');
    return {
      status: Number(response.status ?? 200),
      headers: lowerHeaders(response.headers),
      body: text,
      url: response.url || url,
    };
  };

  const granted = new Set(muvyo.granted || []);
  const callService = (name, handler, args) => {
    if (!granted.has(name)) throw new Error(`未获授权使用 Muvyo 服务：${name}`);
    if (typeof handler !== 'function') throw new Error(`本地沙箱未配置 ${name} 的模拟响应`);
    return handler(args);
  };

  const mv = {
    fetch: mvFetch,
    config: deepFreeze(cloneJson(config, 'mv.config') || {}),
    service: String(service || ''),
    storage: storageApi,
    cache: cacheApi,
    log: {
      info: (message) => pushLog('info', message),
      warn: (message) => pushLog('warn', message),
      error: (message) => pushLog('error', message),
    },
    crypto: cryptoApi,
    can: (name) => granted.has(String(name)),
    library: { lookup: (args) => callService('library.lookup', muvyo.library?.lookup, args) },
    telegram: { search: (args) => callService('telegram.search', muvyo.telegram?.search, args) },
    share: { inspect: (args) => callService('share.inspect', muvyo.share?.inspect, args) },
  };

  const context = vm.createContext({ mv }, { name: manifest.id || 'muvyo-plugin' });
  const capture = ENTRY_FUNCTIONS.map(
    (name) => `${name}: typeof ${name} === 'function' ? ${name} : undefined`,
  ).join(', ');
  const source = `${code}\n;globalThis.__mv_capture = { ${capture} };\n`;
  vm.runInContext(source, context, { timeout: lim.executionMs, filename: path.basename(filename) });

  const functions = {};
  for (const name of ENTRY_FUNCTIONS) {
    const fn = context.__mv_capture?.[name];
    if (typeof fn === 'function') functions[name] = fn;
  }

  return {
    manifest,
    context,
    functions,
    logs: state.logs,
    requests: () => state.requests,
    storage: () => cloneJson(Object.fromEntries(state.storage), 'storage') || {},
    cache: () => cloneJson(Object.fromEntries(state.cache), 'cache') || {},
    call(name, args = {}) {
      const fn = functions[name];
      if (!fn) throw new Error(`插件没有定义 ${name}()`);
      const result = fn(args);
      assertStorageSize();
      return result;
    },
    runScheduledTask(taskId) {
      return this.call('scheduledTask', { task: taskId });
    },
  };
}
