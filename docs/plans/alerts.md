# 价格告警与推送设计

## 需求

- 监控爆拉暴跌。
- 自定义"上涨到 / 下跌到 xx 价格"声音警报。
- 价格告警、消息推送。

## 告警类型

1. **价格阈值告警**：当某币种最新价 ≥ 目标价（上涨到）或 ≤ 目标价（下跌到）时触发。
2. **爆拉暴跌监控**：设定时间窗口内涨跌幅超过阈值（如 5 分钟涨跌 > X%）时触发。

## 数据模型

```ts
type Alert = {
  id: string;
  symbol: string;         // 交易对，如 "BTCUSDT"
  kind: 'price-up' | 'price-down' | 'surge' | 'dump';
  targetPrice?: number;   // price-up / price-down 的目标价
  windowMinutes?: number; // surge / dump 的观察窗口
  thresholdPct?: number;  // surge / dump 的涨跌幅阈值
  sound: boolean;         // 是否播放声音
  enabled: boolean;
  createdAt: number;
  lastTriggeredAt?: number; // 去重用
};
```

存储：`Alert[]` 持久化到本地（见 docs/plans/persistence.md）。

## 检测逻辑

- **数据源**：订阅每个告警币种的实时 tick（来自 Vela 实时 K 线流 / 币安 WebSocket）。
- **触发条件**：每条 tick 到达时计算，满足条件即触发。
- **去重**：同一告警在冷却窗口（如 60 秒）内不重复触发，避免刷屏。
- **触发动作**：
  1. 播放告警声音（渲染进程本地音频，或经 IPC 由主进程播放）。
  2. 系统通知（Electron `Notification`，桌面消息推送）。
  3. 大屏视觉提示（格子边框闪烁 / 告警角标）。

## 与 Vela 的集成

- 实时 K 线流：Vela 图表已订阅 symbol 的实时数据，告警引擎复用同一数据源。
- 也可独立维护轻量 WebSocket 订阅（告警币种 + 图表币种的并集），避免依赖图表实例。

## 通知渠道

- 声音：本地音频文件（提示音），支持开关。
- 消息推送：Electron `Notification`（Windows 通知中心）。

## 连接状态监控与断线告警

### 需求

- 监控币安 WebSocket 连接状态（`BinanceProvider`）。
- 左上角「K线监控」文字后常驻连接状态指示灯。
- 连接断开时弹出提示框，并语音播报提示。

### 状态指示灯

| 状态 | 显示 | 含义 |
|------|------|------|
| 正常 | 绿色圆点闪烁 | 连接正常，数据按预期频率到达 |
| 速度慢 | 黄色圆点 | 消息延迟 / 心跳超时超过阈值，数据变慢 |
| 断开 | 红色圆点 | 连接断开（close / error / 长时间无数据） |

- 位置：顶部左上角「K线监控」标签之后，独立小圆点，CSS 动画实现闪烁。
- 绿色圆点平时保持闪烁，代表「实时连接中」。

### 断线告警动作

1. **提示框**：渲染进程弹窗（或经 IPC 调 Electron 对话框），说明币安连接已断开。
2. **语音提示**：播放本地提示音，或语音合成（如 Web Speech API / 预置音频）播报断线。
3. **自动重连**：WebSocket 层自动重连；恢复后指示灯转绿，并可选提示「已恢复」。

### 实现要点（设计）

- 两级阈值判定：消息延迟超过阈值 → 黄色；连接断开或长时间无数据（stall 超时）→ 红色。
- 断线 / 恢复事件只触发一次（状态机去重），初始连接成功不算"恢复"。

### 实现（playground 原型）

`BinanceProvider` 未暴露连接生命周期事件，原型采用**独立轻量状态 WebSocket** 探测币安数据源健康：

- 连接 `wss://stream.binance.com:9443/ws/!miniTicker@arr`（每 ~1s 推送一次全量 miniTicker，可测端到端延迟）。
- `playground/connectionStatus.ts`：
  - `ConnectionHealth`：纯状态机（`ok` / `slow` / `down`），支持注入时钟，已单元测试。
  - `ConnectionMonitor`：WebSocket 封装，解析事件时间 `E` 计算延迟，断线自动重连。
- `playground/dashboard.ts`：状态驱动左上角指示灯；断线弹出提示框 + 语音播报（`speechSynthesis`），恢复后 toast 提示。
- 桌面版落地时若仍无法复用 BinanceProvider 内部连接，可保留此独立状态通道，或等 provider 暴露生命周期事件后切换。

### 当前进展

- playground 原型已实现：指示灯、断线弹窗、语音提示、自动重连、恢复提示。
- 桌面版已落地：断线 / 恢复时通过 `window.velaDesktop.notify`（preload IPC）弹出 Electron 原生系统通知（见下方「当前进展」）。

## 当前进展

- 已实现**价格阈值告警**（`price-up` / `price-down`）与**爆拉/暴跌监控**（`surge` / `dump`），统一在顶栏 🔔 弹层管理：
  - 价格告警：轻量 REST 轮询目标币种最新价（每 5s），满足条件触发浏览器提示音 + toast；支持现货与 USDT-M 永续合约（`BTCUSDT.P`，走 fapi 价格接口，见 `playground/binanceMarkets.ts`）。
  - 爆拉/暴跌：REST 拉取窗口 K 线（1/3/5/15/30/60 分钟），按「当前 forming K 线开盘价 → 最新价」计算窗口涨跌幅，超过阈值（如 5 分钟 > 3%）触发，支持「重新监控」重置；合约交易对同样适用（fapi klines）。
  - 所有告警持久化到 `localStorage`（旧格式自动迁移），触发后可一键重置或删除。
- 纯逻辑（告警模型、旧数据迁移、窗口涨跌幅计算、条件文案）抽在 `playground/alerts.ts`，已单元测试。
- **警报声音维护**（系统设置 ⚙ → 「警报声音」选项卡）：
  - 内置常用提示音：默认提示、价格告警、爆拉、暴跌、断线、连接恢复（edge-tts 中文语音，`playground/public/sounds/`）+ 用户下载的拼音命名提示音（baojinbi、daojishi、weixinlaidian 等，共 16 个）。
  - 声音选择为**下拉框**：选中即保存为当前告警提示音并自动试听（持久化到 `localStorage`）；旁边有「▶ 试听」按钮可随时播放当前选中声音（包括已上传的自定义声音）。
  - 支持**上传替换**为自定义提示音（本地音频文件，转 data URL 持久化），或一键恢复内置默认。
  - 声音注册表、选择/上传/恢复的读写逻辑抽在 `playground/alertSounds.ts`，已单元测试。
- **添加告警免输入币种**：添加告警时自动取当前激活格子的币种（两个只读输入框随激活格子同步），切换格子后打开 🔔 面板即刷新。
- **告警弹框加宽**：表单与「添加」按钮单行排列，价格告警与爆拉/暴跌各行占一行。
- **统一告警维护**（系统设置 ⚙ → 「告警维护」选项卡）：列出所有告警，支持**删除**、**行内修改**（价格/方向/窗口/阈值/币种均可改，保存后重置触发状态）、**按币种排序**（默认/升序/降序，排序偏好持久化）。排序纯逻辑 `sortAlerts` 在 `playground/alerts.ts`，已单元测试。
- **触发后重复播报 + 点击静音**：告警触发时播放提示音，默认每 4 秒重复播报 **1 分钟**；屏幕底部出现该条告警的可点击消息，点击后**当条告警立即静音**（停止重复播报并收起消息）。删除 / 重置 / 修改告警时也会停止对应播报。定时调度抽在 `playground/alertRinging.ts`（`RingScheduler`，可注入播放与停止回调），已单元测试。
- **告警格子视觉提示**：告警触发时，大屏上**所有显示该币种的格子**出现视觉反馈——边框 `box-shadow` 脉冲闪烁 + 右上角告警角标（🔺上穿 / 🔻下穿 / 🚀爆拉 / 📉暴跌，同一币种多条活跃告警时显示 `×N`）。静音 / 超时 / 删除 / 重置后提示消失；响铃期间切换布局，新格子会补上提示。每个币种的活跃告警计数抽在 `playground/alertCellHighlight.ts`（`RingSymbolCounter`），已单元测试。
- 桌面系统通知已落地：`playground/desktopBridge.ts` 通过 `window.velaDesktop.notify`（preload contextBridge）调用
  Electron 原生通知；告警触发、断线 / 恢复时在桌面版弹出系统通知，浏览器中自动降级为无操作。