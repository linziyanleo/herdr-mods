# Herdr mods

这是多个 Herdr mod 的汇总仓库。每个 mod 使用独立的根目录，结构见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发前

- 读取 `~/.config/herdr-app/AGENTS.md`，再按需要查阅同目录下的 `herdr.d.ts` 和 `gpui-kit.d.ts`。使用自定义 `HERDR_APP_HOME` 时，读取对应目录中的文件。
- Herdr 使用原生 GPUI JavaScript，运行环境没有 DOM、Node.js API 或 `setTimeout`。
- Herdr 每次启动会重写自带的文档、类型定义、mods 和 layouts。修改自带 mod 或 layout 前，先用 `mod.clone` 或 `layout.clone` 创建副本。

## 修改与验证

- 在仓库中维护源码。安装时只复制目标 mod 所需的文件，先检查目标目录是否重名。
- 合并快捷键时保留已有绑定。安装和切换布局需属于用户授权范围。
- 修改 mod 后运行 `herdr-app check <mod folder>`。涉及界面时，再查看实际窗口和 `herdr-app shot` 截图。
- API 使用方式和验证步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。凭证规则见 [docs/credentials.md](docs/credentials.md)。
