# clone-fan 的 Muvyo 插件仓库

Muvyo 第三方插件仓库。在 Muvyo「设置中心 → 插件 → 第三方插件 → 插件仓库」添加本仓库地址即可安装：

```
https://github.com/clone-fan/muvyo-addons
```

## 插件

| 插件 | 能力 | 状态 |
|---|---|---|
| （待发布） | | |

## 说明

- 本仓库只发布加密并签名后的插件产物（`index.json`、`index.json.sig`、`plugins/`），源码不在仓库里。
- 每个插件都带作者签名，Muvyo 安装时逐个文件核对；仓库索引另有独立签名，首次添加后锁定。
- 插件在 Muvyo 的隔离沙箱里运行，只能访问安装时管理员确认过的域名。

## 开发

开发、测试与发布流程见 [docs/development.md](docs/development.md)。插件格式与能力接口以官方指南为准：

https://github.com/thsrite/muvyo-addon-guide
