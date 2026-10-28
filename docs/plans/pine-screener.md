# Pine 选币扫描设计

## 需求

在「功能模块」面板中提供 **Pine 选币**：把已保存的 Pine 脚本无头跑在 **Binance USDT 市场**（现货 / U本位合约，可切换）的日 K 线上，脚本通过 `plot(cond ? 1 : 0, "signal", display=display.none)` 发布布尔信号，命中（最后一根 K 线 signal 非零）的币种进入结果列表。点击结果行弹出浮动 K 线预览，可切换周期或一键在 K 线大屏打开该币种。

## 当前状态（已实现，playground / 桌面渲染层）

> 桌面版渲染进程就是 playground dashboard 页面（见 `desktop/README.md`），以下功能（含浮动预览）随桌面端构建自动生效；`npm --prefix desktop run build` 已实测通过。

### 扫描数据源

- 扫描市场可在工具栏切换：**现货**（默认）/ **U本位合约** / **全部**，通过 `createScreenerDataSource({ market })` 传入。
  - 现货宇宙 = `BinanceProvider.listSymbols()` 中 `type === "crypto"` 且交易对以 `USDT` 结尾的现货交易对（即 `exchangeInfo` 里 `status === "TRADING"` 且 `quoteAsset === "USDT"` 的集合）。
  - 合约宇宙 = `type === "futures"` 且 ticker 形如 `BTCUSDT.P` 的 U本位永续合约（`fapi` 的 `PERPETUAL` + `quoteAsset === "USDT"`，ticker 带 `.P` 后缀，与搜索 / 自选 / 网格的合约约定一致）。
  - 「全部」= 两者合并；非 USDT 报价的合约（如 `BTCUSD_PERP.P`）不属于 USDT 本位，不纳入。
- 名称取 ticker 的基础币（`baseSymbolOf`，已支持 `.P` 后缀：`BTCUSDT.P` → `BTC`）。
- 周期固定为日线（Vela 规范时间键 `"D"`）。
- 每币种日 K 缓存落在独立 IndexedDB 数据库 `vela-dashboard-kline`（对象仓库 `daily`），与 dashboard 的 `vela-dashboard` kv 库分离，避免 schema 版本互相干扰。
- 首次接触某币种：下载一个足够产出 `historyBars` 根日 K 的时间窗（默认 500 根，`1.5× 根数 + 7 天` 缓冲），并按 `historyBars` 截断缓存。
- 增量更新：缓存最新 K 线时间距今天不足一天视为新鲜、直接复用；否则只拉取缺失尾部并做去重合并（`fullHistory` 打开时首次下载从 2017 年至今的全量历史，适用于桌面版全量同步场景）。
- `createScreenerDataSource` 支持注入 `listSymbols` / `fetchKlines` / `now`，单元测试不依赖网络。

### 扫描流程

- 引擎用 `PineWorkerEngine`（`@luxalgo/vela-pinets` 的 worker 实现），仅存在于渲染层，符合 AGPL 许可证隔离。
- 启动时读取当前选中脚本（含 `id/name/source`）作为本次运行的固定快照，扫描中途切换脚本不会污染历史记录。
- 并发 `SCAN_CONCURRENCY = 3`，逐币 `try/catch`——单币失败不中止全市场扫描。
- 每币少于 `MIN_BARS = 30` 根日 K 直接跳过（信号无意义）。
- 进度事件依次发出 `preparing → scanning（逐币）→ done / cancelled / error`，包含 `total / done / matched / currentTicker / currentName`。

### 结果与历史

- 结果表列：代码 / 名称 / 最新价 / 涨跌幅 / 信号值。点击行通过 `onOpenSymbol(ticker)` 触发浮动 K 线预览（`#screener-preview`），预览内可切换周期，或点「在网格打开」进入 K 线大屏。
- 扫描完成后自动写入历史：`vela-dashboard-pine-scan-history`（localStorage + IndexedDB 写穿），最多保留 20 条，新记录压入尾部、超出丢弃最旧；每条历史记录保存本次运行的 `market`，重新扫描时恢复该市场。
- 历史条：下拉选择已保存扫描 → 可重新扫描（重跑该脚本、市场与参数）或删除；重新打开 / 数据水合后自动渲染最近一次扫描结果，不需要用户先触发 change 事件。

### UI 结构

- 「功能模块」侧栏新增入口 **Pine 选币**（`#feature-pine-screener`），点击后在右侧功能面板显示 `#pine-screener-app`。
- 顶部工具栏：脚本下拉（复用已保存 Pine 脚本列表）、市场下拉（`#screener-market`，现货 / U本位合约 / 全部）、历史 K 线根数（`#screener-history`，60–2000，默认 500）、开始 / 停止按钮。
- 历史下拉与结果摘要显示市场标签（现货 / U本位合约 / 全部）。
- 脚本参数区：按已保存脚本的 inputs schema 自动渲染输入控件。
- 进度条 + 状态文字；结果区为空时显示引导文案。
- 浮动预览窗口（`#screener-preview`）：点击结果行时在右下角浮层显示该币种 K 线，选币面板保持可用，便于连续浏览多个命中；标题显示币对，周期下拉（1m–1M）独立于网格周期，点击「在网格打开」关闭浮层并把币种带入 K 线网格。关闭浮层即销毁图表实例。

## 测试

- `test/pine-screener-scan.test.ts`：扫描循环（全市场遍历、信号匹配、自定义信号 plot、进度顺序、取消、prepare/列表失败、单币失败隔离）。
- `test/pine-screener-binance.test.ts`：USDT 现货过滤、合约（`futures`）与全市场（`all`）过滤、首次接触窗口、fullHistory 回看、增量尾部合并、空尾部保留缓存、新鲜缓存不请求。
- `test/pine-screener-kline-store.test.ts`：内存后端与紧凑元组往返。
- `test/pine-screener-history.test.ts`：历史读写、损坏容错、上限淘汰、按 id 删除。
- `test/pine-screener-style.test.mjs`：`[hidden]` 优先级、历史控件、启动时脚本快照、刷新历史时自动渲染选中扫描、扫描状态不晃动、浮动预览窗口接线。

## 边界

- 不修改 Vela core；仅通过公开 API（`BinanceProvider`、Pine 执行类型）实现。
- 所有网络请求只连币安官方端点；K 线缓存只存本机 IndexedDB，不上传。
- `@luxalgo/vela-pinets` 只在渲染层使用（lint ACL 禁止其进入 core）。
- 相关文档：Pine 脚本编辑器见 `docs/plans/pine-scripting.md`；持久化见 `docs/plans/persistence.md`。