# 真实相册读取 · 范围验证记录

- 时间：2026-10-26
- 依赖：`expo-media-library@58.0.12`（`expo install` 按 SDK 58 匹配）
- 目标：只验证「能不能读、读到了什么」，**不生成到访和故事**
- 代码：`src/library/`（读取层）+ `app/library/`（入口与检查页）

这一轮的所有结论都来自对 `node_modules/expo-media-library` 的类型定义和 iOS 原生实现的直接阅读，
不是按文档推测。凡是有矛盾的地方，下面都标了出来。

---

## 1 用的是哪套 API

SDK 58 的 `expo-media-library` 有两套接口：

| 入口 | 形态 | 状态 |
|---|---|---|
| `expo-media-library` | 类式（`Query` / `Asset` / `Album`） | 当前推荐 |
| `expo-media-library/legacy` | 函数式（`getAssetsAsync` / `getAssetInfoAsync`） | 从默认入口导入会在**运行期直接抛错**（`legacyWarnings.js` 里是显式 `throw`，不只是 console 警告） |

选了类式 API。原因不只是"推荐"，而是它有一个专为列表设计的廉价接口：

- `Query.exeForMetadata()` 一次原生调用拿一页轻量字段，不解码文件、不解析 URI
- 旧的 `getAssetsAsync` 每次都会算 `totalCount`，在几万张的相册上代价明显

官方文档页标注 **Included in Expo Go**，推荐版本 `~58.0.12`（与 `expo install` 装到的一致），
文档示例也已经全部换成 `new Query()` / `Asset.getXxx()`。所以真机用 Expo Go 就能验，
不需要 dev build。官方示例里写的是 `new Date(asset.creationTime)`（按毫秒），与 §3.1 的实读结论一致。

`legacy` 目录仍然完整保留，如果要回退，改 `reader.ts` 里的 `require('expo-media-library')` 即可，
其余代码不用动（读取层已经把原生调用全部收在这一个文件里）。

---

## 2 能力矩阵：到底能拿到什么

| 字段 | 来源 | 批量? | 单位 / 取值范围 | 缺失时 |
|---|---|---|---|---|
| `id` | metadata | ✅ | `ph://<localIdentifier>` | 不会有 |
| `filename` | metadata | ✅ | 字符串 | `null` |
| `mediaType` | metadata | ✅ | `unknown` / `image` / `audio` / `video` | 记 `unknown` |
| `width` / `height` | metadata | ✅ | 像素 | `null`（Android 可能没有） |
| `duration` | metadata | ✅ | **毫秒**（`Int(duration * 1000)`） | `null` |
| `creationTime` | metadata | ✅ | **毫秒**，见 §3 | `null` |
| `modificationTime` | metadata | ✅ | 毫秒 | `null` |
| `isFavorite` | metadata | ✅ | 布尔 | `false` |
| `mediaSubtypes` | metadata | ✅ | `livePhoto` / `screenshot` / `panorama` … | `undefined` |
| **缩略图 / 文件 URI** | `Asset.getUri()` | ❌ 逐条 | `file://` URL | 抛错 |
| **定位** | `Asset.getLocation()` | ❌ 逐条 | 只有 `latitude` / `longitude` | `null` |
| **EXIF** | `Asset.getExif()` | ❌ 逐条，代价高 | `{Exif:{...}, TIFF:{...}, GPS:{...}}` | 视频返回 `{}` |
| 是否在 iCloud | `Asset.getIsInCloud()` | ❌ 逐条 | 布尔 | 抛错 |

结论很直接：**列表页能一次拿全的是"时间和类型"，定位和缩略图必须逐条补**。
所以页大小不能开大——一页 24 条意味着 24 次 `getUri` + 24 次 `getLocation`。

---

## 3 时间与时区：这一轮最需要说清的部分

### 3.1 `creationTime` 是毫秒，但注释写的是秒

- TS 类型注释（`AssetAlbum.d.ts:29`）：`@returns A promise resolving to a timestamp in seconds`
- iOS 实现（`objects/asset/AssetMapper.swift`）：

  ```swift
  func mapCreationTime(_ date: Date?) -> Int? {
    return date?.millisecondsSince1970        // = Int((timeIntervalSince1970 * 1000).rounded())
  }
  ```

注释和实现矛盾。处理方式不是"选一个信"，而是：

1. 原值照存（`RawEpoch.raw`）
2. 按数值量级判定单位（`src/library/epoch.ts`）：
   - `≥ 1e11` → 毫秒（1e11 ms ≈ 1973-03，现代照片在 1.7e12）
   - `[1e8, 1e11)` → 秒
   - 其余（含 0 和负数）→ 无法判定
3. 界面上把**原始值、判定结果、换算出的 UTC、按设备时区解释的结果**四个一起显示

这样即使某天上游修正了单位，判定会自动跟着变，也不会悄悄把 2026 年显示成 1970 年。

### 3.2 相册 API **不提供**拍摄地时区

按可查到的全部入口逐条核对：

| 候选来源 | 实际内容 | 有没有时区 |
|---|---|---|
| `creationTime` | Unix 时间戳（绝对时刻） | ❌ 时区信息在时间里本来就不存在 |
| `Asset.getLocation()` | `PHAsset.location` 的经纬度 | ❌ 只有坐标。`CLLocation` 本身有 `timestamp`，但封装层没取 |
| `Asset.getExif()` | 原图 EXIF | ⚠️ **可能有** `OffsetTimeOriginal` / `OffsetTime`，不保证 |
| `PHAsset` 其它字段 | 无 | ❌ |

所以「这张照片是在哪个时区拍的」**无法从相册 API 直接得到**。
唯一可能残留线索的是 EXIF 的 `OffsetTime*` tag，而它：

- 截图、以及大部分经过微信/社交软件保存的图片**没有**
- 是**拍摄设备**写的内容，不代表当地时间一定正确（没联网的手机、手动改过时区的相机会写错）
- 读取代价高：iOS 实现会先把当前版本导出成临时文件再 `CIImage(contentsOf:)` 解析，iCloud 资产还会触发下载

因此这一轮的做法是：**保留原始时间值 + 原样列出 EXIF 里所有时间/时区相关字段**，
把「拍摄地日期 vs 当前所在地日期」的口径实验单独安排，不在这里做推断。

检查页（`app/library/inspect.tsx`）里能直接看到：原始毫秒值、判定单位、UTC、
按设备时区解释的结果、设备当前偏移、以及按需读出的 `Exif.OffsetTimeOriginal`。

---

## 4 分页

- 接口：`Query.orderBy({key: CREATION_TIME, ascending: false}).limit(n).offset(m).exeForMetadata()`
- 页大小固定 24，**第一页自动读，后续每页由用户点按钮触达**（避免一进页面就扫全库并触发 iCloud 下载）
- `hasMore` 判定：本页返回条数 < 页大小即到底
- **新版 `Query` 没有 `count()`**。旧版 `getAssetsAsync` 的 `totalCount` 在 iOS 上是全量枚举换来的，
  这里刻意不取总和，界面只显示「已加载 N 张」
- offset 分页在读取过程中相册发生变化时会重复或漏项，页面按 `id` 去重

---

## 5 权限

| 状态 | 来源 | 界面行为 |
|---|---|---|
| `undetermined` | `status === 'undetermined'` | 说明文案 + 「允许访问照片」按钮 |
| `granted` + `accessPrivileges === 'all'` | iOS 14+ 完整授权 | 正常列表 |
| `granted` + `accessPrivileges === 'limited'` | 仅选定照片 | 顶部黄条 + 「选择更多照片」→ `presentPermissionsPicker()`，选完重新读第一页 |
| `granted` + `accessPrivileges === undefined` | Android < 14 不区分 | 显示「已授权（宿主未区分范围）」，**不写成"全部照片"** |
| `denied` | — | 说明 + 「再请求一次」（`canAskAgain` 时）+ 「打开系统设置」 |
| 原生模块缺失 | `requireOptionalNativeModule('ExpoMediaLibraryNext') === null` | 单独一档，不混成"权限被拒绝" |

---

## 6 已知代价与风险

1. **缩略图会触发 iCloud 下载。** `getUri()` 走的是 `PHContentEditingInputRequestOptions`，
   且 `isNetworkAccessAllowed = true`。iCloud 上的资产第一次进列表会真的开始下载原图。
   缓解：页大小 24、并发 3、只在拿到权限后读第一页。
2. **`<Image>` 解码的是全尺寸图。** 新版 API 不给缩略图，只能拿原图 URI 交给 RN 的 `Image`，
   由它按显示尺寸做降采样。对 48MP 的图，24 张同时解码仍有内存压力。
   后续应该换成专门的缩略图方案（或在原生侧用 `PHImageManager` 的 targetSize）。
3. **`getExif()` 会写临时文件。** 只在检查页点按钮时调用，不进列表循环。
4. **Expo Go 里的权限文案不是 `app.json` 里写的那句。** Expo Go 用自己的 Info.plist。
   `app.json` 里配的 `photosPermission` / `savePhotosPermission` 只在自建 dev client 或正式构建时生效。
   如果哪天 Expo Go 的 SDK 58 版本没跟上、缺 `ExpoMediaLibraryNext`，页面会显示"宿主没有相册模块"而不是崩溃——
   这就是该切 dev build 的信号。
5. **视频没有缩略图。** 只给类型角标和时长；抽帧要 `AVAsset`，收益不抵成本。

---

## 7 待真机确认

1. 首次授权：完整授权 / 仅选部分照片 / 拒绝，三种路径的文案和按钮是否正确
2. 部分授权下点「选择更多照片」，系统面板是否弹出，选完是否重新读到
3. 一页 24 张的缩略图加载耗时，以及滚动是否卡（尤其含 iCloud 资产时）
4. 检查页的原始值与 UTC / 设备本地两份时间是否自洽
5. 点「读取 EXIF」得到的 `OffsetTimeOriginal`，与照片实际的拍摄地时区是否一致（这直接决定日期口径实验怎么设计）

---

## 8 这一轮刻意没做的事

- 不生成 `Visit` / `Story`，不写 store——相册这条线和示例数据那条线完全隔离
- 不做日期分组，不做地点反查（地点名仍是示例数据里的字符串）
- 不处理没有定位的照片归属
- 不缓存读取结果，每次进页面重读
