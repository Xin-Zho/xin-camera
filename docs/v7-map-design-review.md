# 地图首页设计审查（P1 · 依据 Apple HIG）

> 评审方法来自 `dickwu/apple-design-skill` 的五透镜流程（可访问性 → 平台约定 →
> 视觉工艺 → 交互 → 文案），每条发现按 What / Why / Fix 记录，严重性分
> Critical / High / Medium / Low。引用格式 `文件 › 标题`；无指南覆盖的判断明确标注。
> HIG 原文取自该仓库抓取的 developer.apple.com 同源版本（2026-10 在线可查）。

## 0 学习材料清单

| 来源 | 内容 |
| --- | --- |
| `dickwu/apple-design-skill` | SKILL.md：评审流程、八项设计原则、What/Why/Fix、严重性分级 |
| 同上 `references/hig/*` | maps / gestures / layout / materials / motion / typography / accessibility（Apple 原文） |
| `expo/skills › expo-native-ui` | 原生质感样式、语义色、控件尺寸、borderCurve、阴影、无障碍习惯 |

## 1 评审范围与限制

- 评审对象：`app/(tabs)/map.tsx`、`src/components/timeline/TimelineRail.tsx`、
  `src/components/map/{PlaceMarker,ClusterMarker,PlacePickerSheet}.tsx`、`src/theme/*`。
- **截图不可得**：地图页依赖 `react-native-maps`，无 Web 实现（v6 已留档），
  修改前后对比只能真机目视，本报告的对比度结论由色值计算得出，不是从截图估算。
- 时间轴几何（`railGeometry.ts`）与手势 worklet 已验收，本轮**只评不动**。

## 2 发现（按严重性）

### High · 提示文字对比度不足 4.5:1

- **What**：地点卡片第三行「当前时段 N 次到访 · 点开看到访」用 `textTertiary`
  (#9C9CA4) 12pt 于白卡上，对比度 ≈ **2.7:1**；`PlacePickerSheet.rowHint` 同。
- **Why**：`accessibility.md › Contrast`——≤17pt 文本最低 **4.5:1**（WCAG AA）。
  `typography.md`——12pt 属小字号，更依赖对比度。
- **Fix**（已实施）：改 `textSecondary` (#6B6B72)，白底 ≈ **5.3:1**。

### Medium · 时间轴刻度与轨道线低于图形对比度门槛

- **What**：上下文刻度 `textTertiary` ≈ 2.7:1、轨道线 `separatorStrong`
  (#D6D6DA) ≈ **1.3:1**，白胶囊上几乎隐形。
- **Why**：刻度是理解时间轴内容的必要图形对象，`accessibility.md` 的图形对比
  惯例为 ≥3:1（个人判断：HIG 无时间轴专项页，按 WCAG 非文本 1.4.11 惯例执行）；
  `maps.md › Best practices`——"Make sure there's enough contrast between custom
  controls and the map… use a thin stroke or light drop shadow"。
- **Fix**（已实施）：刻度 → `textSecondary` (5.3:1)、年份刻度 → `textPrimary`、
  轨道线 → `textTertiary`（结构线比刻度安静一档）。

### Medium · 时间轴拖动缺少拖动中的即时反馈

- **What**：拖动中只有滑块跟手移动，轨道本身无任何状态变化。
- **Why**：`gestures.md › Best practices`——"Handle gestures as responsively as
  possible… provide immediate feedback"；`motion.md`——反馈要"brief and precise"。
- **Fix**（已实施）：拖动中背板增白一档（opacity 0→0.35，直读 shared value）、
  滑块微放大 1.08，松手即回。**手势与几何逻辑零改动**（`dragging` 本就存在）。

### Low · 圆角缺连续曲率

- **What**：卡片类圆角未设 `borderCurve: 'continuous'`，圆角转角有轻微突变。
- **Why**：`expo-native-ui › General Styling Rules`——"Use `{ borderCurve:
  'continuous' }` for rounded corners unless creating a capsule shape"。
- **Fix**（已实施）：placeCard / emptyPanel / legendPill / settingsButton / track。
  胶囊形（pill/圆）加了也无害，属冗余但统一。

### Low · 可按压控件缺 VoiceOver 角色

- **What**：设置按钮与地点卡片只有 `accessibilityLabel`（设置）或无标注（卡片）。
- **Why**：`accessibility.md › VoiceOver`——界面元素需恰当标注使辅助技术可用；
  角色决定朗读方式（"button" 会带动作提示）。
- **Fix**（已实施）：两处补 `accessibilityRole="button"`，卡片补 `accessibilityHint`。

### 记录不改（说明理由）

| 发现 | 严重性 | 不改的理由 |
| --- | --- | --- |
| 地点卡片选中态会**持续遮挡** Apple logo 与法律链接 | Medium | `maps.md`："It's fine when parts of your interface temporarily cover the logo and link, but don't cover these elements all the time"——卡片仅在选中时出现，属可接受的临时遮挡；系统 logo 位置原生侧控制，App 内无法重排。真机观察若发现确实常驻，再评估把卡片上移或收窄。 |
| 标记入场动效会在聚合变化（缩放）时重播 | Medium | `motion.md`："generally avoid adding motion to UI interactions that occur frequently"——但重播只在聚合结构真变时发生（key 由成员构成决定），频率可控；改动会牵动 `tracksViewChanges` 栅格化时序，风险大于收益。 |
| 阴影仍用 legacy `shadowColor/shadowOpacity` | Low | `expo-native-ui` 要求 RN 0.76+ 用 `boxShadow` 字符串。属**全项目**迁移，超出本轮范围；单改地图页会造成两种阴影写法并存。记入设计规范待办。 |
| 时间轴吸附无触感反馈 | Low | 需要 `expo-haptics` 新依赖 + worklet 回调链路。收益真实但引入依赖，按约束本轮不加；列入下一轮候选。 |
| 滑块松手回弹为硬切（无过渡） | Low | `motion.md` 允许 brief & precise；若真机手感生硬，给 transform 加 ~120ms timing，改动点在 `thumbStyle`，风险低。 |

## 3 本轮修改文件

| 文件 | 改动 |
| --- | --- |
| `app/(tabs)/map.tsx` | hint 文字对比度、4 处 borderCurve、2 处 accessibilityRole/Hint |
| `src/components/map/PlacePickerSheet.tsx` | rowHint 对比度 |
| `src/components/timeline/TimelineRail.tsx` | 刻度/轨道线对比度、拖动背板 + 滑块微放大、borderCurve、overflow 裁切 |

**未动**：`railGeometry.ts`、手势 worklet、地图聚合、可见性、store、删除恢复。

## 4 验证

- `tsc --noEmit` 0 错误；9 个套件 1691 条断言全绿（几何 967 条原样通过）。
- `expo export --platform web` 退出码 0（18 chunk）。
- **真机待验**：① 刻度/轨道线是否清晰但不过重；② 拖动时背板增白与滑块放大的手感；③ 松手回弹是否生硬；④ VoiceOver 朗读设置按钮与地点卡片；⑤ 刻度加深后时间轴整体是否还「轻」。

## 5 建议沉淀为项目设计规范

1. **对比度红线**：正文文字 ≥4.5:1（≤17pt）；必要图形对象 ≥3:1。
   白底上 `textTertiary` 只做装饰性灰字，不做信息文字。
2. **对比度用色值计算，不从截图目测**（评审 Skill 原则："Numbers, not adjectives"）。
3. **按压/手势反馈按背景选型**：白浮浅底用 scale，不用 opacity（M13 后实测教训）。
4. **卡片圆角统一 `borderCurve: 'continuous'`**（胶囊形除外）。
5. **可按压元素一律 `accessibilityRole` + `accessibilityLabel`**；图标按钮必须给 label。
6. **动效克制**：高频交互不加动效；反馈动效 brief & precise；至多一个编排好的动效时刻。
7. **待办**：全项目阴影迁移 `boxShadow`（RN 0.76+ 惯例）；时间轴吸附 haptics（需引入 expo-haptics，先真机确认手感需求）。
