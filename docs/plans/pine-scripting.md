# Pine 脚本编辑器设计

## 需求

在监控大屏中内置 Pine v5 脚本编辑器，用户可以编写、保存并应用指标脚本到图表，扩展盯盘能力。

## 当前状态（playground 已实现）

### 引擎与注册

- 使用 `@luxalgo/vela-pinets` 作为 Pine 引擎（独立 AGPL-3.0 包，按需安装，不进入 Vela core）。
- 通过 `registerDefaultEngine('pine', ...)` 注册默认 Pine 引擎，图表即可执行 Pine v5 脚本。
- 所有 Pine 相关代码都在渲染进程（playground / 桌面渲染层），Vela core 不内置脚本引擎，遵守许可证隔离。

### 编辑器 UI

- 位置：主界面右下角 dock 区。
- 可收起 / 展开：右上角折叠按钮（以及快捷键 `Ctrl+Enter`）控制展开状态。
- 高度可调：拖动编辑器顶部边框（分隔线）调整编辑区高度。
- 编辑区左上角为脚本下拉选择器（当前选中的脚本名），右上角为「新建 / 保存 / 删除 / 应用」操作按钮。
- 下方为代码编辑器（`textarea`），支持 `Ctrl+S` 保存。

### 脚本管理

- 脚本以 JSON 数组存储在 `localStorage`（key：`vela-dashboard-pine-scripts`），每项 `{ name, code }`。
- 首次进入自动创建一个默认示例脚本（MACD 示例）。
- 新建：创建空白脚本并自动命名（如 `script-3`），立即保存。
- 保存：将当前编辑内容写入当前脚本（`Ctrl+S` 快捷键同步）。
- 删除：移除当前脚本并切换到下一个可用脚本。
- 应用：将当前编辑内容以 Pine 引擎注册到 workspace，应用到**所有图表格子**。应用为幂等操作：先移除上一次已挂载的实例，再挂载新实例，不会重复叠加。
- 清空脚本：移除全部图表格子上已应用的 Pine 指标，脚本代码与本地脚本列表保留，可再次「应用」恢复。

## 已知问题

- **重复叠加**：已修复（playground）——「应用」改为"清空后重挂"（clear-then-remount），与「清空脚本」共用同一段卸载逻辑，见下。

## 已实现：清空脚本按钮 + 应用幂等（playground）

### 目标行为（已实现）

1. 「应用」幂等：对同一脚本连续点多次「应用」，图表上不再出现多份叠加。
2. 「清空脚本」：点击后所有格子上的 Pine 指标全部消失；脚本代码保留在编辑器中，本地脚本列表不变。
3. 清空后可再次「应用」，指标恢复。

### 交互与位置

- 「清空脚本」按钮位于编辑区右上角操作区，在「应用」右侧，悬停显示危险色（红）。
- 点击后直接清空并在状态栏提示结果；与「删除分组」一致，暂未加二次确认。

### 实现

- 新增 `playground/pineMount.ts`：`PineIndicatorMount` 维护每个格子已挂载的 `IndicatorHandle`。
  - `apply(hosts, source)` = 先 `clear()` 再逐个 `cell.chart.addIndicator(source)` 挂载（clear-then-remount），单格失败不影响其余格子。
  - `clear()` = 遍历已挂载 handle 调用公开 seam `handle.remove()`（`IndicatorHandle.remove`，见 `src/core/IndicatorHandle.ts`）。
  - `drop(hostId)` = 格子销毁时丢弃记录，不重复调用 remove。
- `playground/dashboard.ts` 用 generation 计数忽略被新「应用」/「清空」取代的异步 ready/error 回调，避免状态栏被旧请求覆盖。
- 全程使用 Vela 公开 seam（`chart.addIndicator` / `handle.remove`），未 fork 内部实现。

### 验收标准

- 单元测试：`test/pine-indicator-mount.test.ts`，覆盖幂等重挂、清空计数、单格失败隔离、格子销毁。
- 浏览器行为由 `test/pine-indicator-mount.test.ts` 单元测试覆盖（幂等重挂、清空计数、单格失败隔离、格子销毁）；真实图表上的人工复验在 v0.2.0 阶段不再安排。

## 涉及文档 / 边界

- 引擎与许可证隔离：见 docs/architecture/boundaries.md。
- 脚本数据持久化：见 docs/plans/persistence.md。
- 桌面版落地时，脚本存储从 `localStorage` 迁移到 IndexedDB。