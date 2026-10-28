# 交易计划设计

## 需求

在「功能模块」面板中提供 **交易计划**：把当前 K 线图表的画线状态（含图表截图）转成 Markdown 交易计划，用户填写目标价、入场理由、退出底线，保存后可随时回看、编辑、删除。计划与图片分开存储，让 markdown 保持紧凑。

## 当前状态（已实现，playground / 桌面渲染层）

### 数据结构

- 计划 id 遵循 `YYYYMMDD-ticker-name`（如 `20261026-BTCUSDT-BTC`），同日重复追加 `-2` / `-3` 后缀。
- `TradePlan`：`{ id, createdAt, updatedAt, ticker, name, markdown }`。
- `ticker` 为币安交易对（如 `BTCUSDT`），`name` 为基础币（`BTC`）。

### 新建流程

- 点击「＋ 用当前图表新建」：读取当前活动格子（`getActiveChart`）的 `ticker` / 名称 / 图表截图（`cell.chart.renderer.screenshot()`，含画线），生成模板 `目标 / 入场理由 / 退出底线` 并预填截图引用，立即进入编辑态。
- 当前没有选中格子时提示用户先在大屏选中币种。

### 图片存储

- 截图 / 粘贴 / 拖拽图片统一转为 data URL 存入独立 IndexedDB 数据库 `vela-dashboard-trade-plan-images`，返回短 id；markdown 里只出现 `![...](vela-img://<id>)`。
- 渲染时把 `vela-img://` 占位符替换回 data URL（`resolveImageSrcs`）；缩略图懒加载。
- 删除计划时顺带清理不再被任何计划引用的孤儿图片。

### 编辑器

- 分栏布局：左 Markdown 源码，右实时预览，中间分隔线可拖动调整宽度。
- 工具栏：加粗 / 斜体 / 删除线 / 标题 / 引用 / 列表 / 行内代码 / 代码块 / 链接 / 分割线 / 表格 / 插入图片。
- 支持在文本区直接粘贴图片（`Ctrl+V`）或拖拽图片文件。
- Markdown 渲染为安全子集：先 HTML 转义再渲染，链接只放行 `https://` 与 `data:image/`，杜绝 `javascript:` 注入。

### 列表与回看

- 计划列表按更新时间倒序，卡片显示缩略图、id、ticker + 名称、纯文本摘要。
- 支持按币种代码 / 名称 / 计划 id 搜索（不区分大小写），分页每页 10 条。
- 单击「编辑」进入编辑态；双击卡片进入只读视图（隐藏源码与工具栏，仅显示渲染后的计划）。

## 持久化

- 计划存 IndexedDB 数据库 `vela-dashboard-trade-plans`（localStorage 镜像 + IndexedDB 写穿由 dashboardStorage 统一处理）。
- 图片存独立数据库 `vela-dashboard-trade-plan-images`，与计划分离。

## 测试

- `test/trade-plan-format.test.ts`：id 生成、名称清洗、同日去重、时间戳格式化。
- `test/trade-plan-store.test.ts`：计划增删改查、最新在前、损坏记录容错。
- `test/trade-plan-images.test.ts`：图片保存 / 读取 / 删除、`extractImageIds` 去重。
- `test/trade-plan-markdown.test.ts`：Markdown 子集渲染、XSS 防护、纯文本摘要、首图提取。
- `test/trade-plan-paging.test.ts`：搜索与分页、页码钳制。
- `test/trade-plan-style.test.mjs`：`[hidden]` 优先级、功能入口接线、工具栏 / 分栏 / 只读视图。

## 边界

- 不修改 Vela core；截图走公开 seam `chart.renderer.screenshot()`。
- 计划与图片只存本机，不上传。
- 相关文档：持久化见 `docs/plans/persistence.md`。