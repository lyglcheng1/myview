# 持仓盈亏记录设计

## 需求

在监控大屏中加入「我的持仓」管理：记录买入的币种、日期、数量、买入价格与备注，自动从币安获取当前价格，计算买入市值、当前市值、盈亏金额、盈亏百分比与合计；支持 USDT / RMB 双计价切换；以柱状图展示各币数量与金额占比。

参考旧界面：持仓表格（Logo / 名称 / 买入日期 / 数量 / 买入价格 / 买入市值 / 当前价格 / 当前市值 / 盈亏百分比 / 备注）+ 底部合计行；切换计价时价格与市值整体换算（1 USDT = rate CNY）。

## 入口与位置

- 侧栏顶部用 **tab 标签页**把「自选」和「功能模块」分开：「自选」tab 显示普通分组；「💼 功能模块」tab 显示持仓入口（不显示持仓数量徽标），不再混在分组列表里。
- 点击「功能模块」tab（或 tab 面板里的「打开持仓视图」按钮），右侧主区域在「K 线网格」与「持仓视图」之间切换。持仓视图包含：持仓表格 + 占比柱状图 + 计价切换 + 汇率显示。
- 持仓视图**只覆盖侧栏右侧的主区域**（不遮挡左侧侧栏，不再是满屏）；侧栏折叠时自动扩展到整个右侧区域，展开 / 折叠按钮保持可点。
- 点击「自选」tab / 任意普通分组 / 空白区域回到 K 线网格。
- **默认视图**（已确认）：打开应用仍显示 K 线大屏（保持盯盘主定位），不自动选中持仓入口；点击「💼 功能模块」后才显示持仓表。

## 数据模型

```ts
type Holding = {
  id: string;          // 唯一 id
  symbol: string;      // 币安交易对，如 "TRXUSDT"；"USDT" 表示稳定币（当前价恒 1）
  buyDate: string;     // 买入日期 "YYYY-MM-DD"
  quantity: number;    // 数量
  buyPrice: number;    // 买入价格（USDT 计价）
  remark: string;     // 备注
};
```

存储：localStorage `vela-dashboard-holdings-v1`（桌面版迁移 IndexedDB，见 docs/plans/persistence.md）。

## 计算规则

以 USDT 为基础计价单位：

- 买入市值 = quantity × buyPrice
- 当前市值 = quantity × currentPrice
- 盈亏额 = 当前市值 − 买入市值
- 盈亏百分比 = (currentPrice − buyPrice) / buyPrice × 100%
- 合计：买入总市值、当前总市值、总盈亏额、总盈亏百分比 = (当前总市值 − 买入总市值) / 买入总市值 × 100%

RMB 计价时：价格与市值全部乘以汇率 rate（1 USDT = rate CNY），盈亏百分比不变。

## 数据来源

- **当前价格**：币安 REST `GET https://api.binance.com/api/v3/ticker/price?symbols=[...]`，每 5 秒轮询持仓中的非稳定币 symbol（与告警轮询同一端点，**不新增网络出口**）。USDT 持仓按 1.0 处理，不发请求。
- **汇率（USDT→CNY）**：已确认用 CoinGecko 自动获取 + 手动兜底（方案 C）：
  - 自动：`GET https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny,usd`（用户指定），每 30 分钟刷新一次，成功后缓存最近值。
  - 手动：系统设置「持仓设置」中维护，默认 6.65；自动模式网络不可用时回退到手动值（或最近缓存值）。
  - CoinGecko 是除币安外的第二个网络出口（需求确认时由用户指定）。
- **Logo**：已确认用本地内置方案（方案 A）。已从旧项目数据库导出 495 个币的 Logo 到 `playground/public/logos/`，`cryptoLogos.ts` 维护 `base -> 扩展名` 索引；未知币种用首字母圆形文本徽标兜底，无第三方网络请求。

## UI 设计

### 持仓表格

列：Logo | 名称 | 买入日期 | 数量 | 买入价格 | 当前价格 | 买入市值 | 当前市值 | 盈亏金额 | 盈亏百分比 | 备注 | 操作

- **内联编辑**：数量、买入价格、买入日期、备注可直接在单元格编辑（blur / Enter 保存），保存后立即重算并持久化。
- **实时刷新**：当前价格 / 当前市值随轮询更新，整行重算。
- 盈亏金额 = 当前市值 − 买入市值，带正负号；盈亏百分比与盈亏金额均正数绿色、负数红色。
- 底部合计行：买入总市值、当前总市值、总盈亏额、总盈亏百分比。
- 顶部工具条：计价切换（USDT / RMB）、当前汇率（RMB 模式显示）、「＋ 添加持仓」按钮。
- 添加持仓：行内表单（symbol 输入支持搜索提示、数量、买入价、日期、备注），确定后加入并持久化。
- **操作列**：🔔 设置预警（打开共享告警面板，自动填入该持仓币种，快速设目标价）+ ✕ 删除。

### 占比图表

- **金额占比**：竖向柱状图，居中显示，每币一柱，高度 = 当前市值 / 当前总市值 × 100%，柱体使用该币种自己的颜色；柱顶显示「百分比 + 金额（带单位）」，百分比与金额紧挨显示，柱底为币种名。
- **资产占比（饼图）**：SVG 环形饼图，居中放大显示（180px），按当前市值计算各币比例，每币一种颜色；中心显示总资产金额，图例显示币种 / 百分比 / 金额（带单位）。
- 纯 CSS / SVG / DOM 渲染，不引入图表库；RMB / USDT 切换时金额图与饼图同步刷新。

### 布局：表格 / 图表 50% 分割

- 表格与柱状图默认各占视图高度约 50%，中间有一条**可拖动分割线**（上下拖动调整比例，范围 20%–80%）。
- 持仓较多时表格与柱状图各自内部滚动，柱状图不会再被推到页面底部看不到。
- 分割比例持久化到 localStorage `vela-dashboard-holdings-split-v1`。

## 持久化

- 持仓数据 `Holding[]` 存 localStorage `vela-dashboard-holdings-v1`，变更即保存。
- 汇率设置存 `vela-dashboard-holdings-rate-v1`（mode / manual / lastAuto），自动模式缓存最近值。
- 计价单位存 `vela-dashboard-holdings-currency-v1`（`"USDT"` / `"RMB"`）。
- 表格 / 图表分割比例存 `vela-dashboard-holdings-split-v1`。

## 已确认决策

- [x] 汇率来源：C 混合 — CoinGecko 自动 + 手动兜底（用户指定接口）。
- [x] 默认视图：打开仍显示 K 线大屏，侧栏顶部固定「💼 功能模块」入口，点击后才显示持仓表；点击普通分组 / 自选币种 / 持仓视图空白回到 K 线网格。
- [x] Logo 方案：A 本地内置（495 个币）+ 文本徽标兜底。

## 桌面版迁移

- 桌面版（Electron）持久化迁移 IndexedDB，见 docs/plans/persistence.md；`holdings.ts` 的 localStorage 读写集中在模块顶部私有函数中，迁移时只需替换 `loadHoldings` / `saveHoldings` / `loadRateConfig` / `saveRateConfig` / `loadCurrency` / `saveCurrency`。