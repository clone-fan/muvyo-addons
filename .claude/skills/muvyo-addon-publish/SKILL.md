---
name: muvyo-addon-publish
description: 签名并发布 Muvyo 第三方插件：加密签名插件、签名并验证仓库索引，发布 index.json、index.json.sig 与 plugins/ 下的产物，绝不提交源码、签名凭据或私钥。用户说「发布 Muvyo 插件」「签名 Muvyo 插件」「更新 Muvyo 插件版本」时使用，不用于 MoviePilot 插件。
---

# 发布 Muvyo 插件

本仓库是一个 Muvyo 插件仓库：

```
src/<插件ID>/          源码（manifest.json、入口 JS、README.md），不提交
index.json             签名产物，提交
index.json.sig         仓库索引签名，提交
repo-signing.pem       仓库专用私钥，绝不提交
plugins/<插件ID>/      签名产物，提交
muvyo-signing.json     签名凭据（含私钥），绝不提交
mv_addon.py            签名脚本，不提交
```

## 硬性规则

- **绝不**读取、打印、复制、提交 `muvyo-signing.json` 的内容，也不要把它移到别处。只把它的路径交给签名脚本。
- **绝不**上传 `src/`、明文入口 JS 或源码压缩包。源码只留本地或独立私有开发仓库；公开插件仓库只发布加密签名产物。
- **绝不**根据仓库的 LICENSE、GPL/MIT 等许可证名称或已有源码，推断应该公开源码、使用 `--no-encrypt` 或开启 `muvyo.publishSource`。许可义务与加密分发冲突时停止发布，说明冲突，不自行改成明文发布。
- **绝不**用 `git commit --no-verify`、`git push --force`，也不要改 `.gitignore` 或 `.githooks/` 来绕过检查。
- **绝不**手工编辑 `plugins/` 下的文件：它们带签名，改一个字节都会安装失败，只能重新签名生成。
- 推送前先把要推送的提交告诉用户，得到同意再 `git push`。

## 步骤

### 1. 检查环境

```sh
git rev-parse --show-toplevel          # 在插件仓库根目录执行后续命令
test -f muvyo-signing.json && echo 有凭据
test -f mv_addon.py && echo 有脚本
python3 -c "import cryptography" && echo 有 cryptography
git config core.hooksPath              # 应输出 .githooks
```

- 没有凭据：请用户在 Muvyo「第三方插件 → 开发者」用 GitHub 账号领取证书，把下载的 `muvyo-signing.json` 放到仓库根目录。
- 没有脚本：请用户在同一页下载签名脚本 `mv_addon.py` 放到仓库根目录。
- 没有 cryptography：`pip3 install cryptography`。
- hooksPath 不是 `.githooks`：执行 `git config core.hooksPath .githooks` 启用提交检查。
- 检查 `.gitignore` 里有 `src/`、`muvyo-signing.json`、`mv_addon.py`，缺了就补上。用 `git ls-files src/` 检查已跟踪的源码：`.gitignore` 对已跟踪文件无效。若发现源码已入库，停止发布并说明情况，不自动删除本地源码或改写远端历史。

### 2. 确定要发布的插件

- 用户点名的插件；没点名时列出 `src/` 下的插件目录，比较各自 `manifest.json` 的 `version` 与 `index.json` 里的版本，找出新增或版本不同的（`src/` 被 git 忽略，`git status` 看不到源码改动），不确定就问用户。
- 每个插件检查：
  - `src/<插件ID>/manifest.json` 的 `id` 与目录名一致，并以用户的命名空间（GitHub 用户名小写）加 `.` 开头。
  - 源码改了但 `version` 没变大（与 `index.json` 里的比较）：请用户确认新版本号，改 manifest 的 `version`（如 `1.0.0` → `1.0.1`）。版本号不变，已安装的用户收不到更新。

### 3. 签名

必须加密，不使用 `--no-encrypt`。签名后确认产物有 `encrypted.json` 和 `signature.json`，没有明文入口 JS；验签通过不等于代码已加密，两项都要检查。

```sh
python3 mv_addon.py sign ./src/<插件ID> -o .
python3 mv_addon.py verify ./plugins/<插件ID>
```

签名失败按提示处理：
- 「插件 ID 必须以你的命名空间开头」：改 manifest 的 `id`，同时把 `src/` 下的目录名改成一致。
- 「作者证书已过期」「这张证书不支持加密」：请用户在 Muvyo 开发者页重新领取证书，替换 `muvyo-signing.json`。
- 「manifest.json 不是有效的 JSON」「entry 必须是…」：修正源码后重签。

### 4. 签名仓库索引

插件的 `signature.json` 与仓库的 `index.json.sig` 是两层签名，不能互相替代。本模板发布时两层都要完成。所有插件签名、仓库名称及索引内容修改完成后，最后签名索引。

- 首次发布且索引没有 `public_key`：用下面命令创建独立仓库私钥，只执行一次。私钥留本地并安全备份，不读出或展示内容。
- 已有 `public_key`：必须找到原仓库私钥。不要使用重新领取的作者凭据替代，不要换公钥或删除公钥绕过验证；找不到原私钥就停止发布。
- 以下以 `repo-signing.pem` 为例；原私钥在其它安全路径时，给 `--key` 传原路径，不搬动文件。工具支持 Ed25519 PEM；其它格式不要盲目重建密钥。

```sh
# 仅首次初始化；文件已存在或索引已有公钥时会拒绝创建
python3 .claude/skills/muvyo-addon-publish/scripts/sign_index.py init-key --key repo-signing.pem
```

每次发布执行：

```sh
python3 .claude/skills/muvyo-addon-publish/scripts/sign_index.py sign --key repo-signing.pem
python3 .claude/skills/muvyo-addon-publish/scripts/sign_index.py verify
```

工具对最终 `index.json` 原始字节做 Ed25519 签名，将 Base64 签名写入 `index.json.sig` 并验签。签名后再改索引（包括格式化）必须重新签名。保持 `sequence` 单调递增，插件签名脚本会自动加一；只调整索引的发布也要递增后再签。

### 5. 只暂存签名产物

```sh
git add -A index.json index.json.sig plugins/<插件ID>
git status --short
```

确认本次发布暂存的只有 `index.json`、`index.json.sig` 和 `plugins/` 下的加密签名产物；出现源码、明文 JS、签名凭据或私钥就停止发布，说明问题并检查 `.gitignore`，不要擅自改动用户原有暂存内容。不要用 `git add -A` / `git add .`。检查暂存的索引和签名与刚验签的工作区文件一致，避免提交旧索引搭配新签名。首次引入模板工具、更新说明或防护规则时，单独列明这些文件再暂存。

### 6. 提交

```sh
git commit -m "发布 <插件ID> <版本>"
```

提交检查失败时按它的提示修正（通常是暂存了源码或凭据），不要跳过检查。

### 7. 推送

把 `git log --oneline @{u}..` 的结果告诉用户，同意后：

```sh
git push
```

推送后告诉用户：在 Muvyo「第三方插件 → 插件仓库」里刷新这个仓库，已安装的用户会看到「可更新」。
