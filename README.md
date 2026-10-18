# Compositor Windows

**基于 [Robbie Tilton](https://github.com/robbietilton) 的 [Compositor](https://github.com/robbietilton/Compositor) 改写的非官方 Windows 图像编辑器。**

> 原项目由 Robbie Tilton 开发，原始版权属于 **Wonder Assembly LLC**，采用 MIT 许可证。本仓库保留原版源码、Git 历史及版权声明；Windows 客户端是由 [huaixu40](https://github.com/huaixu40) 维护的独立改写，使用 Electron / Canvas 实现。**本项目不是原作者官方发布，也未获得原作者背书。**
>
> An unofficial Windows adaptation of [Compositor by Robbie Tilton](https://github.com/robbietilton/Compositor). The original macOS source and MIT copyright are preserved. The Windows client is a separate Electron/Canvas implementation, not an official release or a feature-complete port.

[下载 Windows 预览版](https://github.com/huaixu40/Compositor-Windows/releases/tag/windows-v0.3.0) · [Windows 详细说明](windows/README-WINDOWS.md) · [原版 README](README.upstream.md) · [许可证](LICENSE)

![Compositor Windows 编辑器预览](docs/windows/preview.png)

## 这是什么

Compositor 原版是基于 SwiftUI、AppKit、CoreGraphics / CoreImage / Metal 的 macOS 图像编辑器，不能直接在 Windows 上编译运行。本仓库保留原版工程，并在 `windows/` 中新增 Windows 客户端，优先实现 **PSD 图层编辑和常用修图工作流**。

当前版本为 **0.3.0 Preview**。它已能在 Windows 上独立启动、打开图片、编辑图层并保存，但还没有完整复现原版或 Photoshop 的全部功能。以下功能与限制描述的是 Windows 版，不应与原版功能列表混用。

## 0.3 新增

- **真正的选区**：矩形、椭圆、套索、多边形套索、魔棒；相加、相减、相交、羽化、反选。绘画、填充和擦除受选区限制，可转蒙版，选区可撤销并保存到项目。
- **鼠标移动**：画布拖动图层；选区内容可浮动移动、提交或取消。图层列表支持拖动排序和移入 / 移出图层组。
- **系统剪贴板**：复制、剪切、粘贴和合并复制；外部软件获取 PNG，应用内整层复制保留属性和蒙版，可粘贴外部截图。
- **右键与工具属性**：画布 / 图层右键菜单，按工具切换的属性栏；每种工具单独保留本次会话的参数。
- **补齐工具**：裁剪、油漆桶、线性 / 径向渐变、抓手、缩放；保留中英文界面、PSD 调整层与软边修画。

## 下载与启动

1. 打开 [Windows v0.3.0 预发布页面](https://github.com/huaixu40/Compositor-Windows/releases/tag/windows-v0.3.0)。
2. 下载 `Compositor-Windows-0.3.0-win-x64.zip`，解压到可写目录。
3. 双击解压目录中的 `Compositor-Windows.exe`。

便携包自带运行时，无需安装 Node.js、Python 或 Xcode，正常编辑不需要联网。**请保留整个解压目录，不要只复制 exe。** 当前提供 Windows x64 构建；已在开发者的 Windows 电脑验证，尚未覆盖不同设备的兼容性测试。预览版未做代码签名。

## 已实现的功能

| 范围 | 当前功能 |
|---|---|
| 文件 | 打开 8-bit RGB PSD、PNG、JPEG、WebP；导出分层 PSD、PNG、JPEG |
| 图层 | 创建图层组、鼠标排序及跨组拖放、复制、删除、重命名、显隐、透明度、常见混合模式 |
| 变换 | 移动、缩放、旋转、水平翻转 |
| 蒙版 | 像素层、图层组与调整图层的栅格蒙版；软边修画、灰度填充、反相、移除及启用/禁用 |
| 修图工具 | 画笔、橡皮、仿制、五类选区、裁剪、油漆桶、渐变、吸管、抓手、缩放 |
| 可回改滤镜 | 曝光/对比度、色阶、RGB 曲线、色相/饱和度、色彩平衡、模糊、锐化、黑白 |
| PSD 调整层 | 创建和编辑色阶、曲线、曝光、反相；RGB 与单通道参数保留 |
| 界面设置 | 简体中文 / English 即时切换，自动保存，下次启动恢复 |
| 工作项目 | `.cwin` 保存图层原始像素、蒙版、变换、可编辑滤镜及选区 |
| 编辑保护 | 撤销/重做、未保存提醒、PSD 转换报告、源文件覆盖保护 |

建议先保存 `.cwin` 工作项目，再导出 PSD 副本。PSD 导出会把本客户端的滤镜和变换烘焙到各个像素图层；原始滤镜参数保留在 `.cwin` 中。

## PSD 兼容性：请先了解

- **支持读写**：普通像素图层、层级、偏移、显隐、透明度、常见混合模式、栅格蒙版。
- **保留参数、近似预览**：PSD 的 Levels、Curves、Exposure、Invert 调整图层，支持创建和编辑参数。色阶和曲线支持 RGB、红、绿、蓝通道；曲线采用输入/输出点编辑与分段线性预览。
- **蒙版浓度与羽化**：导入时烘焙为有效栅格覆盖率，导出保留覆盖像素；不保留其原始滑块参数，羽化为近似预览（半径上限 256 px）。
- **转换为缓存像素**：文字、智能对象、矢量内容，不保留原来的可编辑语义。
- **提示后转换或丢弃**：复杂图层效果、剪贴关系、其他调整图层、Blend If 和部分特殊遮罩/画板。需要保留文件存储的原始观感时，可选择 `Open merged preview` 以单层打开。
- **暂不支持**：CMYK、16/32-bit PSD、PSB、原版 `.comp` 项目、完整 ICC 色彩管理。

本版不会静默承诺完整兼容 Photoshop；已识别的兼容性问题会在导入时展示。**未完成 Adobe Photoshop 实机互操作验收，也不保证与 Photoshop 逐像素一致。** 请保留源文件，并优先用副本验证自己的工作流。

## 暂未移植

原版 GPU 渲染管线、Camera Raw、内容识别修复、自动抠图、可编辑文字、钢笔路径、自由扭曲和完整高级图层效果等尚未实现。大图及多层实时处理可能卡顿。详细容量限制和操作说明见 [Windows 使用说明](windows/README-WINDOWS.md)。

## 从源码运行

需要 Windows x64 和 Node.js 22.12 或更高版本。

```powershell
git clone https://github.com/huaixu40/Compositor-Windows.git
cd Compositor-Windows/windows
npm.cmd ci
npm.cmd start
```

构建和验证：

```powershell
npm.cmd test
npm.cmd run test:interaction
npm.cmd run package
```

- `npm test` 在真实 Electron renderer 中执行测试，结果和界面截图写入 `windows/output/`。
- `npm run package` 生成 `windows/release/Compositor-Windows-0.3.0/` 和 `windows/Start-Compositor.cmd`。
- 打包器拒绝覆盖已有同名发布目录，重新打包前请先归档旧目录。
- 二进制与依赖目录不进入 Git 源码历史，便携包通过 GitHub Releases 提供。

## 验证记录

2026-10-18，0.3.0 源码版和便携 exe 均通过 **21 项回归检查 + 14 组真实交互测试**。交互测试覆盖实际鼠标框选、滚动后的坐标、图层拖放、浮动选区取消、右键、系统剪贴板、工具属性和保存重开。

[验证方法与未验收项](docs/windows/VALIDATION-0.3.md) · [源码回归](docs/windows/validation-source-v0.3.0.json) · [源码交互](docs/windows/interaction-source-v0.3.0.json) · [便携版回归](docs/windows/validation-v0.3.0.json) · [便携版交互](docs/windows/interaction-portable-v0.3.0.json)。中文输入法候选窗完整流程、1080p 30 FPS 和 Photoshop 实机互操作尚未验收；这些检查不构成所有 PSD 文件或完整 Photoshop 兼容保证。

## 目录说明

```text
Compositor/              原版 macOS Swift 源码
Compositor.xcodeproj/    原版 Xcode 工程
CompositorTests/         原版测试
windows/                Windows 客户端、构建脚本和测试样本
docs/windows/           Windows 截图与验证记录
README.upstream.md      基线版本的原版 README
LICENSE                 原作者 MIT 许可证与版权声明
```

原版 macOS 代码和 `.comp` schema 没有因 Windows 实现而修改。原版构建方式请阅读 [原版 README](README.upstream.md)。

## 原作者、致谢与许可证

- **原作者：Robbie Tilton** — [GitHub](https://github.com/robbietilton) · [Compositor 原仓库](https://github.com/robbietilton/Compositor)
- **原始版权：Copyright (c) 2026 Wonder Assembly LLC**。完整 MIT 声明保留于 [LICENSE](LICENSE)，便携包中另附 `COMPOSITOR-LICENSE.txt`。
- **原版基线：** [`365b5745eda537f984f3d5bed1e53c361dbc9c91`](https://github.com/robbietilton/Compositor/commit/365b5745eda537f984f3d5bed1e53c361dbc9c91)。
- **Windows 改写与维护：** [huaixu40](https://github.com/huaixu40)。此改写继续按 MIT 许可证提供，不替代或移除原版权声明。
- **PSD 读写：** [ag-psd](https://github.com/Agamnentzar/ag-psd) 31.0.3（MIT）。公开测试样本的来源与校验值见 [fixtures 说明](windows/test/fixtures/README.md)。
- **桌面运行时：** [Electron](https://github.com/electron/electron) 44.8.0。便携包保留其许可证和 Chromium 第三方许可；其他运行依赖的许可列于 `THIRD-PARTY-NOTICES.txt`。

感谢原作者公开 Compositor 的源码与设计，让 Windows 改写工作有了参考基础。
