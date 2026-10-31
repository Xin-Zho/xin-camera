# v8 · Ente Photos 参照下的前端视觉审查报告

日期：2026-10-26 · 基线：`33fe374` · 本轮范围：仅表现层，不动任何已验收逻辑

## 1. 研究材料清单（真实读过，非通用建议）

**Ente 源码（ente/ente main 分支，2026-10）**——仓库已重组，Photos UI 在 `mobile/apps/photos/lib/ui/`：

| 方向 | 文件 | 关键证据 |
|---|---|---|
| 照片墙 | `core/constants.dart` | `galleryGridSpacing = 1.0`，3–6 列 |
| 网格引擎 | `models/gallery/gallery_groups.dart` | 方形等宽格子；justified 行高 = (宽-1)/2 × 1.12 封顶 320 |
| 日期分组头 | `ui/viewer/gallery/component/group/group_header_widget.dart` | 14px/w500，水平 12/垂直 12；「今天/本周」全亮、历史日期 muted |
| 相册封面卡 | `ui/collections/album/row_item.dart` | 正方形封面，squircle 20/smoothing 0.6；标题 14 + 计数 12，间距 2 |
| 封面列表尺寸 | `ui/collections/album/horizontal_list.dart` | 封面边长自适应、每列上限 224，文字区固定 52 |
| 查看器 | `ui/viewer/file/detail_page.dart` | 纯黑背景；点按切换栏位 200ms 淡出；翻页 4× 速度；缩放时锁翻页 |
| 缩放手势 | `ui/viewer/file/zoomable_image.dart` | 未缩放时下拉 8px 关页、上拉开详情 sheet |
| 地图标记 | `ui/map/photo_map_marker.dart` | 64×64 圆角 13 照片钉 + 2px 白描边 + 5px 尖角 + 白底计数徽章 |
| 地图-相册衔接 | `ui/map/map_pull_up_gallery.dart` | DraggableScrollableSheet 25%/50%/80% 三档，4 列格距 4 |
| 多选 | `ui/viewer/gallery/component/gallery_file_widget.dart` | 长按 haptic；40% 黑遮罩 + 右上 16px 勾选圆（对勾镂空） |
| 缩略图圆角 | `gallery_file_widget.dart` | 网格缩略图圆角 **1px**（近无缝） |
| 主题 token | `packages/ui/lib/theme/colors.dart`、`packages/ente_components/lib/theme/text_styles.dart` | 亮底 #FAFAFA；textMuted = 60% 黑；body 14/w500、mini 12/w500 |

**产品文档**：ente.com/help/photos 的 Albums、Map and Location 页；**changelog**：v1.3.54（新设计系统）、v1.3.66（mosaic 布局/捏合列数/大封面相册/Hero 过渡）、v1.3.64（查看器 filmstrip）、v1.3.63（双击缩放到点按处）、v1.3.59（查看器与信息面板重设计）、v1.2.15（滑动多选）。

## 2. 明确不照搬的 Ente 设计（及原因）

1. **同步/备份角标、共享者头像、置顶/归档/验证锁徽章**——服务于云端多用户模型，本地到访相册只会加噪声。
2. **分组头吸顶 + 二分查找滚动联动、justified 行预计算**——为数十万张照片做的工程；本项目单视图照片量小，普通 section header 足够。
3. **4–6 列捏合变列**——海量照片扫视需求；本项目以地点/到访为叙事单元，固定 3 列利于封面故事性。
4. **绿色品牌色 `#08C225`**——只借鉴其「每 app 换 primary、结构 token 不变」的组织方式。
5. **照片查看器整页方案（filmstrip、下拉关页、上拉详情）**——方向正确，但当前 App **还没有照片查看器**，属于新功能，不在本轮表现层范围（已列入记录不改候选）。

## 3. 当前页面问题排序（对照 Ente，按影响 × 风险）

### P1 · 小字对比度不达标（可读性，残留最广）
- **现状**：P2 修了地点/卡片堆/图库三页，但故事列表页 5 处、故事阅读页 2 处、编辑页 4 处仍用 `textTertiary`（#9C9CA4，白底 ≈2.7:1）排 11–13pt 文本，低于 HIG 4.5:1。文件：`app/(tabs)/stories.tsx`（screenSub/groupHeader/deletedToggle/deletedMeta/actionHint）、`app/story/[storyId]/index.tsx`（kicker/footer）、`edit.tsx`（sectionLabel/mediaCount/hint/footer）。
- **参考**：Ente `textMuted` = 60% 黑 ≈ 4.6:1，历史日期用 muted 而非更淡的 faint——「弱化靠一档，不靠两档」。
- **建议**：非占位符文本统一升 `textSecondary`；输入框 placeholder 保留 textTertiary（平台惯例豁免）。
- **影响**：纯颜色 token 替换，零逻辑。验证：色值对比计算 + 真机可读性。

### P2 · 图库网格偏「卡片感」，照片不是主角
- **现状**：`app/visit/[visitId].tsx` GAP=3、瓦片圆角 `radius.sm`=4，三列瓦片各自成小卡片，与「照片墙」气质相反。
- **参考**：Ente 格距 1px、缩略图圆角 1px（`gallery_file_widget.dart`）；iOS 系统相册同为近无缝。
- **建议**：GAP 3→2、瓦片圆角 4→2（新增 `radius.xxs=2` token）；选中环同步。
- **影响**：TILE 由公式自动重算；选中环覆盖层机制不变（P2 修复的「不跳动」保住）。验证：多选选中态 + 已移除区回归。

### P3 · 图库分组头字级偏弱
- **现状**：sectionLabel 用 caption2（11px）+ letterSpacing 0.8——那是拉丁大写小标签的做法，中文下信息量弱。
- **参考**：Ente 分组头 14px/w500（`group_header_widget.dart`）。
- **建议**：升 footnote（13px）+ w600，去 letterSpacing。
- **影响**：纯样式。验证：真机层级感。

### P4 · 故事封面标题与照片争夺主角
- **现状**：`StoryCoverCard` below 模式标题用 title2（22px/700）压在 3:4 大封面下方，字比照片抢眼。
- **参考**：Ente 大封面相册卡标题实际只有 14px/w500（`row_item.dart`），照片主导；Apple「回忆」卡也约 15–17pt。
- **建议**：belowTitle 降为 headline（17px/600）。overlay 模式不动（叠字场景大字保可读）。
- **影响**：故事列表页 P2 未验收过，无锁定。验证：封面列表整体观感。

### P5 · 卡片堆装饰性文字噪声
- **现状**：`VisitCardStack` 常驻「轻点进入图库」白胶囊压在照片右上角，pagerHint 一行「1 / 3 次到访 · 左右滑动切换」。
- **参考**：Ente/系统相册没有任何「如何操作」常驻提示——可发现性靠交互本身。
- **建议**：删 openHint；pagerHint 精简为「1 / 3」。
- **影响**：删除纯展示节点，卡片堆 P2 验收点（scrim、按压反馈）不涉及。验证：滑卡翻页正常。

### 记录不改（后续候选）
- **照片查看器缺失**：图库非选择态点瓦片无动作（`onPress` 为 undefined）。这是功能缺口，Ente 的查看器原则（纯黑、点按隐栏、下拉关页）留作 M16 候选。
- **卡片堆 scrim 浓度、杂志阅读页版式**：P2 已验收 / 用户明确保留，不动。
- **地图标记、80m 聚合、时间轴**：已验收锁定。

## 4. 第一组实施记录（本轮已落地）

| # | 修改 | 文件 |
|---|---|---|
| 1 | 11 处非占位符 textTertiary→textSecondary | stories.tsx / story index.tsx / edit.tsx |
| 2 | 图库 GAP 3→2、瓦片圆角 4→2、新增 `radius.xxs` | visit/[visitId].tsx、theme/spacing.ts |
| 3 | 图库 sectionLabel 升 footnote/w600 | visit/[visitId].tsx |
| 4 | 封面卡 belowTitle title2→headline | StoryCoverCard.tsx |
| 5 | 删 openHint、pagerHint 精简为「n / m」 | VisitCardStack.tsx |

**验证结果**：tsc 0 错误；9 套件 1751 条断言全绿；web 导出见交付说明。真机待验：① 故事页小字可读性；② 图库照片墙观感与多选选中态；③ 封面卡标题层级；④ 卡片堆滑卡与 pagerHint。
