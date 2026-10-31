# xin-camera · 回忆相册

把 iPhone 相册里的照片，按**拍摄地点 + 拍摄日期**重新组织成「回忆地图」和「故事相册」。
不做同步、不做备份、不做社交——只做一件事：让几年前那次旅行的照片，重新变成一次旅行。

- **技术栈**：Expo SDK 58 · React Native 0.88 · React 19 · TypeScript · Expo Router · react-native-maps · Zustand
- **形态**：iPhone 优先的可交互原型，Windows 上开发，真机用 Expo Go 预览
- **数据**：全部本地。相册**只读**，照片不进任何服务器；**没有后端、没有账号、没有云同步、没有 AI 调用**

<p align="left">
  <img alt="platform" src="https://img.shields.io/badge/platform-iOS%20(Expo%20Go)-blue" />
  <img alt="sdk" src="https://img.shields.io/badge/Expo-SDK%2058-000" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

## 目录

- [跑起来](#跑起来)
- [功能一览](#功能一览)
- [视觉体系](#视觉体系)
- [架构与目录](#架构与目录)
- [核心口径](#核心口径)
- [里程碑](#里程碑)
- [已知限制](#已知限制)
- [文档](#文档)

## 跑起来

```powershell
cd D:\xin-camera
npm install
npx expo start
```

iPhone 与电脑连同一个 Wi-Fi，用 Expo Go 扫终端二维码；扫不到就把终端里 `exp://<局域网 IP>:8081` 手输进 Expo Go。

> 本项目是 **Expo SDK 58**，手机上的 Expo Go 必须支持同一 SDK，否则会提示版本不兼容。
> Web 端只验证过打包（`npx expo export`），**地图在 Web 上不可用**（react-native-maps 无 Web 实现），
> 且当前 `react-native-web 0.21.4` 与 gesture-handler 存在 `codegenNativeComponent` 兼容问题，网页渲染不做承诺。

## 功能一览

| 模块 | 能做什么 |
|---|---|
| **地图** | 按地点聚合成标记；竖向时间轴按日/月/年切换时间窗口；拖动轴看那一段的回忆；点标记放大或列出重合地点 |
| **地点页** | 该地点的所有到访，卡片堆叠，左右滑动切换 |
| **到访图库** | 那一次到访的照片墙（近无缝 3 列）；多选「从回忆相册移除」；已移除区逐张恢复 |
| **图库 tab** | 全量照片墙，按月分组，点开即全屏查看器，可跨月连续翻页 |
| **照片查看器** | 纯黑全屏、横向翻页、点按隐藏栏位、下拉关闭；原图 → 缩略图 → 占位的降级链 |
| **故事** | 杂志/手账式阅读页；编辑标题、封面、照片顺序、重点照片、模板、正文；合并 / 拆分 / 软删除 / 恢复 |
| **导入** | 从系统相册导入真实照片，自动切分地点与到访、生成故事；重复导入不重复生成 |
| **回收站 / 设置** | 已移除照片集中恢复；存档健康状态、隔离备份、重置存档 |
| **自愈** | 旧版本导入的照片（临时路径失效）启动时静默重建沙盒原图与缩略图，不需要重新导入 |

导入规则里会改变用户认知的几条：

- **有定位**：80 m 内并入既有导入地点，否则新建（地点名 `未命名地点 N`，没做逆地理编码）。
- **无定位**：统一收进「未定位」，不参与距离匹配，不在地图上出现，但照片和故事照看。
- **到访切分**：同地点 + 同归属日 + 间隔 ≤ 4 小时算一次到访；`dateKey` 优先于间隔（跨午夜必分开）。
- **不覆盖用户编辑**：改过 / 删了 / 合并了的故事一律另起一本，不往里塞。
- **去重键**是 `libraryAssetId`：重导不会产生重复数据，也不会让已移除的照片复活。

## 视觉体系

### 界面层：FluxTie / MD3

整体风格参照 [FluxTie](https://github.com/makise2060/FluxTie)（Kotlin + Compose 贴吧客户端）：
浅灰蓝底 + 白色大圆角卡片 + **hairline 定形、不用阴影** + 悬浮毛玻璃胶囊 Dock。

色板由 `material-color-utilities` 以种子色 `#2196F3` 走 TonalSpot 生成，落在 `src/theme/colors.ts`：
`background #F4F3F7`（neutral 96）、`surface #FFFFFF`、`textPrimary #1A1C1E`、`textSecondary #45474A`、
`accent #0061A4`、`accentContainer #D1E4FF`、`separator #DFE2EB`。

两条硬约束：

1. **页面里不写裸十六进制**，一律取语义 token；
2. **卡片不靠阴影分层**，靠底色差 + 1px hairline。阴影只留给真正离地的东西（地图钉、悬浮 Dock）。

### 阅读页：旅行手账

故事阅读页刻意脱离上面那套界面语言——它不是 App 的一屏，它是**一本贴好的相册**：

| 元素 | 取值 / 做法 |
|---|---|
| 纸底 | `paper #F3EDDF` + 128px 无缝纸纹（`assets/images/paper-texture.png`，纯 Node 生成的 ±3 噪声） |
| 相纸 | `paperCard #FDFBF4`，`FRAME_PAD 10 / FRAME_BOTTOM 32` 的拍立得白框，hairline 描边 |
| 固定方式 | 大图用**和纸胶带**（`tape`，超出相纸边缘、-5°/+4°），小图用**牛皮纸相角**（`cornerMount`） |
| 墨色 | `paperInk #46403A` 正文 / `paperInkSoft #8C8377` 贴图小字，中文楷体 |
| 唯一强色 | 印泥红 `stamp #B5502F`，只用在封面邮戳和「精选」贴纸 |
| 日期 | **只写一次**：换日在块上方起日期栏，相纸底标真实时刻；封面用邮戳压日期 |

`editorial`（默认模板）走手账渲染；`grid` / `large-cover` 两个模板保留原来的杂志式观感，样式互不污染。

### 排版规划层

阅读页的照片排布不是渲染时临时算的，而是先过一个**纯函数规划层** `src/domain/magazine.ts`：
输入可见照片与星标，输出块序列 `pair（错位双图，左右镜像交替）/ solo（hero 重点 · medium 呼吸位 · panorama 全景）/ closing（收尾）`。

七条可单独验收的硬规则：封面单独口径不进正文、每张正文照片**恰好一次**、用户排序原样保留、
同一输入必得同一布局（无随机/无时间）、星标优先独幅重点、照片少就精简不重复、
规划层不编造任何文案。像素尺寸不进规划层——渲染层用 `PAIR_RATIOS 0.56/0.38` 等常量自算。

## 架构与目录

```text
app/
├── _layout.tsx                      根导航（存档水合 → 老存档自愈 → 渲染）
├── (tabs)/_layout.tsx               自绘悬浮 Dock：地图 / 图库 / 故事
├── (tabs)/map.tsx                   地图 + 时间轴 + 标记
├── (tabs)/photos.tsx                图库照片墙（按月 SectionList + 查看器）
├── (tabs)/stories.tsx               故事列表（合并 / 拆分 / 删除 / 恢复）
├── place/[placeId].tsx              地点页：到访卡片堆叠
├── visit/[visitId].tsx              到访图库（多选移除 / 恢复 / 查看器入口）
├── story/[storyId]/index.tsx        故事阅读页（手账 / 经典两套渲染）
├── story/[storyId]/edit.tsx         故事编辑页
├── library/                        真实相册：读取 / 单资产原始字段 / 日期口径验证
├── removed.tsx                      App 内回收站
├── quarantine.tsx                   隔离存档查看
└── settings.tsx                     存档健康、相册入口、重置
src/
├── domain/                          纯业务逻辑
│   ├── types.ts                     全局类型（唯一真源）
│   ├── visibility.ts                照片可见性判定（唯一入口）
│   ├── timeline.ts                  时间刻度与窗口
│   ├── clustering.ts                地图聚合（像素距离）
│   └── magazine.ts                  阅读页排版规划层
├── library/                         相册读取与导入
│   ├── reader.ts                    权限 / 分页 / 缩略图 / 持久化 / 修复
│   ├── importPlan.ts                导入规划（合并地点 / 切分到访 / 去重）
│   ├── dateRule.ts                  日期归属判定
│   ├── exif.ts · epoch.ts           EXIF 时间字段 / 时间戳单位
│   ├── repair.ts                    老存档媒体源自愈
│   └── concurrency.ts               并发受限的批量任务
├── store/                           Zustand store + AsyncStorage 存档 + 派生 selector
├── components/                      map / place / story / timeline / viewer / common
├── theme/                           颜色、间距、字体 token
└── utils/                           日期格式化、等比缩放
```

分层原则：**能写成纯函数的都写成纯函数**。日期口径、导入规划、可见性、聚合、时间轴几何、排版规划
全部不依赖 React，可以在 Node 里用真实数据直接断言；页面只负责取数、量尺寸、画。

## 核心口径

### 照片可见性

「这张照片还该不该显示」只有一个答案，在 `src/domain/visibility.ts`。判定顺序不可交换：

| 顺序 | 条件 | 结果 |
|---|---|---|
| 1 | `media.removedAt` 有值 | 隐藏。**用户移除优先于一切** |
| 2 | 被至少一本活跃故事引用 | 显示 |
| 3 | 引用它的故事都删了 / 都并走了 | 隐藏（`story-deleted`） |
| 4 | 没有任何故事引用 | 隐藏（`unlinked`，脏数据不外露） |

由此得到的联动不需要额外代码：删故事 → 独占照片隐藏、地图标记消失、时间轴收缩，被共用的照片照常显示；
恢复故事 → 全部回来。移除只写 `removedAt`，**不动** `story.mediaIds`，所以恢复时顺序、封面、精选标记原样回来。

### 日期归属

**照片按拍摄地日期分组，不是按当前所在地日期。** 三个来源按可靠性取第一个可用：

1. EXIF 声明偏移（`OffsetTimeOriginal`）→ 叠加在 `creationTime` 上算日；
2. EXIF `DateTimeOriginal` 的日期部分（相机写的当地墙上时间）；
3. 都没有 → 回退设备时区，来源标 `device-tz`，界面**不伪装成准确值**。

关键判据是**反推偏移** `wallClockAsUtcMs(DateTimeOriginal) - creationTime`：若一张海外照片的反推偏移等于设备偏移，
说明系统把墙上时间当设备时区解释了——这是必须知道的坏消息。反推值落在 15 分钟粒度上才算现实时区。

判定结果在**导入时固定**写入 `dateKey`（`YYYY-MM-DD`）与 `dateSource`，展示层只读 `dateKey`。
不在渲染时重推，是为了避免「回国后同一批靠兜底的照片整体换天」。

### 时间轴几何

刻度和滑块以前用三套坐标（百分比 + 负 margin + translateY），真机表现是底部对齐、越往上越偏。
现在只认 `src/components/timeline/railGeometry.ts`：起点 = 顶部内缩、终点 = 底部内缩、
有效高度 = 高度 − 2 × 内缩，**一律像素**。百分比的解析盒在原生（内容盒）和 Web（padding 盒）不一样，这就是偏 32px 的来源。

时间窗口只由**当前有效照片的归属日**决定，粒度跟跨度走：≤31 天按日、≤24 个月按月、更长按年。

### 地图聚合

判据是屏幕上两个标记的**像素距离**（`CLUSTER_RADIUS_PX = 52`），不是经纬度阈值——放大到一定程度自然散开，
不需要维护「缩放级别」状态。聚合标记只显示地点数量，不叠加到访数。点击时能放大就放大到成员占视口 62%，
放大也分不开（坐标几乎重合或已到下限）就弹地点列表；「能否分开」是用同一套聚合函数模拟得出，不是另写阈值。

### 手势与动画

**不碰 worklet。** 早期 `useAnimatedStyle` 的一个写法让 Expo Go 一加载就原生崩溃，此后查看器、下拉关闭、
按压反馈全部走 Gesture Handler 的 JS 线程回调 + RN Animated（`useNativeDriver: false`）。
查看器的纵向 Pan 用 `activeOffsetY ±12` 激活、`failOffsetX ±16` 让位给横向翻页，仲裁交给 GH，不自己写判定。

### 持久化

四层一起存（`stories` / `places` / `visits` / `media`），键 `xin-camera-store`，`STORE_VERSION = 2`。

- **进存档**：四层全量，含 `isDeleted`、`mergedFromStoryIds`、`mergeSnapshot`、`removedAt`、`dateKey`。
- **不进存档**：`timeRange`、`selectedPlaceId`、`mapFocus` 等瞬态 UI 状态——重启回到「最近一次回忆所在月份」更符合预期。
- **结构校验**：每层各过一个 `isValidX`，任一层不合格就整层丢弃；启动等 `hasHydrated()` 再渲染路由，避免旧标题闪一帧。
- **坏存档不覆盖**：JSON 非法时先把**原始文本**抄到 `xin-camera-store__quarantine` 再回退示例数据，
  否则下一帧 persist 就会把用户攒的编辑写成一份新的示例 JSON。
- 存档目前是**全量覆盖写、无节流**，示例规模无所谓，导入几千张后要改成只写变动或加 debounce。

## 里程碑

- [x] M1 在 iPhone 上跑起来（Expo SDK 58 脚手架）
- [x] M2 共享类型 + 示例数据 + store + 双 tab
- [x] M3 地图 + 竖向时间轴 + 标记与时段联动
- [x] M4 地点到访堆叠 + 图库
- [x] M5 故事列表 / 阅读页 / 编辑页
- [x] M6 合并 / 拆分 / 删除入口 + 标记聚合
- [x] M7 按规格逐条验收回归
- [x] M8 故事层本地持久化
- [x] M9 真实相册读取（权限 / 分页 / 原始时间与定位）
- [x] M10 日期归属口径（EXIF 偏移 → DateTimeOriginal → 设备时区）
- [x] M11 照片导入（地点 / 到访生成、去重、不覆盖编辑）
- [x] M12 照片可见性统一（移除 / 删除 / 恢复联动时间轴与地图）
- [x] M13 时间轴几何统一（刻度 / 滑块 / 拖动共用一套像素坐标）
- [x] 视觉审查两轮：地图首页 HIG 五透镜（`docs/v7`）、对照 Ente Photos 源码的前端审查（`docs/v8`）
- [x] M16 导入媒体持久化（沙盒原图 + 600px 缩略图，不再依赖临时目录）
- [x] M17 全屏照片查看器（翻页 / 点按隐栏 / 下拉关闭 / 图源降级）
- [x] M18 图库 tab 全量照片墙 + 老存档媒体自愈
- [x] UI 体系切换：FluxTie 参照 + MD3 tonal 色板、hairline 定形、悬浮毛玻璃 Dock
- [x] M20 「留白摄影杂志」阅读页 + 排版规划层
- [x] M21 手账化改造（米纸 / 相纸 / 胶带与相角 / 邮戳 / 纸纹）
- [ ] M19 导航重构（Dock 之外的信息架构整理）— 计划中

> 当前工作区状态：M16–M21 的代码与断言已完成，**部分观感项待真机确认**
> （楷体渲染、相角三角、纸纹强度、相纸投影深浅、Dock 模糊质感）。

## 已知限制

**产品层面**

- 合并只有一步到位的「合并」，没有 undo 栈；拆分会丢弃合并后在合集里做的修改（弹窗已说明）。
- 时间轴粒度整条统一（全按日 / 全按月 / 全按年），没有「远处按年、近处按日」的混合刻度。
- 聚合半径固定 52px，不随疏密自适应；地点重合只给列表，不做「蜘蛛网」散开。
- 照片排序用上下箭头，不是拖拽；合集标题自动生成，不能直接输入。
- 图库多选移除没有「全选」，也不能跨到访批量操作；移除没有 undo 条，只能去回收站点回来。
- 恢复照片时若原故事已删除，照片回到数据里但仍不可见，界面不会提示「先恢复故事」。
- 地图空状态没有「导入照片」直达入口（要绕到故事页 → 相册）。
- iPad 分屏未验证：卡片堆和到访图库的格子尺寸用了模块级 `Dimensions`。

**技术 / 平台**

- 缩略图会触发 iCloud 下载（`isNetworkAccessAllowed` 为 true），靠页大小 24 + 并发 3 + 手动翻页压着。
- 相册 API 不提供拍摄地时区；`getLocation()` 只有经纬度，时区只能从 EXIF 残留字段推。
- `creationTime` 类型注释写的是秒、实际是毫秒，处理方式是**原值照存 + 按量级判定单位**。
- `Query` 没有 count 接口，界面只显示「已加载 N 张」，不显示总数。
- 视频只做到「能识别、能看占位、不导入」，不算视频功能已验收。
- 导入阈值（80 m 地点半径、4 小时到访切分）是暂定值，没有实验标定。
- 取消导入不回滚已落库的部分，但重跑会按 `libraryAssetId` 判重。
- 切换设备时区后，**示例数据**仍按设备时区分组（它们没有 `dateKey`）。
- 时间轴几何只有数值断言，真机渲染一致性仍需人工确认。
- Web 端不可用（地图无实现 + RNW/gesture-handler 兼容问题），只验证打包。

## 文档

`docs/` 里是每个阶段的事实记录与口径决策，写代码前先读对应那份：

| 文档 | 内容 |
|---|---|
| `prototype-spec.md` | 第一阶段统一交接规格：产品范围、数据模型、验收标准 |
| `v1-acceptance.md` | 第一版逐条验收结果、修复清单、遗留项 |
| `v2-photo-library.md` | 真实相册读取的能力矩阵与实际行为核对（时间单位、时区、分页、权限） |
| `v3-date-rule.md` | 日期归属：来源优先级、反推偏移、时区反查的判定规则 |
| `v4-import.md` | 导入：切分与去重规则、不覆盖用户编辑、归属日固定、存档 v2 |
| `v5-visibility.md` | 可见性：删故事 / 移除照片的共同判定、时间轴动态范围、恢复路径 |
| `v6-rail-geometry.md` | 时间轴几何：三套坐标的根因分析与统一方案 |
| `v7-map-design-review.md` | 地图首页 HIG 审查：对比度红线、拖动反馈、VoiceOver 标注 |
| `v8-ente-design-review.md` | 对照 Ente Photos 源码的前端视觉审查与实施记录 |
| `AGENTS.md` | 多 agent 协作约定（权威文件、分工边界、版本策略） |

纯函数层的断言脚本不进仓库（属一次性校验工具）：日期口径、导入规划、可见性、时间轴几何、排版规划
各有独立套件，约 1800 条，每轮改动全量重跑；运行需要 Node 22 的 `--experimental-strip-types` 加自定义 loader
（补 `@/` 别名、把 `data/mediaSource` 的 `require(*.jpg)`、AsyncStorage、`expo` 原生模块换成桩）。

## License

MIT
