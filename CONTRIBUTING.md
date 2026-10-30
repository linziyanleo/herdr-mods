# 开发约定

## 目录结构

每个 mod 使用一个根目录，目录名采用小写字母和连字符。以下结构供后续新增 mod 时使用。

```text
<mod-name>/
  RECIPE.md
  preview.png
  mods/
    <runtime-name>/
      main.js
      mod.json
```

一个发布目录可以包含多个运行时 mod。按需添加 `layouts/`、`keys.json`、资源文件和单独的许可证。初始化阶段不创建示例 mod 或安装脚本。

`RECIPE.md` 描述用户看到的内容、交互行为、所用 API、外部依赖、限制和验收步骤。预览图使用实际运行截图。引用或修改他人代码时，保留其许可证和署名。

## 本机资料

开发前读取当前安装版本提供的文件。

| 文件 | 用途 |
| --- | --- |
| `~/.config/herdr-app/AGENTS.md` | Herdr 的运行方式、mod 结构和操作命令 |
| `~/.config/herdr-app/herdr.d.ts` | 应用数据、命令和文件访问 API |
| `~/.config/herdr-app/gpui-kit.d.ts` | GPUI 元素、事件和布局 API |

使用自定义 `HERDR_APP_HOME` 时，读取该目录中的对应文件。Herdr 会随版本更新这些文件，仓库不保存副本。

## 实现

- `main.js` 默认导出继承 `View` 的类，在 `render` 中描述原生 GPUI 界面。
- 使用 `herdr` 提供的 `exec` 和 `fetch` 完成外部调用。异步任务放在 `cx.spawn` 中，定时任务使用 `cx.timer`。不要保存 `cx` 供之后的回调使用。
- Herdr 的实时数据变化会触发渲染，无需轮询 spaces、tabs 或 agents。界面颜色优先读取 `theme()`。
- 在 mod 的说明中列出会调用的外部程序、网络服务、凭证和文件路径。

## 安装与验证

先检查应用目录是否存在同名 mod 或 layout。发生冲突时，选择新名称并更新引用。安装只复制该 mod 所需的文件，快捷键逐项合并。

对安装后的每个运行时 mod 执行检查。

```sh
herdr-app check ~/.config/herdr-app/mods/<runtime-name>
```

使用自定义 `HERDR_APP_HOME` 时，替换为实际安装路径。检查通过后，在窗口中验证交互、空状态和错误状态。涉及界面时保存截图。

```sh
herdr-app status
herdr-app shot /tmp/herdr-mod-preview.png
```

`check` 只加载并渲染一次，不能替代交互验证。新增 mod 时，把实际执行的验收步骤写入它的 `RECIPE.md`。

## 分享

需要在 Herdr 社区展示时，再公开仓库并添加 `herdr-mod` 或 `herdr-layout` topic。每个分享目录应包含 `RECIPE.md` 和 `preview.png`。
