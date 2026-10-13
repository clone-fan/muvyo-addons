#!/usr/bin/env node
// 本地运行插件入口函数，便于手动试跑。
// 用法：
//   node tools/run-plugin.mjs --plugin src/clone-fan.x --call search --args '{"keyword":"测试"}' --fetch-map mock.json
//   node tools/run-plugin.mjs --plugin src/clone-fan.x --call scheduledTask --args '{"task":"refresh"}' --live
import fs from 'node:fs';
import process from 'node:process';
import { curlFetch, loadPlugin } from './mv-sandbox.mjs';

function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error('用法：node tools/run-plugin.mjs --plugin <目录> --call <函数> [--args <JSON|@文件>] [--config <JSON|@文件>] [--fetch-map <文件>] [--service <地址>] [--live]');
  process.exit(1);
}

function readJson(value, label) {
  if (value === undefined) return undefined;
  const text = value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value;
  try {
    return JSON.parse(text);
  } catch (error) {
    usage(`${label} 不是有效 JSON：${error.message}`);
    return undefined;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) usage(`无法识别的参数 ${token}`);
    const key = token.slice(2);
    if (key === 'live') {
      options.live = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) usage(`参数 ${token} 缺少值`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function makeFetchFromMap(mapPath) {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const keys = Object.keys(map);
  return ({ url, method }) => {
    const hit = map[`${method} ${url}`] ?? map[url];
    if (hit === undefined) {
      throw new Error(`mock 里没有匹配的响应：${method} ${url}\n已配置：\n  ${keys.join('\n  ')}`);
    }
    return hit;
  };
}

const options = parseArgs(process.argv.slice(2));
if (!options.plugin) usage('缺少 --plugin');
if (!options.call) usage('缺少 --call');

const fetchHandler = options.live
  ? curlFetch
  : options['fetch-map']
    ? makeFetchFromMap(options['fetch-map'])
    : undefined;

const plugin = loadPlugin({
  pluginDir: options.plugin,
  config: readJson(options.config, '--config') || {},
  service: options.service || '',
  fetch: fetchHandler,
});

const args = readJson(options.args, '--args') || {};
const result = await plugin.call(options.call, args);

for (const entry of plugin.logs) console.error(`[${entry.level}] ${entry.message}`);
console.error(`请求数：${plugin.requests()}；storage：${JSON.stringify(plugin.storage())}`);
console.log(JSON.stringify(result, null, 2));
