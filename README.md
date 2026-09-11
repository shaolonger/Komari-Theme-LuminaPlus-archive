# Aster · 星枢

面向 Komari 的服务器监控与资产管理主题，由 shaolonger 独立维护。围绕节点总览、VPS 工作台、多目标 Ping 分析、节点比较和 3D 舰队视图，重构界面与交互体验。

## 安装与迁移

- 主题仓库：<https://github.com/shaolonger/Komari-Theme-Aster>
- 在 [Releases](https://github.com/shaolonger/Komari-Theme-Aster/releases/latest) 下载 `Komari-Theme-Aster-v*.zip`，通过 Komari 后台上传并启用。
- 从旧主题迁移时，先记录原主题配置，再添加新仓库或上传 Aster 包；后端可能按主题名称分别存储配置，启用后请检查并恢复设置。
- v1.26.0 起使用 Aster 品牌并延续原版本序列。浏览器中的工作台展开偏好会自动继承。

## 后端兼容性

主题会自动识别官方 Komari 与既有二次修改版的 RPC 能力，并将两者归一化为同一套页面数据模型。有关适配范围、迁移注意事项、指标与 Ping 的处理方式，以及完整的验证命令，请见 [兼容性说明](COMPATIBILITY.md)。

## 效果预览

<p align="center">
  <img src="docs/images/theme-preview.png" alt="Komari-Theme-Aster 综合预览" width="90%">
</p>

### 首页总览与节点卡片

首页总览新增文字评级，节点卡片同步优化流量额度、在线时长与布局密度；支持背景图与卡片透明度调节。

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-solid.png" alt="首页总览与大卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-solid-dark.png" alt="首页总览与大卡片夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-solid.png" alt="首页总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-solid-dark.png" alt="首页总览与小卡片夜间模式" width="70%">
</p>

### 透明背景

背景图与卡片透明度可在主题管理中配置，支持大卡片、小卡片和移动端布局。

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-glass.png" alt="透明背景首页总览与大卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-glass-dark.png" alt="透明背景首页总览与大卡片夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-glass.png" alt="透明背景首页总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-glass-dark.png" alt="透明背景首页总览与小卡片夜间模式" width="70%">
</p>

### 实例详情

实例详情页优化 Ping 与负载图表展示，支持断点连线、手动刷新和更稳定的图表尺寸。

<p align="center">
  <img src="docs/images/v1.1.9/instance-ping.png" alt="实例详情 Ping 图表" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/instance-ping-dark.png" alt="实例详情 Ping 图表夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/instance-load.png" alt="实例详情负载图表" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/instance-load-dark.png" alt="实例详情负载图表夜间模式" width="70%">
</p>

### 移动端

移动端总览卡片采用更紧凑的信息展示，保留评级和关键指标。

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-solid.png" alt="移动端总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-solid-dark.png" alt="移动端总览与小卡片夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-glass.png" alt="移动端透明背景总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-glass-dark.png" alt="移动端透明背景总览与小卡片夜间模式" width="70%">
</p>

### 资产统计

资产统计界面重做，整合入口、指标、明细排序与汇率信息。

<p align="center">
  <img src="docs/images/v1.1.7/asset-summary.png" alt="资产统计" width="70%">
</p>

### 主题管理

主题管理新增总览评级配置，并加入小卡片在线时间、资产统计等显示项开关。

<p align="center">
  <img src="docs/images/v1.1.7/settings-overview.png" alt="总览评级配置" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.7/settings-card-cost.png" alt="小卡片与资产统计配置" width="70%">
</p>

### 离线状态

离线节点保持清晰的状态提示，同时保留最近一次上报的关键指标。

<p align="center">
  <img src="docs/images/v1.1.7/offline-card.png" alt="离线节点状态" width="70%">
</p>

## 来源与致谢

本项目最初基于 [shanyang242/Komari-Theme-LuminaPlus](https://github.com/shanyang242/Komari-Theme-LuminaPlus) 修改，现以 Aster 品牌持续开发。感谢 shark、shanyang 及原项目贡献者的工作；更名保留原有贡献历史与来源说明。

特别感谢 [stqfdyr/komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina)。

也感谢 Komari 官方主题、Mochi、PurCarte 等主题项目为 Komari 生态提供的设计和实现思路。

## 参考

- [Komari](https://github.com/komari-monitor/komari)
- [komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina)
- [Komari 主题开发文档](https://komari-document.pages.dev/)

## Star History

<a href="https://www.star-history.com/?repos=shaolonger%2FKomari-Theme-Aster&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=shaolonger/Komari-Theme-Aster&type=timeline&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=shaolonger/Komari-Theme-Aster&type=timeline&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=shaolonger/Komari-Theme-Aster&type=timeline&legend=bottom-right" />
 </picture>
</a>
