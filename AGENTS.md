# muvyo-addons 项目规则

Muvyo 第三方插件开发仓库，作者命名空间 `clone-fan`。协作原则与回复格式沿用用户级 AGENTS.md。

## 权威来源

- 官方指南：https://github.com/thsrite/muvyo-addon-guide
- 本地只读镜像：`E:\all in one\codex\.runtime\muvyo-research\muvyo-addon-guide`（docs/、examples/、template/、mv_addon.py）
- 插件格式、能力接口、沙箱限制、签名发布流程一律以官方指南为准；本仓库工具是本地增强，不改变官方契约。

## 仓库结构

- `src/<插件ID>/`：插件源码（`manifest.json`、入口 JS、可选 `README.md`、图标、慕慕立绘）。**git 忽略，只留本地**，不提交、不上传。
- `plugins/<插件ID>/`：加密签名产物（`manifest.json`、`encrypted.json`、`README.md`、`signature.json`），提交。
- `index.json` + `index.json.sig`：插件仓库索引与仓库签名，提交。索引任何字节改动（含格式化）都必须重新签名。
- `muvyo-signing.json`（作者凭据）、`repo-signing.pem`（仓库私钥）、`mv_addon.py`：绝不提交，绝不打印内容。
- `tools/`：本地开发工具；`tests/`：测试；`docs/`：流程文档。

## 常用命令

```
git config core.hooksPath .githooks                      # 已配置；提交检查
node tools/validate-plugin.mjs src/<插件ID>              # manifest 与文件校验
npm test                                                 # 沙箱测试
node tools/run-plugin.mjs --plugin src/<插件ID> --call search --args '{"keyword":"测试"}' --fetch-map mock.json
python mv_addon.py sign ./src/<插件ID> -o .              # 加密签名插件，写 plugins/ 并更新 index.json
python mv_addon.py verify ./plugins/<插件ID>             # 插件验签
python .claude/skills/muvyo-addon-publish/scripts/sign_index.py sign --key repo-signing.pem
python .claude/skills/muvyo-addon-publish/scripts/sign_index.py verify
```

## 硬性规则

- 运行环境是 QuickJS ES2020：没有 Node/浏览器 API，没有 `require`/`import`/`setTimeout`，`mv.fetch` 同步返回。
- 平台限制：单次调用 60 秒（命名 3 秒）、每次调用最多 30 个请求、单请求 20 秒、响应 ≤ 4 MB、内存 64 MB、`mv.storage` ≤ 64 KB、入口文件 ≤ 1 MB。
- 只声明真正需要的域名；能用 `permissions.muvyo` 的只读服务就不要让用户再填账号。不能访问 IP、内网（用户填的服务地址除外）。
- 发布只走加密签名产物：不上传 `src/`、明文 JS、源码压缩包、凭据或私钥；不使用 `--no-encrypt`；不用 `git commit --no-verify`、`git push --force`。
- 已发布文件（含 README、图标）改一个字节都要重新签名，并递增 `version`。
- 移植他人代码必须遵守原许可证与官方内容政策（禁止聚合未经授权的影视资源、绕过站点保护措施）。
- 不修改 Muvyo 线上实例（10.0.0.10）的配置或数据，除非用户明确授权。

## 本地工具边界

`tools/mv-sandbox.mjs` 是开发辅助，不是安全沙箱，也不能替代真实验收：本地绿不等于 Muvyo 绿。最终结论以安装到真实 Muvyo 后的运行为准。
