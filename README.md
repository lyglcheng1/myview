<!-- markdownlint-disable no-inline-html first-line-h1 -->

<div align="center">

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/banner.png">
    <source media="(prefers-color-scheme: light)" srcset=".github/banner-light.png">
    <img src=".github/banner.png" alt="Vela™ by LuxAlgo" width="100%">
  </picture>

# 币圈 K 线监控大屏（myview）

  <p><strong>一屏多格子实时盯盘 · 自选分组 · 合约数据源 · Pine 选币扫描 · 价格告警 · 持仓盈亏 · 交易计划</strong><br>
  基于 <a href="https://github.com/LuxAlgo/Vela">LuxAlgo/Vela</a> 构建的币圈 K 线监控大屏，提供 Web 原型与 Windows 桌面版（Electron）。</p>

  [![License][license-img]][license-link]
  [![Version][version-img]][version-link]

  <p>
    <a href="#功能特性">功能特性</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#项目结构">项目结构</a> ·
    <a href="#开发与测试">开发与测试</a> ·
    <a href="#许可与署名">许可与署名</a>
  </p>

</div>

<!-- markdownlint-enable no-inline-html -->

## 简介

本项目把 [LuxAlgo/Vela](https://github.com/LuxAlgo/Vela) 图表库封装成一款**币圈 K 线监控大屏**：以多格子的形式同时盯盘多个币种，配合自选分组、Pine 脚本选币、价格告警、持仓盈亏与交易计划，形成「**盯盘 → 扫描 → 交易 → 复盘**」的完整闭环。

- **Web 原型**：`playground/` 中的监控大屏页面，浏览器直接打开即可使用。
- **Windows 桌面版**：`desktop/` 用 Electron 封装同一页面，支持系统通知、离线持久化与一键打包 exe。

> 本仓库同时包含 Vela 图表库的完整源码（`src/`），可独立作为图表库开发使用。

## 功能特性

### 🖥 多格网格盯盘

- 一屏多格子实时展示多个币种 K 线，支持 1 格 / 多格预设网格与左右 / 上下分栏布局。
- 每个格子独立配置币种与周期（5m / 15m / 30m / 1h），点击侧栏币种快速切换当前激活格子。
- 布局方案可**保存 / 重命名 / 删除 / 应用**，刷新后自动恢复。
- 深色盯盘主题为默认，支持浅色主题切换；侧栏可折叠，最大化图表可视区域。

### ⭐ 自选收藏分组

- 多分组管理：新建 / 重命名 / 删除分组，token 跨组独立，同一币种可出现在多个分组。
- 搜索框实时过滤全部可用币种：**点击结果行直接在网格打开**该币种，**点击行右侧星标**才加入当前自选分组（已收藏显示 ★）。

### 🔗 合约数据源

- 同时支持 Binance **现货**与 **USDT-M 永续合约**（`BTCUSDT.P`），搜索、自选、网格、告警轮询全链路打通。
- 数据只走币安官方端点（`wss://stream.binance.com` 系列 WebSocket + REST），不依赖任何自建服务器。

### 📜 Pine 脚本编辑器

- 内置 Pine 脚本编辑器（基于 `@luxalgo/vela-pinets`，AGPL-3.0 独立包）。
- 脚本可应用到全部格子，重复「应用」不会叠加挂载，一键「清空脚本」全部移除。
- 脚本源码持久化到 IndexedDB。

### 🔍 Pine 选币扫描

- 用已保存的 Pine 脚本在 **Binance USDT 现货 / U本位合约日线**上无头扫描（市场可切换：现货 / 合约 / 全部），实时列出命中币种、价格与日涨跌。
- 点击结果弹出**浮动 K 线预览**（可切换周期），选币面板保持可用，可连续浏览多个结果；「在网格打开」一键带入 K 线网格。
- 保留最近 20 条扫描历史（含市场选择），支持重跑 / 删除。

### 🚨 价格告警与推送

- **阈值告警**：价格达到 ≥ / ≤ 目标价时触发。
- **爆拉 / 暴跌监控**：指定周期内涨跌幅超过阈值即触发。
- 告警声音可维护（系统设置 →「警报声音」）；桌面版通过 Windows 原生通知推送，浏览器内自动降级为 toast / 语音。

### 💰 持仓盈亏记录

- 记录持仓（币种 / 数量 / 买入价 / 日期 / 备注），实时拉取最新价。
- 自动计算**当前市值与盈亏金额**（盈绿亏红），并展示 USD → CNY 参考汇率。

### 📝 交易计划

- 一键捕获当前图表（**含画线**）为截图，填入「目标 / 入场理由 / 退出底线」模板。
- Markdown 编辑器 + 实时预览；支持图片粘贴 / 拖拽；计划列表可搜索、分页，双击只读查看。

### 💾 本地持久化

- 收藏、布局、告警、EMA 设置、Pine 脚本、告警声音、主题、持仓、交易计划统一写入 IndexedDB（`vela-dashboard`），并带 localStorage 镜像兼容旧数据。
- 所有数据**仅存本地**，不上传。

### 📶 连接状态监控

- 监控币安 WebSocket 连接状态，断线 / 重连时提示。
- 「说明」弹窗标注全部数据源与网络出口、隐私声明。

## 技术栈

| 层 | 选型 |
|----|------|
| 图表 | `@luxalgo/vela` 0.8.5（本仓库源码） + VelaWorkspace |
| 桌面外壳 | Electron + electron-builder（Windows exe / 安装包） |
| 前端 | 原生 TypeScript · Vite |
| 数据源 | BinanceProvider（币安现货 / 合约 WebSocket + REST） |
| 脚本引擎 | `@luxalgo/vela-pinets`（PineTS，AGPL-3.0 独立包） |
| 存储 | IndexedDB / localStorage |
| 工具链 | TypeScript · ESLint 9 · Vitest 4 · tsup · Vite |

## 快速开始

### Web 原型

```bash
npm install
npm run playground
```

浏览器打开 <http://localhost:5190/dashboard.html> 即可使用。

### Windows 桌面版

```bash
npm --prefix desktop install   # 首次安装桌面端依赖
npm run desktop:dev             # 开发模式：Vite HMR + Electron 窗口
```

生产构建与打包 exe：

```bash
npm run desktop:build           # 构建 renderer + 主进程
npm --prefix desktop run pack   # electron-builder 打包（nsis 安装包 + 便携 exe）
```

产物位于 `desktop/dist/installer/`。

## 项目结构

```
├── src/             # Vela 图表库源码（上游核心）
├── playground/      # 监控大屏 Web 原型（同时是桌面版 renderer）
├── desktop/         # Electron 桌面外壳（主进程 / preload / IPC / 打包）
├── docs/            # 中文设计文档（docs/plans）+ 上游用户 / 贡献文档
├── test/            # 单元测试（Vitest，2400+ 用例）
├── CHANGELOG.md     # 变更日志
└── AGENTS.md        # AI 代理工作指南（开发约束 / 质量门禁）
```

设计文档（中文）：[需求总览](docs/plans/requirements.md) · [桌面架构](docs/plans/architecture.md) · [网格布局](docs/plans/grid-layout.md) · [自选分组](docs/plans/watchlist.md) · [价格告警](docs/plans/alerts.md) · [持仓盈亏](docs/plans/holdings.md) · [Pine 脚本](docs/plans/pine-scripting.md) · [Pine 选币](docs/plans/pine-screener.md) · [交易计划](docs/plans/trade-plan.md) · [本地持久化](docs/plans/persistence.md)。

## 开发与测试

```bash
npm run typecheck    # 类型检查
npm run lint         # ESLint
npm test            # Vitest 单元测试
npm run build        # 构建 Vela 库（tsup → dist/）
```

## 许可与署名

本仓库以 **Apache License 2.0** 开源（见 [LICENSE](LICENSE)），并遵守 [NOTICE](NOTICE) 中的署名要求：

- 每张图表默认渲染一个 **Vela™ 署名水印**（项目 logomark，链接到项目页），默认开启。
- 关闭水印（`chart.renderer.set('attribution', false)`）时，必须在同一页面 / 屏幕的可见位置提供等效归因（名称 "Vela™" 链接到项目页）。
- 未提供等效归因而移除 / 隐藏 / 遮挡署名水印是不允许的。

Pine 脚本引擎 `@luxalgo/vela-pinets` 为 **AGPL-3.0** 独立包，按需安装，与主库许可证隔离。

上游项目：[LuxAlgo/Vela](https://github.com/LuxAlgo/Vela)（Apache-2.0 + NOTICE）。

[license-img]: https://img.shields.io/badge/license-Apache--2.0-blue.svg
[license-link]: LICENSE
[version-img]: https://img.shields.io/badge/version-0.2.0-blue.svg
[version-link]: CHANGELOG.md