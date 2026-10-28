# 桌面版（desktop/）

Electron 桌面外壳，把 playground 监控大屏（`playground/dashboard.html`）封装为 Windows 桌面应用。

## 目录结构

```
desktop/
├── package.json          # 桌面应用依赖与脚本（独立于 Vela 库）
├── vite.renderer.config.mts  # 渲染进程构建：把 playground dashboard 构建到 dist/renderer
├── tsconfig.electron.json   # 主进程 / preload 的 TypeScript 编译配置
├── eslint.config.js        # 桌面代码的独立 ESLint 配置（不干扰库门禁）
├── electron/
│   ├── main.ts             # 主进程：窗口、生命周期、安全策略、IPC 注册
│   ├── preload.ts          # contextBridge 暴露最小 API（window.velaDesktop）
│   └── ipc.ts              # IPC 通道白名单（alert:notify 系统通知）
├── scripts/
│   ├── launch-electron.cjs # dev 启动器：清除 ELECTRON_RUN_AS_NODE 后 spawn Electron
│   └── generate-icon.cjs  # 从 build/icon.svg 重新生成 PNG / ICO 图标
├── src/
│   └── global.d.ts         # 渲染进程的 velaDesktop 类型声明（供后续迁移使用）
├── build/                  # electron-builder 资源：icon.svg / icon.png / icon.ico
└── dist/                   # 构建产物（renderer 页面 + dist-electron，不入库）
```

## 启动

```bash
npm run desktop:dev      # 开发模式：Vite dev server (5190) + Electron 窗口，HMR
npm run desktop:build    # 生产构建：构建渲染页面 + 编译主进程 + electron-builder 打包
```

首次运行前需要安装依赖：`npm --prefix desktop install`。

## 进度（v0.2.0 阶段完成）

> 当前版本为阶段性完成版本；规划中但未实现的功能已全部取消，不再追加。

- [x] Electron 主进程 + preload + IPC 骨架，安全基线已落实：
  - `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
  - 仅加载本地内容（dev server 仅限本地开发；生产加载打包后的 dashboard.html）
  - 禁止 `window.open` / 页面导航离开应用
- [x] 渲染进程构建链路：`vite build` 把 playground dashboard 连同 Vela 源码、告警声音打包到 `desktop/dist/renderer`。
- [x] 音频路径已验证为相对路径（`sounds/*.mp3`），`file://` 下可正常播放。
- [x] 开发链路已验证：`npm run desktop:dev` 同时启动 Vite dev server（127.0.0.1:5190）和 Electron 窗口，页面正常加载。
- [x] 新增左下角「说明」按钮（设置按钮左侧）+ 功能说明弹窗：系统功能简介、数据来源与网络说明（唯一网络出口为币安官方
      WebSocket/REST，无自建服务器）、隐私说明。有针对性测试（`test/dashboard-help.test.ts`）。
- [x] 处理了开发机的 `ELECTRON_RUN_AS_NODE=1` 环境变量（会让 Electron 退化为纯 Node 模式）：
      `scripts/launch-electron.cjs` 在启动前删除该变量。
- [x] 代码质量：`desktop` 有独立 typecheck / lint，构建产物可生成。
- [x] 桌面端功能迁移：告警触发、断线 / 恢复已通过 `window.velaDesktop.notify` 接到 preload IPC，
      在 Electron 中弹出原生系统通知（`playground/desktopBridge.ts` + `alert:notify`）；浏览器中自动降级为无操作。
- [x] electron-builder 打包已实测成功：`npm --prefix desktop run pack` 生成
      `dist/installer/myview-setup-0.2.0.exe`（NSIS 安装包，约 107 MB）和
      `dist/installer/myview.exe`（便携版，约 107 MB），并启动验证窗口加载成功。
      （注意：本机设置了 `ELECTRON_RUN_AS_NODE=1`，验证 exe 前需清除该变量，否则会以纯 Node 模式退出。）
- [x] 应用图标：`build/icon.svg` 设计源文件，`build/icon.png`（512×512）+ `build/icon.ico`（16..256 多尺寸）
      由 `npm run icon` 重新生成；electron-builder 通过 `build/icon.ico` 打包进 exe / 安装包。
- [x] 版本号：`desktop/package.json` 定为 `0.2.0`，产品名 `myview`（打包产物 `myview.exe` 便携版 /
      `myview-setup-0.2.0.exe` 安装包，NSIS 安装后应用名为 `myview`）。
      代码签名按需求不做（无证书签名流程）。
- [x] IndexedDB 持久化迁移：dashboard 用户数据（收藏 / 布局 / 告警 / EMA / 脚本 / 声音 / 主题 / 持仓）统一写入
      IndexedDB 数据库 `vela-dashboard`（`playground/idbStorage.ts`，写穿透 + localStorage 镜像水合迁移），
      设计见 docs/plans/persistence.md。
- [x] Pine 选币结果浮动预览：点击选币结果行在右下角弹出浮动 K 线预览（`#screener-preview`），
      选币面板保持可用可连续浏览命中；预览内可切换周期，「在网格打开」把币种带入 K 线网格。
      （渲染进程即 playground dashboard 页面，构建产物 `desktop/dist/renderer` 已验证包含该功能。）
- [x] 合约数据源接入 UI：搜索 / 自选 / 网格支持 USDT-M 永续合约（`BTCUSDT.P`，显示为
      `BTC/USDT 永续`），告警轮询同步支持混合现货/合约 ticker（`playground/binanceMarkets.ts`）。
      桌面端 renderer 复用 playground 页面，已重新构建验证产物包含合约逻辑。
- [x] Pine 选币支持合约市场：选币工具栏可切换 现货 / U本位合约 / 全部，合约宇宙为 USDT-M 永续
      （`BTCUSDT.P`），结果行点击打开 `.P` 合约；历史记录保存市场字段，重新扫描时恢复。
      桌面端 renderer 复用 playground 页面，已重新构建验证产物包含该功能。

## 说明

- `desktop/node_modules`、`desktop/dist`、`desktop/dist-electron` 不入库（SVN 需在 `desktop/` 设置
  `svn:ignore`，含 `node_modules`、`dist`、`dist-electron`）。
- 渲染进程就是 playground dashboard 页面，Vela 直接从仓库 `src/` 导入，不需要先 `npm run build` 构建库。
- `@luxalgo/vela-pinets`（AGPL）在渲染进程打包时作为外部依赖引入，不进入 Vela 库本身，保持许可证隔离。