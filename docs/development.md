# 开发与发布流程

本仓库是 Muvyo 第三方插件仓库。插件格式、能力接口、沙箱限制与签名发布流程以官方指南为准：
https://github.com/thsrite/muvyo-addon-guide

## 目录

```
src/<插件ID>/            源码（manifest.json、入口 JS、README.md、可选图标/立绘）——不提交
plugins/<插件ID>/        加密签名产物——提交
index.json               插件清单——提交
index.json.sig           仓库索引签名——提交
repo-signing.pem         仓库私钥——绝不提交，自行备份
muvyo-signing.json       作者凭据（含私钥）——绝不提交
mv_addon.py              官方签名脚本——不提交
tools/                   本地开发工具
tests/                   沙箱测试
```

## 开发循环

1. 新建 `src/<插件ID>/`（插件 ID 必须以 `clone-fan.` 开头），写 `manifest.json` 与入口 JS。
2. 校验：`node tools/validate-plugin.mjs src/<插件ID>`
3. 测试：`npm test`（在 `tests/` 下加用例，用 `tools/mv-sandbox.mjs` 加载插件）
4. 手动试跑：

```
node tools/run-plugin.mjs --plugin src/<插件ID> --call search \
  --args '{"keyword":"流浪地球","limit":20}' --fetch-map mock.json
```

`mock.json` 按 `"METHOD url"` 或 `"url"` 匹配模拟响应：

```json
{
  "GET https://api.example.com/search?q=%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "body": "{\"items\":[]}"
  }
}
```

5. 真实环境验证：签名后装到 Muvyo，用「测试运行环境」和实际调用确认。本地沙箱只覆盖逻辑，不覆盖 QuickJS 差异、权限校验和限流。

## 本地沙箱对照的限制

`tools/mv-sandbox.mjs` 按官方文档实现：同步 `mv.fetch`、每次调用最多 30 个请求、请求体 ≤ 1 MB、响应 ≤ 4 MB、`mv.storage` ≤ 64 KB、`mv.cache` 键与 TTL 规则、`mv.crypto`、`mv.log`（最多 200 条、每条 500 字）。

它不模拟：真实网络与域名白名单、`permissions.muvyo` 的授权与配额、执行时限的强制中断（只在脚本加载时用 vm timeout）、QuickJS 与 V8 的引擎差异。

## 签名与发布

首次（已完成）：仓库索引私钥 `repo-signing.pem` 已生成，`index.json` 已带 `public_key` 并签名。私钥丢失后无法用原公钥更新已添加本仓库的 Muvyo，必须安全备份。

发布一个插件：

```
python mv_addon.py sign ./src/<插件ID> -o .        # 加密 + 签名，写 plugins/，更新 index.json
python mv_addon.py verify ./plugins/<插件ID>       # 插件验签
python .claude/skills/muvyo-addon-publish/scripts/sign_index.py sign --key repo-signing.pem
python .claude/skills/muvyo-addon-publish/scripts/sign_index.py verify
git add -A index.json index.json.sig plugins/<插件ID>
git commit -m "发布 <插件ID> <版本>"
git push
```

注意：

- `mv_addon.py sign` 会递增 `index.json` 的 `sequence`；`index.json` 每次改动都必须重新生成 `index.json.sig`，否则已添加本仓库的 Muvyo 会拒绝读取。
- 提交检查（`.githooks/pre-commit`）会拦下 `src/`、明文 JS、凭据、私钥和插件目录里的多余文件；不要绕过它。
- 更新插件：改代码 → 递增 `version` → 重新签名 → 重新签索引 → 提交推送。用户端会看到「可更新」。

## 作者凭据

`muvyo-signing.json` 在 Muvyo「第三方插件 → 开发者」用 GitHub 账号领取（需要 Muvyo 永久授权），放在仓库根目录。私钥只在这一份文件里，丢失后重新领取即可，旧证书签过的插件仍然有效。

## 排查

- 签名报「插件 ID 必须以你的命名空间开头」：改 `manifest.json` 的 `id`，目录名同步改。
- 签名报「这张证书不支持加密」：证书是旧版领取的，去开发者页重新领取。
- 安装报「插件未获准访问 https://xxx」：把域名写进 `manifest.json` 的 `permissions.domains`（`*.example.com` 不含根域名）。
- 插件停用后虚拟库/内容库没有结果：Muvyo 不会自动回退，需要改回内置来源。
