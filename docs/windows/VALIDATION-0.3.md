# 0.3 验证记录

记录日期：2026-10-18。非官方 Windows 改写；原作者 Robbie Tilton / Wonder Assembly LLC，MIT 署名保留。

## 方法

- 回归套件在实际 Electron renderer 中检查 PSD 像素、参数、蒙版、旧项目、撤销、设置和真实文件 IPC。
- 交互套件使用 Playwright 驱动实际 Electron 窗口的鼠标、键盘、滚轮和 HTML 拖放。文档初始化与断言读取可调用测试接口；选区和编辑操作通过界面完成。首项检查指针事件 `isTrusted=true`。
- 系统剪贴板使用 Electron 原生 ClipboardItem API，检查 PNG 尺寸、内部属性保留、连续复制粘贴以及只有 PNG 的外部内容路径。测试先读取并保留可枚举的原剪贴板内容，结束后恢复。
- 保存重开通过实际 Ctrl+S / Ctrl+O 和文件 IPC；测试仅替换文件选择对话框的目标路径。

## 检查范围

矩形反向拖动及越界；椭圆、相加、相减、相交、羽化和反选；选区限制画笔 / 橡皮 / 填充；选区转蒙版及保存恢复；缩放和滚轮滚动后的坐标；系统复制、剪切、粘贴；移动整层及浮动选区提交 / 取消；图层跨组拖放、循环嵌套禁止及组蒙版移动；画布 / 图层右键；工具参数分别保留；套索、多边形、魔棒、油漆桶、渐变、裁剪、仿制取样和吸管；文本框中文输入及文本快捷键不触发画布命令。

## 结果与复现

源码与便携 exe 均通过 21 项回归检查和 14 组真实交互测试，rendererErrors 为空。分别见本目录 `validation-source-v0.3.0.json`、`validation-v0.3.0.json`、`interaction-source-v0.3.0.json`、`interaction-portable-v0.3.0.json`。可运行：

```powershell
cd windows
npm.cmd ci
npm.cmd test
npm.cmd run test:interaction
```

交互 trace 和截图保存在本机 `windows/output/interaction/`，不包含用户图片。便携包用同一套交互脚本和 `COMPOSITOR_EXE` 指向打包 exe 复验。

## 尚未验收的项目

- 中文测试验证实际文本框插入和快捷键保留，没有模拟 Windows 中文输入法候选窗的完整选词过程，输入法候选窗实机验收仍待完成。
- 未完成 Adobe Photoshop 实机互操作验收；自动 PSD 往返不等于 Photoshop 全兼容。
- 0.3 仍为 Canvas 渲染。1080p 稳定 30 FPS、GPU 对照与失效恢复属于 0.4 验收，此处不宣称达到。
- RAW、内容识别、自动抠图、文字、路径、自由扭曲与高级效果仍待后续阶段；本版没有其空入口。
