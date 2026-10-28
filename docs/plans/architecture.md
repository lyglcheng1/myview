# 桌面架构：Electron + Vela

## 总体架构

采用 Electron 标准主进程 + 渲染进程模型：

- **主进程（main）**：创建窗口、管理生命周期、系统通知、打包入口。
- **渲染进程（renderer）**：运行监控大屏网页，加载 Vela / VelaWorkspace，直连币安 WebSocket。
- **预加载脚本（preload）**：通过 `contextBridge` 暴露受控 IPC API，渲染进程不直接接触 Node。

## 目录结构（desktop/ 子目录）

```
desktop/
├── package.json        # 桌面应用依赖与脚本（独立于 Vela 库）
├── electron/
│   ├── main.ts         # Electron 主进程
│   ├── preload.ts      # contextBridge 预加载
│   └── ipc.ts          # IPC 通道定义（告警、通知）
├── src/                # 渲染进程前端
│   ├── index.html
│   ├── main.ts         # 入口：初始化 VelaWorkspace
│   ├── grid.ts         # 网格布局管理
│   ├── watchlist.ts     # 收藏分组
│   ├── alerts.ts        # 告警引擎
│   ├── connection.ts    # 连接状态监控（指示灯 / 断线弹窗 / 语音提示）
│   ├── ema.ts           # EMA 均线配置与应用
│   ├── pineEditor.ts    # Pine 脚本编辑器（脚本管理 / 应用 / 清空）
│   └── storage.ts       # 本地持久化
├── build/              # electron-builder 配置与图标
└── dist/               # 打包产物（gitignore）
```

## 数据流

1. 币安 WebSocket（`wss://stream.binance.com`）→ `BinanceProvider`（`@luxalgo/vela/providers/binance`）。
2. Vela 核心通过 `MarketDataFeed` 端口消费历史与实时 K 线。
3. VelaWorkspace 渲染图表；Pine 脚本引擎（`@luxalgo/vela-pinets`）通过 `registerDefaultEngine('pine', ...)` 在渲染层注册并执行 Pine v5 指标。
4. 渲染进程的告警引擎订阅实时 tick，触发条件后经 IPC 通知主进程播放声音 / 系统通知。
5. 渲染进程的连接状态监控监听 BinanceProvider 连接生命周期与消息延迟：正常（绿）/ 速度慢（黄）/ 断开（红）三级状态；断开时经 IPC 通知主进程弹窗并语音提示（设计见 docs/plans/alerts.md）。

## Pine 脚本引擎边界

- `@luxalgo/vela-pinets` 是独立 AGPL-3.0 包，按需安装，**不进入 Vela core**。
- 引擎注册与脚本执行全部发生在渲染层（playground 原型 / 桌面渲染进程），core 保持无头、无脚本引擎，遵守许可证隔离（见 docs/architecture/boundaries.md）。
- 编辑器中「应用」把脚本注册到全部图表格子；「清空脚本」反向卸载全部已挂载实例（设计见 docs/plans/pine-scripting.md）。

## 进程间通信（IPC）

- 告警触发 → 渲染进程 → IPC → 主进程：播放声音（本地音频文件）、系统通知（`Notification`）。
- 所有 IPC 通道白名单化，preload 只暴露最小 API。

## 打包

- electron-builder → Windows NSIS 安装包 / 便携 exe。
- 主进程与渲染进程均打包；Vela 作为依赖打入。
- 图标与版本已补充（`desktop/build/icon.ico`，版本 `0.2.0`）；代码签名按需求不做。

## 安全决策

- `contextIsolation: true`，`nodeIntegration: false`。
- 渲染进程不加载远程内容，不开放 `window.open` 到外部。
- 币安 WebSocket 为唯一网络出口（另有 Vela 历史 REST 请求）。

## 当前进展

- **playground 原型**（`playground/dashboard.html`）已验证：多格网格、每格周期下拉、自选侧栏、设置弹窗（EMA 配置）、Pine 脚本编辑器、价格告警、布局持久化、连接状态监控与断线告警、Pine 选币扫描（含结果浮动 K 线预览）、合约数据源接入 UI（搜索/自选/网格支持 `BTCUSDT.P` 永续合约）。
- **desktop/ 骨架已搭建**：Electron 主进程 + preload + IPC（`desktop/electron/`）、渲染进程构建（`desktop/vite.renderer.config.mts` 把 playground dashboard 构建到 `desktop/dist/renderer`）、开发与打包脚本（`npm run desktop:dev` / `npm run desktop:build`）。安全基线已落实（`contextIsolation`、无 Node 集成、仅本地内容），已在本地 Windows 环境启动验证（窗口加载 dashboard 页面成功）。详见 `desktop/README.md`。
- **已完成（桌面版）**：告警 / 连接监控已接入 preload IPC（原生系统通知）；IndexedDB 持久化迁移完成；应用图标与版本号已补充；electron-builder 打包已实测成功（NSIS 安装包 + 便携 exe，见 desktop/README.md）。代码签名按需求不做。
- 连接状态监控与断线告警已在 playground 原型实现，并在桌面版接入原生系统通知（设计见 docs/plans/alerts.md）。