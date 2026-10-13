#!/usr/bin/env node
// 按官方 manifest / capabilities 文档校验插件源码，签名前先拦下常见错误。
// 用法：node tools/validate-plugin.mjs [插件目录或 src 目录 ...]（默认 src）
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const TOP_LEVEL = new Set([
  'api', 'id', 'name', 'version', 'author', 'description', 'entry', 'icon',
  'permissions', 'config', 'settings', 'capabilities', 'release_notes', 'min_mv_version',
]);
const CONFIG_TYPES = new Set(['text', 'secret', 'select', 'multiselect', 'bool', 'number', 'textarea', 'url']);
const LINK_TYPES = new Set(['115', '123pan', 'baidupan', 'guangyapan', 'aliyundrive', 'magnet']);
const MUVYO_SERVICES = new Set(['library.lookup', 'telegram.search', 'share.inspect']);
const WEBHOOK_EVENTS = new Set([
  'media.uploaded', 'media.upload_failed', 'media.upload_skipped',
  'strm.generated', 'strm.failed', 'library.sync_completed', 'library.sync_failed',
  'organize.completed', 'organize.failed', 'subscription.completed', 'subscription.failed',
  'download.completed', 'download.failed', 'backup.completed', 'backup.failed', 'webhook.received',
]);
const MASCOT_FRAMES = new Set([
  'idle', 'idle_blink', 'idle_talk', 'look_left', 'look_upleft', 'look_right',
  'waveA', 'waveB', 'point_left', 'popcorn', 'thumbs', 'jump', 'crouch', 'sitsmile',
]);
const CAPABILITIES = new Set(['search', 'vlib', 'content', 'metadata', 'naming', 'webhook', 'mascot', 'tasks']);
const PUBLIC_SUFFIXES = new Set([
  'github.io', 'workers.dev', 'co.uk', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'pages.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'blogspot.com', 'appspot.com',
  'cloudfront.net', 'glitch.me', 'web.app', 'firebaseapp.com', 'onrender.com', 'fly.dev', 'deno.dev',
]);
const ICON_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}\.(png|jpg|jpeg|webp)$/;
const MASCOT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}\.(png|webp)$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const textLength = (value) => [...String(value)].length;

function checkConfigItem(item, where, errors, warnings) {
  if (!isPlainObject(item)) {
    errors.push(`${where} 必须是对象`);
    return;
  }
  const { key, label, type = 'text' } = item;
  if (!isString(key) || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) {
    errors.push(`${where} 的 key 需字母开头、字母数字下划线、≤40 字符`);
  }
  if (!isString(label) || textLength(label) < 1 || textLength(label) > 40) {
    errors.push(`${where}（${key || '?'}）的 label 需 1–40 字`);
  }
  if (!CONFIG_TYPES.has(type)) errors.push(`${where}（${key || '?'}）的 type 不支持：${type}`);
  if (item.required !== undefined && typeof item.required !== 'boolean') {
    errors.push(`${where}（${key || '?'}）的 required 必须是布尔值`);
  }
  if (item.default !== undefined && (!isString(item.default) || textLength(item.default) > 500)) {
    errors.push(`${where}（${key || '?'}）的 default 必须是 ≤500 字的字符串`);
  }
  if (item.help !== undefined && (!isString(item.help) || textLength(item.help) > 300)) {
    errors.push(`${where}（${key || '?'}）的 help 需 ≤300 字`);
  }
  if (item.placeholder !== undefined && (!isString(item.placeholder) || textLength(item.placeholder) > 100)) {
    errors.push(`${where}（${key || '?'}）的 placeholder 需 ≤100 字`);
  }
  if (item.unit !== undefined && (!isString(item.unit) || textLength(item.unit) > 10)) {
    errors.push(`${where}（${key || '?'}）的 unit 需 ≤10 字`);
  }
  if (type === 'select' || type === 'multiselect') {
    if (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > 50) {
      errors.push(`${where}（${key || '?'}）的 ${type} 需要 1–50 项 options`);
    } else {
      for (const option of item.options) {
        if (!isPlainObject(option) || !isString(option.value) || !isString(option.label)) {
          errors.push(`${where}（${key || '?'}）的 options 每项需要 value 与 label`);
        }
      }
    }
  } else if (item.options !== undefined) {
    warnings.push(`${where}（${key || '?'}）不是 select/multiselect，options 会被忽略`);
  }
  if (type === 'number') {
    for (const field of ['min', 'max', 'step']) {
      if (item[field] !== undefined && typeof item[field] !== 'number') {
        errors.push(`${where}（${key || '?'}）的 ${field} 必须是数字`);
      }
    }
  }
}

function checkDomain(domain, errors) {
  if (!isString(domain) || domain.length === 0) {
    errors.push('permissions.domains 里必须是字符串');
    return;
  }
  const value = domain.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}/.test(value)) errors.push(`域名不能是 IP：${value}`);
  if (/[\\/]$/.test(value) || value.includes('://') && !/^https?:\/\//.test(value)) {
    errors.push(`域名格式不对：${value}`);
  }
  const host = value.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
  if (!/^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(host)) {
    errors.push(`域名格式不对：${value}`);
    return;
  }
  if (host.startsWith('*.')) {
    const rest = host.slice(2);
    const labels = rest.split('.');
    if (labels.length < 3) errors.push(`通配域名至少要三级（*.example.com）：${value}`);
    const suffix = labels.slice(-2).join('.');
    if (PUBLIC_SUFFIXES.has(suffix)) errors.push(`不能对公共后缀用通配：${value}`);
  }
}

export function validateManifest(manifest, { namespace = 'clone-fan' } = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(manifest)) return { errors: ['manifest.json 必须是 JSON 对象'], warnings };

  for (const key of Object.keys(manifest)) {
    if (!TOP_LEVEL.has(key)) errors.push(`未知顶层字段：${key}（会被 Muvyo 拒绝安装）`);
  }
  if (manifest.api !== 1) errors.push(`api 必须是 1（当前 ${JSON.stringify(manifest.api)}）`);

  const id = manifest.id;
  if (!isString(id) || !/^[a-z0-9.-]{4,64}$/.test(id) || id.startsWith('.') || id.endsWith('.') || id.includes('..')) {
    errors.push('id 需 4–64 位小写字母、数字、点、短横线，且不能以点开头/结尾或含连续点');
  } else if (!id.startsWith(`${namespace}.`)) {
    errors.push(`id 必须以命名空间「${namespace}.」开头（当前 ${id}）`);
  }

  if (!isString(manifest.name) || textLength(manifest.name) < 1 || textLength(manifest.name) > 40) {
    errors.push('name 需 1–40 字');
  }
  if (!isString(manifest.version) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    errors.push('version 需形如 1.2.3');
  }
  if (manifest.author !== undefined && (!isString(manifest.author) || textLength(manifest.author) > 60)) {
    errors.push('author 需 ≤60 字');
  }
  if (manifest.description !== undefined && (!isString(manifest.description) || textLength(manifest.description) > 500)) {
    errors.push('description 需 ≤500 字');
  }
  if (manifest.entry !== undefined && (!isString(manifest.entry) || !/^[A-Za-z0-9_-]+\.js$/.test(manifest.entry))) {
    errors.push('entry 需是插件目录下的一个 JS 文件名（xxx.js）');
  }
  if (manifest.icon !== undefined && (!isString(manifest.icon) || !ICON_NAME.test(manifest.icon))) {
    errors.push('icon 需是插件目录内的 PNG/JPEG/WebP 文件名');
  }
  if (manifest.release_notes !== undefined && (!isString(manifest.release_notes) || textLength(manifest.release_notes) > 5000)) {
    errors.push('release_notes 需 ≤5000 字');
  }
  if (manifest.min_mv_version !== undefined
    && (!isString(manifest.min_mv_version) || !/^\d+\.\d+\.\d+$/.test(manifest.min_mv_version))) {
    errors.push('min_mv_version 需形如 3.9.0');
  }

  const permissions = manifest.permissions;
  if (permissions !== undefined) {
    if (!isPlainObject(permissions)) {
      errors.push('permissions 必须是对象');
    } else {
      for (const key of Object.keys(permissions)) {
        if (!['domains', 'service', 'muvyo'].includes(key)) errors.push(`permissions 未知字段：${key}`);
      }
      if (permissions.domains !== undefined) {
        if (!Array.isArray(permissions.domains) || permissions.domains.length > 30) {
          errors.push('permissions.domains 需是 ≤30 条的数组');
        } else {
          permissions.domains.forEach((domain) => checkDomain(domain, errors));
        }
      }
      if (permissions.service !== undefined) {
        if (!isPlainObject(permissions.service) || !isString(permissions.service.label)) {
          errors.push('permissions.service 需要 label（可带 help）');
        }
      }
      if (permissions.muvyo !== undefined) {
        if (!Array.isArray(permissions.muvyo) || permissions.muvyo.length > 3) {
          errors.push('permissions.muvyo 最多 3 项');
        } else {
          const seen = new Set();
          for (const name of permissions.muvyo) {
            if (!MUVYO_SERVICES.has(name)) errors.push(`permissions.muvyo 不支持的服务：${name}`);
            if (seen.has(name)) errors.push(`permissions.muvyo 重复项：${name}`);
            seen.add(name);
          }
        }
      }
    }
  }

  const configKeys = new Set();
  if (manifest.config !== undefined) {
    if (!Array.isArray(manifest.config) || manifest.config.length > 30) {
      errors.push('config 需是 ≤30 项的数组');
    } else {
      manifest.config.forEach((item, index) => {
        checkConfigItem(item, `config[${index}]`, errors, warnings);
        if (isPlainObject(item) && isString(item.key)) {
          if (configKeys.has(item.key)) errors.push(`config 的 key 重复：${item.key}`);
          configKeys.add(item.key);
        }
      });
    }
  }

  if (manifest.settings !== undefined) {
    const settings = manifest.settings;
    if (!isPlainObject(settings)) {
      errors.push('settings 必须是对象');
    } else {
      if (settings.description !== undefined && (!isString(settings.description) || textLength(settings.description) > 1500)) {
        errors.push('settings.description 需 ≤1500 字');
      }
      if (settings.links !== undefined) {
        if (!Array.isArray(settings.links) || settings.links.length > 5) {
          errors.push('settings.links 最多 5 条');
        } else {
          for (const link of settings.links) {
            if (!isPlainObject(link) || !isString(link.title) || !isString(link.url) || !link.url.startsWith('https://')) {
              errors.push('settings.links 每项需要 title 与 https 地址');
            }
          }
        }
      }
      if (settings.sections !== undefined) {
        if (!Array.isArray(settings.sections) || settings.sections.length > 10) {
          errors.push('settings.sections 最多 10 组');
        } else {
          const used = new Set();
          for (const section of settings.sections) {
            if (!isPlainObject(section) || !isString(section.title) || !Array.isArray(section.fields)) {
              errors.push('settings.sections 每项需要 title 与 fields 数组');
              continue;
            }
            for (const field of section.fields) {
              if (!configKeys.has(field)) errors.push(`settings.sections 引用了不存在的配置项：${field}`);
              if (used.has(field)) errors.push(`配置项被放进多个分组：${field}`);
              used.add(field);
            }
          }
        }
      }
    }
  }

  const capabilities = manifest.capabilities;
  if (!isPlainObject(capabilities)) {
    errors.push('capabilities 必须声明至少一种能力');
  } else {
    const declared = Object.keys(capabilities);
    if (declared.length === 0) errors.push('capabilities 必须声明至少一种能力');
    for (const key of declared) {
      if (!CAPABILITIES.has(key)) errors.push(`capabilities 未知能力：${key}`);
    }
    const search = capabilities.search;
    if (search !== undefined) {
      if (!isPlainObject(search)) {
        errors.push('capabilities.search 必须是对象');
      } else {
        if (!Array.isArray(search.link_types) || search.link_types.length === 0
          || search.link_types.some((type) => !LINK_TYPES.has(type))) {
          errors.push(`capabilities.search.link_types 需是 ${[...LINK_TYPES].join('/')} 的非空数组`);
        }
        if (search.resolve === true && search.resolve_cost !== undefined
          && !['none', 'points'].includes(search.resolve_cost)) {
          errors.push('capabilities.search.resolve_cost 只能是 none 或 points');
        }
      }
    }
    const vlib = capabilities.vlib;
    if (vlib !== undefined) {
      if (!isPlainObject(vlib) || !Array.isArray(vlib.lists) || vlib.lists.length < 1 || vlib.lists.length > 30) {
        errors.push('capabilities.vlib 需要 1–30 个 lists');
      } else {
        const keys = new Set();
        for (const list of vlib.lists) {
          if (!isPlainObject(list) || !isString(list.key) || !/^[a-z][a-z0-9_]*$/.test(list.key)) {
            errors.push('vlib 片单 key 需字母开头，只含小写字母、数字、下划线');
            continue;
          }
          if (keys.has(list.key)) errors.push(`vlib 片单 key 重复：${list.key}`);
          keys.add(list.key);
          if (!isString(list.name)) errors.push(`vlib 片单 ${list.key} 缺少 name`);
          if (list.media_type !== undefined && !['movie', 'tv', 'mixed'].includes(list.media_type)) {
            errors.push(`vlib 片单 ${list.key} 的 media_type 只能是 movie/tv/mixed`);
          }
          if (list.params !== undefined) {
            if (!Array.isArray(list.params) || list.params.length > 10) {
              errors.push(`vlib 片单 ${list.key} 的 params 最多 10 个`);
            } else {
              list.params.forEach((param, index) => checkConfigItem(param, `vlib 片单 ${list.key} params[${index}]`, errors, warnings));
            }
          }
        }
      }
    }
    const content = capabilities.content;
    if (content !== undefined) {
      if (!isPlainObject(content)) errors.push('capabilities.content 必须是对象');
      else {
        for (const key of Object.keys(content)) {
          if (!['categories', 'search'].includes(key)) errors.push(`capabilities.content 未知字段：${key}`);
          else if (typeof content[key] !== 'boolean') errors.push(`capabilities.content.${key} 必须是布尔值`);
        }
      }
    }
    for (const key of ['metadata', 'naming']) {
      const value = capabilities[key];
      if (value === undefined) continue;
      if (!isPlainObject(value) || !Array.isArray(value.media_types)
        || value.media_types.length === 0 || value.media_types.some((type) => !['movie', 'tv'].includes(type))) {
        errors.push(`capabilities.${key}.media_types 需是 movie/tv 的非空数组`);
      }
    }
    const webhook = capabilities.webhook;
    if (webhook !== undefined) {
      if (!isPlainObject(webhook) || !Array.isArray(webhook.events) || webhook.events.length === 0) {
        errors.push('capabilities.webhook 需要非空 events 数组');
      } else {
        const seen = new Set();
        for (const event of webhook.events) {
          if (!WEBHOOK_EVENTS.has(event)) errors.push(`capabilities.webhook 不支持的事件：${event}`);
          if (seen.has(event)) errors.push(`capabilities.webhook 事件重复：${event}`);
          seen.add(event);
        }
      }
    }
    const mascot = capabilities.mascot;
    if (mascot !== undefined) {
      if (!isPlainObject(mascot)) {
        errors.push('capabilities.mascot 必须是对象');
      } else {
        if (mascot.name === undefined && mascot.frames === undefined) {
          errors.push('capabilities.mascot 至少要给 name 或 frames');
        }
        if (mascot.name !== undefined
          && (!isString(mascot.name) || !/^[\p{L}\p{N}_·\- ]{1,12}$/u.test(mascot.name) || mascot.name.includes('_'))) {
          errors.push('慕慕名字最多 12 字，只能用汉字、字母、数字、空格、间隔号与短横线');
        }
        if (mascot.frames !== undefined) {
          if (!isPlainObject(mascot.frames) || mascot.frames.idle === undefined) {
            errors.push('capabilities.mascot.frames 必须包含待机帧 idle');
          } else {
            const files = new Set();
            for (const [action, file] of Object.entries(mascot.frames)) {
              if (!MASCOT_FRAMES.has(action)) errors.push(`不支持的慕慕动作：${action}`);
              if (!isString(file) || !MASCOT_NAME.test(file)) {
                errors.push(`慕慕立绘 ${action} 需是插件目录内的 PNG/WebP 文件名`);
              } else if (files.has(file)) {
                errors.push(`慕慕立绘每个动作要用不同文件：${file}`);
              } else {
                files.add(file);
              }
            }
          }
        }
      }
    }
    const tasks = capabilities.tasks;
    if (tasks !== undefined) {
      if (!Array.isArray(tasks) || tasks.length > 8) {
        errors.push('capabilities.tasks 最多 8 个任务');
      } else {
        const ids = new Set();
        for (const task of tasks) {
          if (!isPlainObject(task) || !isString(task.id) || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(task.id)) {
            errors.push('capabilities.tasks 的 id 需字母开头、字母数字下划线、≤40 字符');
            continue;
          }
          if (ids.has(task.id)) errors.push(`capabilities.tasks 任务 id 重复：${task.id}`);
          ids.add(task.id);
          if (!isString(task.title)) errors.push(`capabilities.tasks 任务 ${task.id} 缺少 title`);
          if (task.interval_minutes !== undefined
            && (typeof task.interval_minutes !== 'number' || task.interval_minutes < 5 || task.interval_minutes > 10080)) {
            errors.push(`capabilities.tasks 任务 ${task.id} 的 interval_minutes 需 5–10080`);
          }
        }
      }
    }
  }

  return { errors, warnings };
}

export function validatePluginDir(pluginDir, options = {}) {
  const errors = [];
  const warnings = [];
  const manifestPath = path.join(pluginDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { errors: [`找不到 ${manifestPath}`], warnings };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { errors: [`manifest.json 不是有效 JSON：${error.message}`], warnings };
  }
  const result = validateManifest(manifest, options);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  const entry = isString(manifest.entry) ? manifest.entry : 'main.js';
  if (!fs.existsSync(path.join(pluginDir, entry))) errors.push(`入口文件不存在：${entry}`);
  if (isString(manifest.icon)) {
    const iconPath = path.join(pluginDir, manifest.icon);
    if (!fs.existsSync(iconPath)) {
      errors.push(`图标文件不存在：${manifest.icon}`);
    } else if (fs.statSync(iconPath).size > 256 * 1024) {
      errors.push(`图标超过 256 KB：${manifest.icon}`);
    }
  }
  const frames = manifest.capabilities?.mascot?.frames;
  if (isPlainObject(frames)) {
    let total = 0;
    for (const file of Object.values(frames)) {
      if (!isString(file)) continue;
      const framePath = path.join(pluginDir, file);
      if (!fs.existsSync(framePath)) {
        errors.push(`慕慕立绘文件不存在：${file}`);
        continue;
      }
      const size = fs.statSync(framePath).size;
      total += size;
      if (size > 512 * 1024) errors.push(`慕慕立绘超过 512 KB：${file}`);
    }
    if (total > 8 * 1024 * 1024) errors.push('整个插件包不能超过 8 MB');
  }
  return { errors, warnings };
}

function collectPluginDirs(targets) {
  const dirs = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    if (fs.existsSync(path.join(target, 'manifest.json'))) {
      dirs.push(target);
      continue;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(target, entry.name);
      if (fs.existsSync(path.join(dir, 'manifest.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

function main() {
  const argv = process.argv.slice(2);
  let namespace = 'clone-fan';
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--namespace') {
      namespace = argv[index + 1] || namespace;
      index += 1;
      continue;
    }
    if (token.startsWith('--')) continue;
    args.push(token);
  }
  const targets = args.length > 0 ? args : ['src'];
  const dirs = collectPluginDirs(targets);
  if (dirs.length === 0) {
    console.log(`没有找到插件源码目录（${targets.join('、')} 下没有含 manifest.json 的目录）`);
    return;
  }
  let failed = 0;
  for (const dir of dirs) {
    const { errors, warnings } = validatePluginDir(dir, { namespace });
    for (const warning of warnings) console.warn(`警告 ${dir}：${warning}`);
    if (errors.length === 0) {
      console.log(`通过 ${dir}`);
      continue;
    }
    failed += 1;
    for (const error of errors) console.error(`错误 ${dir}：${error}`);
  }
  if (failed > 0) {
    console.error(`\n${failed} 个插件未通过校验`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
