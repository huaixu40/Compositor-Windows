# Compositor Windows 0.3 预览版

这是基于 **[Robbie Tilton](https://github.com/robbietilton) 的 [Compositor](https://github.com/robbietilton/Compositor)** 的功能与交互模型改写的 **非官方 Windows 客户端**。原始版权为 **Copyright (c) 2026 Wonder Assembly LLC**，采用 MIT 许可证，原版权声明完整保留。Windows 改写由 [huaixu40](https://github.com/huaixu40) 维护，使用 Electron / Canvas 独立实现，不是原作者官方发布或背书的版本。

原版 Swift/macOS 源码完整保留，新增代码位于 `windows/`。它不是原版全功能移植，也不等同于 Photoshop。[下载本版便携包](https://github.com/huaixu40/Compositor-Windows/releases/tag/windows-v0.3.0)。

## 启动

下载并解压便携包后双击 `Compositor-Windows.exe`。从源码完成打包后，也可以双击 `windows/Start-Compositor.cmd`。便携包自带运行时，正常使用无需安装 Node.js、Python、Xcode 或联网。整个便携目录必须一起保留，不能只移动 exe。

本次构建目标为 Windows x64，已在当前 Windows 电脑运行验证。未在其他电脑、Windows ARM 或 32 位 Windows 上验证。程序未做发行签名。

## 本版新增与设置

右上角“设置 / Settings”中的“界面语言 / Interface language”可选择“简体中文”或“English”。切换即时生效，不需要重启，文档名、图层名及图片文字不会被翻译。首次启动使用系统语言（中文系统默认简体中文，其他系统默认英文）。设置保存在 `%APPDATA%\Compositor-Windows\settings.json`，测试使用独立目录，不会改动正常使用时的偏好。

- 右侧“属性”下方选择色阶、曲线、曝光或反相，点击“添加调整图层”。新层插入所选层上方，与其位于同一组；提交前取消不会添加图层。
- 选中已导入或新建的 PSD 调整层，点击“编辑调整图层”。已有图层实时预览，确认后作为一次可撤销修改，取消恢复原效果。
- 色阶和曲线可分别编辑 RGB、红、绿、蓝通道。曲线输入格式为 `0,0; 128,160; 255,255`（英文逗号和分号），输入值严格递增，数值范围 0–255；不改动其他通道。当前曲线预览采用分段线性插值。
- 画笔 / 橡皮的“硬度”设为 0 可获得软边，100 为硬边。仿制图章仍使用硬边，同层 Alt 点击取样。
- 像素层、图层组和调整图层均可添加并修画蒙版。点击蒙版缩略图后可灰度填充；“反相蒙版”“移除蒙版”均支持撤销。

## 0.3 操作升级

选中矩形或椭圆工具后直接拖动画布。属性栏可选择新建、相加、相减、相交、比例和羽化；拖动时 Shift 临时相加、Alt 相减、Shift+Alt 相交。套索拖动闭合区域，多边形套索逐点点击后双击或 Enter 完成。魔棒按容差选择连续区域或同色像素。

选区限制画笔、橡皮、仿制、填充和渐变；Delete 清除选区内容，Ctrl+Shift+D 反选，属性栏可将选区转为蒙版。选区支持撤销、重做与 `.cwin` 保存恢复；旧项目仍可读取。

移动工具 V 在画布拖动整层，自动选层可关闭。需要移动部分像素时先建立选区，切到移动工具并点击“移动选区内容”，拖动后 Enter 提交或 Esc 恢复。提交生成独立像素层并用蒙版隐藏原位置，每次拖动或提交对应一步撤销。

图层面板直接拖动行：顶部 / 底部亮线表示插入位置，组中间高亮表示移入组。拖到组行的上方或下方可移出；拖到列表底部空白可移至根层级。禁止将组拖入自身或子组，嵌套最多 32 层。右键可重命名、编组、新建组、添加蒙版和合并可见层到新层。

Ctrl+C 复制选区，无选区复制整层；Ctrl+Shift+C 复制合并结果；Ctrl+X 先复制成功再剪切；Ctrl+V 接受应用内内容和外部 PNG / 截图。应用内整层复制保留原始像素、滤镜、蒙版与属性；外部软件接收 PNG。异步剪贴板操作按顺序执行，期间文档改变会取消有风险的剪切 / 粘贴。输入框继续使用文本复制粘贴。

工具栏共 15 种工具，各自保留当前会话的参数。仿制可选择当前层 / 所有可见层取样及对齐；吸管可选择 1×1、3×3、5×5 取样。裁剪拖出范围后 Enter 应用、Esc 取消。渐变支持线性 / 径向，抓手可拖动视图，空格临时切换抓手，缩放工具点击放大、Alt 点击缩小。

| 快捷键 | 操作 |
|---|---|
| V / M / Shift+M | 移动 / 矩形 / 椭圆 |
| L / Shift+L / W | 套索 / 多边形套索 / 魔棒 |
| B / E / S / I | 画笔 / 橡皮 / 仿制 / 吸管 |
| C / G / Shift+G | 裁剪 / 渐变 / 油漆桶 |
| H / 空格 / Z | 抓手 / 临时抓手 / 缩放 |
| Ctrl+A / Ctrl+D / Ctrl+Shift+D | 全选 / 取消选区 / 反选 |

## 已实现

- 打开 8-bit RGB PSD；导入 PNG、JPEG、WebP。
- 分层 PSD 导出，包含合并预览图；PNG 和 JPEG 导出。
- 图层组、图层顺序、复制、删除、命名、显隐、透明度，以及 16 种 Canvas 混合模式。
- 像素图层移动、缩放、旋转、水平翻转；变换前的原始像素保留在项目中。
- 栅格蒙版、黑白及灰度修画、蒙版启用/禁用、反相和移除；支持图层组及调整图层蒙版。
- 15 种工具及独立属性栏，详见上方操作升级。
- 可关闭、删除和重新编辑的逐层滤镜：曝光/对比度、色阶、RGB 曲线、色相/饱和度、色彩平衡、模糊、锐化、黑白。
- 保存 `.cwin` 项目，保留图层、原始像素、滤镜、蒙版、变换和选区。
- 撤销/重做、关闭窗口时的未保存提醒。
- 导入转换报告与原 PSD 合并预览模式；保存为副本，禁止覆盖本次运行打开过的源文件。

## PSD 兼容边界

| 项目 | 当前行为 |
|---|---|
| 普通像素图层、层级、偏移、显隐、透明度 | 读写支持 |
| 常见混合模式与栅格蒙版 | 读写支持；特殊组混合行为可能不同 |
| Levels / Curves / Exposure / Invert 调整图层 | 导入、创建、编辑和导出保留参数；支持 RGB / 单通道编辑，Windows 显示为近似预览 |
| PSD 蒙版浓度 / 羽化 | 导入时近似烘焙为有效覆盖像素；羽化半径上限 256 px，不保留浓度 / 羽化滑块参数 |
| 本客户端的逐层滤镜 | `.cwin` 中保持可编辑；导出 PSD 时烘焙到各层像素 |
| 文字、智能对象、矢量 | 使用 PSD 中的缓存像素；不保留其可编辑语义，导入前提示 |
| 图层效果、剪贴关系、其他调整图层、Blend If、特殊遮罩/画板 | 报告后转换或丢弃；需要保持原始观感时可选择“Open merged preview”作为单层打开 |
| CMYK、16/32-bit、PSB | 明确拒绝打开，需先在原软件中另存 8-bit RGB PSD |
| ICC、色彩精度 | 使用浏览器 sRGB 工作空间；不提供 Photoshop 级色彩管理，不保证逐像素一致 |
| 原版 `.comp` 文件 | 本预览版暂不支持；`.cwin` 是独立格式，没有修改原版 schema |

建议先保存 `.cwin` 工作项目，再导出 PSD 副本。若需要保持复杂 PSD 的原始效果，优先选择合并预览，并保留原文件。

## 操作

- 左上 `Open…` 打开 PSD 或项目；`Add image…` 添加图片图层。
- 点击右侧图层缩略图编辑像素；点击蒙版缩略图编辑蒙版；Shift 点击蒙版切换启用状态。
- 仿制图章：先选像素层，按 `S`，Alt 点击取样，再拖动画笔。属性栏可选择当前层或所有可见层采样。
- 右侧调整按钮添加滤镜；双击已添加滤镜的名称再次编辑。
- `Ctrl+O` 打开，`Ctrl+S` 保存项目，`Ctrl+Shift+S` 导出 PSD。
- `Ctrl+Z` 撤销，`Ctrl+Shift+Z` 重做，`Ctrl+J` 复制图层，`Ctrl+D` 取消选区。
- `V` 移动、`B` 画笔、`E` 橡皮、`S` 仿制、`M` 矩形选区、`I` 吸管。

## 容量与已知限制

单个输入文件最大 256 MB；画布/单张图片最多 8192 px 单边且不超过 1600 万像素；导入文档的累计像素/蒙版预算约 6400 万像素；最多 500 层/32 层嵌套。撤销最多 20 步，按 128 MB 像素预算裁剪历史，单个大快照可能超过此预算。

这是 CPU/Canvas 为主的预览实现，大图或多层实时修图可能卡顿。尚未移植原版的 GPU 管线、Camera Raw、内容识别修复、自动抠图、文字编辑、钢笔路径、自由扭曲、完整高级图层效果与色彩管理。支持新建图层组和跨组拖放。

## 开发与复现

需要 Node.js 22.12 或更高版本。依赖版本由 `package-lock.json` 固定。

```powershell
git clone https://github.com/huaixu40/Compositor-Windows.git
cd Compositor-Windows/windows
npm.cmd ci
npm.cmd start
npm.cmd test
npm.cmd run test:interaction
npm.cmd run package
```

0.3 的验证记录见仓库 `docs/windows/VALIDATION-0.3.md`。`npm test` 启动实际 Electron renderer，运行像素/PSD/项目/工具/IPC 文件读写验证，结果写入 `output/test-results.json`，界面截图写入 `output/editor.png`。测试使用自建语义样本与 ag-psd 公开的两个 PSD 样本。测试通过不代表经过 Adobe Photoshop 的实机互操作验收；当前没有在 Photoshop 中打开导出文件验证。

`npm run package` 生成 `release/Compositor-Windows-0.3.0/`，为防误覆盖会拒绝已有同名发布目录。重新打包前请先自行归档旧目录。

## 来源与许可

- 原作者：Robbie Tilton；原仓库：https://github.com/robbietilton/Compositor
- 原始版权：Copyright (c) 2026 Wonder Assembly LLC；Windows 改写维护：https://github.com/huaixu40
- 基线 commit: `365b5745eda537f984f3d5bed1e53c361dbc9c91`
- 原版 MIT 版权声明保留于仓库 `LICENSE` 和便携版 `COMPOSITOR-LICENSE.txt`。
- PSD 解析与写出：ag-psd 31.0.3（MIT）；桌面运行时：Electron 44.8.0。
- 运行时 `LICENSE`、`LICENSES.chromium.html` 和 `THIRD-PARTY-NOTICES.txt` 随便携包提供。
- Electron 镜像下载文件已与其 npm 包内官方 SHA256 校验值比对一致：`1c9319bab793492715f7668e0be0e6a30bf2a8577275e40035bd33601bf6f573`。

完整原版并不依赖这个 Windows 子目录，macOS 源码与原版项目格式均未修改。
