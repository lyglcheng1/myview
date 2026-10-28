# 本地持久化设计

## 存储内容

1. **收藏分组**：`WatchGroup[]`（见 docs/plans/watchlist.md）。
2. **布局配置**：格子数、每格币种 / 周期、当前激活布局（见 docs/plans/grid-layout.md）。
3. **告警配置**：`Alert[]`（见 docs/plans/alerts.md）。
4. **EMA 均线配置**：启用状态、颜色、周期值、顺序（当前全局生效，见 docs/plans/watchlist.md 的设置弹窗说明）。
5. **Pine 脚本列表**：`{ name, code }[]`（见 docs/plans/pine-scripting.md）。
6. **其它设置**：主题、告警声音选择、自定义声音、告警排序、持仓盈亏数据（见 docs/plans/holdings.md）。

## 存储方案：IndexedDB

- 数据量小、结构简单，但需要事务与版本迁移，选择 IndexedDB。
- 封装轻量存储模块 `playground/idbStorage.ts`，提供与 `localStorage` 相同的同步 `getItem` / `setItem` / `removeItem` 接口，避免散落的键。
- 模块位置说明：桌面版渲染进程就是 playground dashboard 页面（`desktop/vite.renderer.config.mts` 直接构建 `playground/dashboard.html`），因此存储模块放在 `playground/`，供浏览器与桌面版共用。

## Schema

库名：`vela-dashboard`，版本 1。

- 单个 object store `kv`：key = 原 localStorage 键名，value = JSON 字符串。
- 键名保持稳定（与原型 localStorage 键一致），迁移与回退简单，新增数据无需升级版本。

| 数据 | key |
|------|-----|
| 自选分组 | `vela-dashboard-watchlist` |
| 布局配置 | `vela-dashboard-layouts` |
| 告警 | `vela-dashboard-alerts` |
| EMA 配置 | `vela-dashboard-ema-config-v2` |
| Pine 脚本 | `vela-dashboard-pine-scripts` |
| 主题 | `vela-dashboard-theme` |
| 告警声音选择 | `vela-dashboard-alert-sound` |
| 自定义声音 | `vela-dashboard-alert-sound-custom` |
| 告警排序偏好 | `vela-dashboard-alert-sort` |
| 持仓 / 汇率 / 币种 / 分栏 | `vela-dashboard-holdings-*`（4 个键） |

## 读写模型

dashboard 在模块加载时同步初始化数据（`let groups = loadGroups()`），而 IndexedDB 只有异步接口，因此采用「内存缓存 + 写穿透」模型：

- **读**：先读缓存；IndexedDB 水合完成前回退到同步镜像（localStorage）。
- **写**：同时写缓存、localStorage 镜像和 IndexedDB（写穿透，异步落库）。
- **水合**：启动时把 IndexedDB 读入缓存，并把 localStorage 里尚不存在的数据迁移进 IndexedDB；若 IndexedDB 有数据而 localStorage 缺失（如被清除），则回写 localStorage。
- 水合完成后缓存以 IndexedDB 为准；`onHydrated` 回调让 dashboard 重新加载数据并渲染，保证持久副本优先。

## 版本迁移

- IndexedDB version 管理（`onupgradeneeded`），每次结构变更递增版本。
- IndexedDB 不可用 / 损坏时回退到 localStorage 镜像继续工作，不阻塞页面。

## 写入策略

- 收藏 / 告警 / 脚本 / EMA / 声音 / 主题等变更立即写入（用户可感知的操作）。
- 布局变更在保存动作时写入；拖动 / 切换时按现有行为写入。
- 启动时读取，失败则使用默认值（1 格 BTCUSDT / 15m）。

## 与 Vela 自带持久化的关系

- VelaWorkspace 本身支持 `persist`（`playground/persistence.ts`，localStorage `vela-play:` 前缀保存图表样式 / 指标 / 绘图）。
- 项目级数据（收藏、布局、告警、脚本、EMA 配置、持仓）与图表样式数据分离存储，互不覆盖；`vela-play:*` 键不在迁移范围内。