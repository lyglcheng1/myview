<!--
================================================================
文件: AGENTS.md
说明: 本仓库的 AI 代理工作指南（币圈 K 线监控大屏项目）
================================================================
-->

# AGENTS.md

## 项目简介

币圈 K 线监控大屏：Windows 独立桌面程序（Electron），一屏多格子实时监控多个币种 K 线。底层图表库为 LuxAlgo/Vela（本仓库为 Vela 源码，clone 自 https://github.com/LuxAlgo/Vela），在其之上开发桌面应用（`desktop/`）。支持自选收藏分组、预设网格布局、PineTS 指标、价格告警与消息推送。

## 技术栈（冻结，不得擅自升级）

- 图表：`@luxalgo/vela` 0.8.5（本仓库源码）+ VelaWorkspace
- 桌面外壳：Electron，electron-builder 打包 Windows exe
- 前端：原生 TypeScript，Vite 构建
- 数据源：币安 WebSocket K 线（现货 / 合约），BinanceProvider
- 脚本引擎：`@luxalgo/vela-pinets`（PineTS，AGPL-3.0 独立包，按需安装）
- 存储：LocalStorage / IndexedDB（收藏、布局、告警）
- 开发工具链：TypeScript ~5.9 · ESLint 9 · Vitest 4 · tsup · Vite
- 门禁：`npm run typecheck` / `npm run lint` / `npm test` / `npm run build`

## 快速导航

| 想做什么 | 去哪看 |
|---------|--------|
| 项目需求总览 | docs/plans/requirements.md |
| 桌面架构与数据流 | docs/plans/architecture.md |
| 网格布局设计 | docs/plans/grid-layout.md |
| 自选收藏分组设计 | docs/plans/watchlist.md |
| 价格告警与推送设计 | docs/plans/alerts.md |
| 持仓盈亏记录设计 | docs/plans/holdings.md |
| Pine 脚本编辑器设计 | docs/plans/pine-scripting.md |
| Pine 选币扫描设计 | docs/plans/pine-screener.md |
| 交易计划设计 | docs/plans/trade-plan.md |
| 本地持久化设计 | docs/plans/persistence.md |
| 测试规范 / 调试 | docs/contributing/testing.md · docs/contributing/debugging.md |
| 工作流与质量门禁 | docs/contributing/workflow.md |
| Vela 架构与边界 | docs/architecture/overview.md · docs/architecture/boundaries.md |

## 启动

```bash
npm install
npm run playground    # Vela 开发环境：http://localhost:5190（HMR，直连 src/）
npm run desktop:dev   # Electron 桌面应用（开发模式，desktop/ 已搭建，见 desktop/README.md）
npm test              # 单元测试（vitest）
npm run build          # 构建 Vela 库（tsup → dist/）
```

Vela 库的开发细节（工具链、产物、playground）见 docs/contributing/setup.md。

## 硬性规则

1. **架构边界**：core 无头且环境无关，不得在渲染层与 widget 之外使用 `window`/`history`/`location`；Vela 不内置脚本引擎，`pinets` 被 lint ACL 禁止（AGPL 许可证隔离）；UI kit（`src/ui`）不得 import 引擎内部，core 不得 import kit；一图一市场一时间轴。
2. **扩展走公开 seam，不 fork 内部实现**：新图表类型用 `registerChartType`、渲染层用 `registerRendererLayer`、原生指标、widget 动作用 `registerWidgetAction`、宿主设置分区用 host settings sections。若需要在层上开新口子，先与用户确认设计。
3. **Contribution 是数据描述符，不是 DOM**：`run`/`when` 内一切来自 `WidgetContext` 参数，不得闭包外部 widget/chart 引用。
4. **UI kit 规则**：组件在触发元素入 DOM 前构建时须显式传 `host`（`closest()` 回退会 portal 到 `<body>`，脱离主题变量）；组件根元素上写 `display` 会破坏 `[hidden]` UA 规则，须配 `[hidden] { display: none !important; }`；新组件遵循 controller.ts + view.ts + styles.ts + index.ts 统一骨架（见 docs/contributing/adding-a-ui-component.md）。
5. **语言**：代码、注释、提交消息一律英文（Vela 上游惯例）；项目文档用中文。不出现竞品名称，描述功能用自身行为。
6. **注释只写代码无法表达的约束**：不写"下一行做什么"，不写评审旁白。
7. **四道门禁**：typecheck、lint、test、build 全部通过才算完成，缺一不可；新行为必须有针对性测试（正面证明，能验证功能缺失时会失败）。
8. **验证纪律**：声称"修复/验证/可用"前必须实际执行检查；做不到就如实标注"未验证"。浏览器探针要断言用户实际看到的东西（计算后的可见性、背景色、非空包围盒、真实点击、计数变化），不能只断言元素存在。
9. **Bug 先复现再修**：单元测试可复现就先写失败测试再修复；浏览器可复现就在浏览器复现、修复、复验。
10. **许可与署名**：仓库 Apache-2.0 + NOTICE 署名要求；图表水印默认开启，任何示例/文档关闭水印时必须提及等效通知义务。
11. **文档同步**：改动涉及开发接口或新增功能时检查 `docs/` 是否仍匹配；漂移则告知用户并询问是否更新。
12. **CHANGELOG**：用户可见功能落地时在同一变更中写 changelog 条目（格式见 docs/contributing/workflow.md）。
13. **提交纪律**：仅在用户要求提交时执行 SVN / 版本控制操作；提交前先呈现变更等待确认，用 targeted `git add`，不提交构建产物、`.scratchpad/`、无关改动。

## 版本控制（SVN）

- 不主动运行 SVN 命令（`svn status` / `svn diff` 等）；需要提交时由用户提出，届时再执行 SVN 操作。
- 项目目录由 SVN 管理，提交用 `svn commit`，新文件用 `svn add` 显式添加。
- 第三方依赖一律不入库、不提交：`node_modules/`、`dist/`、`.venv/`、`venv/`、`__pycache__/` 等必须写入 `svn:ignore`。
- 提交时执行 `svn status` 检查，确认没有误加依赖目录或临时文件。
- `.scratchpad/`、`*.log`、`.env`、`.env.local` 等本地 / 敏感文件同样不入库。
- 提交消息用英文，简洁描述变更，不出现竞品名称。

## 安全基线

- 敏感配置（API Key 等）走环境变量（.env，已 gitignore），禁止硬编码。
- Electron 安全：`contextIsolation` 开启、`nodeIntegration` 关闭、仅加载本地内容，不导航到远程站点。
- WebSocket 仅连接币安官方端点（`wss://stream.binance.com` 系列），不信任第三方数据源。
- 收藏、布局、告警等数据只存本地，不上传。
- 新增端点 / IPC 通道需最小权限；渲染进程不得直接访问 Node 能力。

## 前端设计规范

- 深色盯盘主题：使用 Vela 内置 dark theme；网格布局为多格子（4 格、8 格等预设）。
- 每格独立配置币种与周期（5min / 15min / 30min / 1h）。
- 大屏为主界面，打开即用；辅助面板（收藏、告警）以侧栏 / 浮层呈现。
- 配色、字体、交互细节待 UI 阶段补充（设计文档见 docs/plans/）。

## 项目技能

暂无自定义技能。Vela 库开发的技能与规范见 docs/contributing/；如后续加入 `/skills`，在此登记。

## 功能设计文档（v0.2.0 阶段完成）

当前版本（0.2.0）为阶段性完成版本，功能已收敛；规划中但未实现的功能已全部取消，不再追加。

| 功能 | 设计文档 | 状态 |
|------|----------|------|
| 需求总览 | docs/plans/requirements.md | 已收敛（v0.2.0 阶段完成） |
| 桌面架构（Electron + Vela） | docs/plans/architecture.md | 已实现（desktop/ 骨架 + 渲染链路 + 原生通知 + IndexedDB + 打包） |
| 多格网格布局 | docs/plans/grid-layout.md | 已实现（默认 1×1，布局保存/重命名/删除/分栏） |
| 自选收藏分组 | docs/plans/watchlist.md | 已实现 |
| 价格告警与推送 | docs/plans/alerts.md | 已实现（阈值 + 爆拉暴跌 + 声音维护 + 桌面系统通知） |
| 持仓盈亏记录 | docs/plans/holdings.md | 已实现 |
| Pine 脚本编辑器 | docs/plans/pine-scripting.md | 已实现 |
| Pine 选币扫描 | docs/plans/pine-screener.md | 已实现（含结果浮动预览） |
| 交易计划 | docs/plans/trade-plan.md | 已实现 |
| 本地持久化 | docs/plans/persistence.md | 已实现（IndexedDB 迁移） |