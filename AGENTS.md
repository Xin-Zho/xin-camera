# AGENTS.md — xin-camera 通用协作约定

> 所有参与本项目的 coding agent 在开始前必须读完本文件 + `docs/prototype-spec.md`。

## 项目定位

iPhone 回忆 App 的**第一阶段可交互原型**。用 React Native + Expo + TypeScript，
在 Windows 上开发，iPhone 上用 Expo Go 预览。验证四件事：

1. 真实地图 + 竖向时间轴浏览回忆
2. 地点 → 到访卡片堆叠 → 媒体图库这条链路
3. 杂志式故事相册与基础编辑
4. 合并 / 拆分 / 删除的语义正确（只改展示，不动底层数据）

**不做的**：真实照片库权限、真实 GPS、后台扫描、云同步、账号后端、AI 重绘、
媒体文件拷贝、正式备份导出、Android 适配、真实 iOS 后台任务。

当前所有数据都是 `src/data/**` 里的 mock，不要假装自动识别已实现。

## 权威文件（只有集成负责人能改）

| 文件 | 作用 |
| --- | --- |
| `package.json` / `app.json` / `tsconfig.json` | 依赖与版本，**禁止子 agent 自行修改** |
| `src/domain/types.ts` | 全局数据类型，唯一真源 |
| `src/store/appStore.ts` | 共享状态与 action |
| `app/_layout.tsx`、`app/(tabs)/_layout.tsx` | 全局路由骨架 |
| `src/theme/**` | 设计 token |

需要改以上文件时，先提交变更建议，由集成负责人统一落地。
如果不确定两个 agent 的类型定义是否一致，以 `src/domain/types.ts` 为准。

## 依赖与版本策略

项目**已经初始化完成**（2026-10-25），不要再跑 `create-expo-app`，否则会覆盖现有 `app/` 与 `src/`。

- 当前基线：Expo SDK 58.0.19 · React Native 0.88 · React 19.3 · TypeScript 6 · expo-router 58 · react-native-maps 1.29.11 · zustand 5
- 日常启动：`cd D:\xin-camera && npx expo start`（iPhone 与电脑同一 Wi-Fi，Expo Go 扫码）
- 手机上的 Expo Go 必须支持 SDK 58，否则提示版本不兼容。

- 一律用 `npx expo install` 装 Expo 相关包，让 SDK 决定兼容版本。
- 不要硬编码版本号，不要 `npm install xxx@x.y.z`。
- 地图先用 Apple Maps provider，不引入付费地图 API。
- 状态管理统一 Zustand；持久化原型阶段可只用内存，需要验证重启保留时再上 AsyncStorage。
- 竖向时间轴用 `PanResponder`（或项目已装且兼容 Expo 的手势库）自实现，**不要假定 Slider 能满足**。

## 页面与职责

```text
App
├── 地图（默认首页）→ 设置（右上角）
│   ├── 右侧半透明时间轴
│   ├── 地点标记 / 聚合标记
│   ├── place/[placeId]  到访卡片堆叠
│   └── visit/[visitId]  照片与视频图库
├── 故事相册
│   ├── story/[storyId]        杂志阅读页
│   └── story/edit/[storyId]   编辑页
└── settings
```

- 页面之间**只传 ID**，对象一律从 store 读，不要把整个 Story 塞进路由参数。
- 业务逻辑不要写进页面文件，下沉到 `src/features/**` 与 `src/domain/**`。

## 分工边界（各 agent 只动自己的目录）

| Agent | 目录 | 产出 |
| --- | --- | --- |
| 0 集成负责人 | 全局类型 / store / 路由 / 主题 / package.json | 可运行的骨架 + 接口冻结 |
| 1 地图与时间轴 | `src/features/map/**`、`src/components/map/**`、`src/components/timeline/**` | 地图可独立跑，拖时间轴改变共享 `TimeRange` |
| 2 地点与到访 | `src/components/place/**`、`src/components/visit/**`、`app/place/**`、`app/visit/**` | 地点 → 堆叠 → 图库链路通 |
| 3 故事相册与编辑 | `src/features/stories/**`、`src/components/story/**`、`app/story/**` | 列表 / 阅读 / 编辑 / 合并拆分删除 |
| 4 数据与视觉组件 | `src/data/**`、`src/theme/**`、`src/components/common/**` | ID 自洽的 mock 数据 + 可复用 token |
| 5 测试验收 | `docs/qa/**` | 按 `docs/prototype-spec.md` §12 打勾，记录问题 |

## 交付要求

每个 agent 完成时给出：
1. 修改/新增文件清单
2. 对外 props、回调、action 的接口说明
3. 运行与自测方式
4. 未完成事项与已知限制

**不要声称没实际跑过的功能通过。** 没有验证过的 iOS 原生能力不要写成"已实现"。

## 已定案的核心规则

**故事粒度：一次到访 = 一本故事。** 不按地点聚合。同一地点去过三次 →
故事相册里三本独立故事。连带要求：

- 自动生成时 `story.visitIds = [visit.id]`，1:1；
- 默认标题 `地点名称 · 到访日期`，可编辑；
- 地图上仍然每个 Place 只有一个标记（故事粒度不影响地图层）；
- 合并是这个模型下主要的整理手段，且必须可逆（`mergedFromStoryIds` +
  `mergeSnapshot`）；
- 禁止为了"整齐"悄悄把同地点多本自动合并。

详见 `docs/prototype-spec.md` §7.2。

## 当前待验证的规则（先用常量或 mock 顶住，不要阻塞）

1. 同一地点两次到访的分界阈值（初定 ~4 小时，未定案）——只决定"切成几本"，
   不改变"一次到访一本"的结论
2. 聚合标记的像素阈值、时间轴手势灵敏度（需 iPhone 实测）
3. 真实地点名解析、GPS 容差、无 GPS 照片处理（第二阶段）
