# 需求总览：币圈 K 线监控大屏

## 项目定位

币圈 K 线监控大屏（Electron 桌面版）：Windows 独立桌面程序，打开即多币种盯盘大屏，类似独立盯盘软件，不是浏览器网页。

底层图表库为 LuxAlgo/Vela（本仓库即其源码 clone），桌面应用代码计划位于 `desktop/` 子目录；当前交互原型在 `playground/`（`npm run playground` → `dashboard.html`）。

## 核心功能

1. **多格子网格 K 线布局**：一屏同时展示多个币种 K 线；每个格子独立配置币种、独立周期。
2. **每格独立周期下拉**：周期选择不再放在顶部，而是每个格子右上角自带下拉，可单独切换 `1m 5m 10m 15m 30m 1h 4h 8h 12h 1d 1w 1M`。
3. **数据源**：币安实时 WebSocket K 线（现货 / 合约），`BinanceProvider`。
4. **自选收藏分组**：左侧自选栏占满完整左侧高度，支持分组管理，点击币种切换到当前激活格子。
5. **布局切换**：预设网格布局（4 格、8 格等）+ 自定义行列，深色盯盘主题；布局可命名保存。
6. **EMA 均线配置**：左下角「⚙ 设置」打开多 tab 设置弹窗（左侧竖排 tab + 右侧内容），EMA 配置为全局生效，默认 5/10/20/30/60/120 六条，每条可独立开关、改色、改周期，可增删。
7. **Pine 脚本编辑器**：右下角可收起/展开、高度可拖动的脚本编辑区；支持 Pine v5，脚本下拉管理（新建 / 保存 / 删除 / 应用），「应用」一次性应用到所有图表格子。
8. **监控与告警**：价格阈值告警（上穿 / 下穿）+ 爆拉/暴跌监控（时间窗口内涨跌幅超阈值），实时轮询触发并提示（toast + 提示音），可重新监控。触发后默认重复播报 1 分钟，点击告警消息可将当条告警静音；对应币种所在格子边框闪烁 + 角标提示，静音后消失。添加告警自动取当前激活格子币种，无需手输。告警提示音可在系统设置「警报声音」中维护：在线试听、选择当前提示音、上传自定义提示音（内置 edge-tts 常用提示音）；系统设置「告警维护」可统一删除 / 修改 / 按币种排序所有告警。
9. **连接状态监控与断线告警**：左上角「K线监控」后方显示连接状态指示灯（绿色圆点闪烁 = 正常，黄色 = 速度慢，红色 = 断开）；币安 WebSocket 断开时弹出提示框并语音提示。

## 非需求（保持简单，不做复杂功能）

- 不做交易下单。
- 不接入多个交易所，优先只用币安。

## 运行形态

Windows 独立桌面窗口程序，打开直接就是监控大屏。

## 技术栈

- 图表：`@luxalgo/vela` + VelaWorkspace
- 脚本引擎：`@luxalgo/vela-pinets`（Pine v5，AGPL-3.0 独立包，按需安装）
- 前端页面：原生 TypeScript + Vite（playground 原型）
- 外壳：Electron，打包为 Windows exe
- 存储：LocalStorage / IndexedDB，保存收藏列表、大屏布局配置、告警、脚本、EMA 配置

## 阶段完成说明

当前版本（0.2.0）为阶段性完成版本，功能已收敛；规划中但未实现的功能（如快速添加到大屏、格子放大详情等）已全部取消，不再追加。以下为已落地清单：

- **连接状态监控与断线告警**：已在桌面版落地（原生系统通知 + 页内弹窗 / 语音 / toast），设计详见 docs/plans/alerts.md。
- **爆拉/暴跌监控**：已在桌面版落地（告警触发时同时弹原生系统通知）。
- **警报声音维护**：已在桌面版落地（系统设置 →「警报声音」）。
- **桌面系统通知**：已落地（`window.velaDesktop.notify` → Electron Notification）。
- **持久化**：已迁移到 IndexedDB（见 docs/plans/persistence.md）。
- **应用图标**：已落地（`desktop/build/icon.ico`，设计源 `icon.svg`，`npm run icon` 可重新生成）。
- **版本号**：已定为 `0.2.0`（`desktop/package.json`）。
- **代码签名**：按需求不做（无证书签名流程）。
- **合约数据源接入 UI**：已落地——搜索框 / 自选 / 网格支持 USDT-M 永续合约（`BTCUSDT.P`，走 fapi），告警轮询同步支持合约 ticker；`BinanceProvider` 本就支持 `.P`（见 `playground/binanceMarkets.ts` 与 docs/plans/watchlist.md）。边界：持仓盈亏暂按现货计价，合约交易对不参与持仓计算。

## 相关设计文档

| 主题 | 文档 |
|------|------|
| 桌面架构（Electron + Vela） | docs/plans/architecture.md |
| 多格网格布局 | docs/plans/grid-layout.md |
| 自选收藏分组 | docs/plans/watchlist.md |
| 价格告警与推送 | docs/plans/alerts.md |
| 本地持久化 | docs/plans/persistence.md |
| Pine 脚本编辑器 | docs/plans/pine-scripting.md |