import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugin, runPlugin } from '../tools/mv-sandbox.mjs';
import { validateManifest, validatePluginDir } from '../tools/validate-plugin.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'hello');

const RESPONSE = {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: [
      { id: 'a1', title: '示例 4K', link: 'https://115cdn.com/s/xxxx', code: 'ab12' },
      { id: 'a2', title: '示例 1080p', link: 'https://115cdn.com/s/yyyy' },
    ],
  }),
};

test('沙箱按 mock 响应返回搜索结果，并记录 storage 与日志', async () => {
  const plugin = loadPlugin({ pluginDir: fixture, config: { size: 1 }, fetch: () => RESPONSE });
  const result = await plugin.call('search', { keyword: '示例', limit: 50 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].link_type, '115');
  assert.equal(result.items[0].share_code, 'ab12');
  assert.equal(plugin.requests(), 1);
  assert.equal(plugin.storage().calls, 1);
  assert.equal(plugin.logs.length, 1);
});

test('沙箱不提供 Node 与浏览器 API，mv.fetch 同步返回', () => {
  const plugin = loadPlugin({ pluginDir: fixture, fetch: () => RESPONSE });
  assert.equal(typeof plugin.context.require, 'undefined');
  assert.equal(typeof plugin.context.process, 'undefined');
  assert.equal(typeof plugin.context.setTimeout, 'undefined');
  assert.equal(typeof plugin.context.fetch, 'undefined');
  assert.equal(typeof plugin.functions.search, 'function');
});

test('单次调用超过 30 个请求会失败', () => {
  const plugin = runPlugin({
    manifest: { id: 'clone-fan.loop', version: '1.0.0', entry: 'main.js' },
    code: 'function search() { for (let i = 0; i < 31; i += 1) mv.fetch("https://api.example.com/x"); return { items: [] }; }',
    fetch: () => RESPONSE,
  });
  assert.throws(() => plugin.call('search', {}), /最多 30 个请求/);
});

test('mv.storage 超过 64 KB 会失败', () => {
  const plugin = runPlugin({
    manifest: { id: 'clone-fan.big', version: '1.0.0', entry: 'main.js' },
    code: 'function search() { mv.storage.set("blob", "x".repeat(70000)); return { items: [] }; }',
  });
  assert.throws(() => plugin.call('search', {}), /mv\.storage 超过/);
});

test('调用失败时 mv.storage 与 mv.cache 的改动不提交', () => {
  const plugin = runPlugin({
    manifest: { id: 'clone-fan.rollback', version: '1.0.0', entry: 'main.js' },
    code: [
      'function search() {',
      '  mv.storage.set("calls", 99);',
      '  mv.cache.set("page", { items: [] }, 600);',
      '  throw new Error("业务失败");',
      '}',
    ].join('\n'),
    storage: { calls: 1 },
  });
  assert.throws(() => plugin.call('search', {}), /业务失败/);
  assert.deepEqual(plugin.storage(), { calls: 1 });
  assert.deepEqual(plugin.cache(), {});
});

test('mv.log 超过 200 条会终止调用', () => {
  const plugin = runPlugin({
    manifest: { id: 'clone-fan.logs', version: '1.0.0', entry: 'main.js' },
    code: 'function search() { for (let i = 0; i < 201; i += 1) mv.log.info("第 " + i + " 条"); return { items: [] }; }',
  });
  assert.throws(() => plugin.call('search', {}), /mv\.log 单次调用最多 200 条/);
});

test('mv.render 未实现时给出明确提示', () => {
  const plugin = runPlugin({
    manifest: { id: 'clone-fan.naming', version: '1.0.0', entry: 'main.js' },
    code: 'function naming(c) { return { rendered: mv.render(c.template, {}) }; }',
  });
  assert.throws(() => plugin.call('naming', { template: '{{title}}{{fileExt}}' }), /本地沙箱未实现 mv\.render/);
});

test('manifest 校验器通过样例、拦下常见错误', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'));
  assert.deepEqual(validateManifest(manifest), { errors: [], warnings: [] });

  const bad = {
    ...manifest,
    id: 'someone.hello',
    version: '1.0',
    permissions: { domains: ['127.0.0.1', '*.github.io'] },
    capabilities: { search: { link_types: ['ftp'] } },
    extra: true,
  };
  const { errors } = validateManifest(bad);
  assert.ok(errors.some((message) => message.includes('命名空间')));
  assert.ok(errors.some((message) => message.includes('version')));
  assert.ok(errors.some((message) => message.includes('IP')));
  assert.ok(errors.some((message) => message.includes('公共后缀')));
  assert.ok(errors.some((message) => message.includes('link_types')));
  assert.ok(errors.some((message) => message.includes('未知顶层字段')));
});

test('插件目录校验通过样例', () => {
  assert.deepEqual(validatePluginDir(fixture), { errors: [], warnings: [] });
});
