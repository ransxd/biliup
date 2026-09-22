# PR #1706 截图素材

本分支是一个孤儿分支（没有代码历史），只存放上游 PR
[biliup/biliup#1706](https://github.com/biliup/biliup/pull/1706)（修复 [#1705](https://github.com/biliup/biliup/issues/1705)）
正文里引用的修前 / 修后对比截图。PR 正文通过 `raw.githubusercontent.com/ransxd/biliup/<commit SHA>/<文件名>.png`
按 commit SHA 引用，所以这个分支不要 force-push 或删除。

截图均在 headless Chrome 下对 `v1.2.6`（`ea32983`，修前）与 `fix/issue-1705-layout`（`c04ae27`，修后）的静态构建拍摄，
后端为本地 mock。桌面视口 1440×900，移动端 390×844。

| 文件 | 内容 |
| --- | --- |
| `issue1705-repro-dashboard-dark-scroll350.png` | 修前：空间配置 → 平台设置，滚 350 px，侧栏与页头被顶出 |
| `issue1705-fixed-dashboard-dark-scroll350.png` | 修后：同一滚动位置，侧栏 / 页头 / 平台列表吸顶 |
| `issue1705-fix1only-dashboard-dark-scroll350.png` | 只打 commit 1：侧栏已吸顶，右栏 Collapse 头与左列平台列表重复 |
| `issue1705-fixed-dashboard-light-platform-bilibili.png` | 修后：只剩左列平台列表一套导航，右栏只显示选中平台的字段 |
| `issue1705-fixed-dashboard-dark-bilibili-bottom-navsticky.png` | 修后：最长的哔哩哔哩面板滚到底，侧栏 / 页头 / 平台列表都在 |
| `issue1705-fixed-streamers-dark-30cards-scroll600.png` | 修后：直播管理 30 张卡片滚 600 px，侧栏与页头在位 |
| `issue1705-fixed-mobile-dashboard-platform-douyu.png` | 修后：390 px 移动端，平台列表为横排 chip 行，随内容滚动 |
| `issue1705-fixed-submitfail-global-to-douyu.png` | commit 3：校验失败自动切到出错字段所在平台并提示 |

## v2（review 轮次 1 后，head `dc78856`，应用壳布局）

按 ForgQi 的 review 意见，问题一改为应用壳布局（`.app` 100vh 不滚动，`.main` 独立滚动），去掉了 sticky 补救与 `tabPaneMotion={false}`。
以下截图在 `dc78856` 的静态构建上拍摄，`issue1705-v2-` 前缀，PR 正文「截图」一节改为引用这一组。

| 文件 | 内容 |
| --- | --- |
| `issue1705-v2-dashboard-dark-scroll350.png` | 空间配置 → 平台设置，主区滚 350 px：侧栏、页头在位，页面本身不滚 |
| `issue1705-v2-dashboard-light-platform-bilibili.png` | 左列平台列表是唯一导航，右栏只显示选中平台的字段（浅色） |
| `issue1705-v2-dashboard-dark-bilibili-bottom.png` | 最长的哔哩哔哩面板滚到底：侧栏 / 页头 / 页脚服务灯都在，平台列表随内容滚动 |
| `issue1705-v2-streamers-light-30cards-bottom.png` | 直播管理 30 张卡片滚到底，侧栏与页头「新建」在位 |
| `issue1705-v2-mobile-dashboard-platform-douyu.png` | 390 px 移动端，平台列表为横排标签行 |
| `issue1705-v2-overlay-select-dropdown-after-scroll.png` | 主区预滚 1.2k px 打开 Select，再滚 111 px 后下拉仍贴着触发器（Semi 浮层随 main 滚动重定位） |
| `issue1705-v2-overlay-override-modal-select.png` | 直播管理「配置覆写」弹窗（Collapse.Panel 不变）及其内部 Select 下拉定位正确 |
| `issue1705-v2-submitfail-global-to-douyu.png` | commit 3：校验失败自动切到出错字段所在平台并提示（Tab 切换动画已恢复） |
| `issue1705-v2-all-pages-light.png` | 13 页拼图：浅色 1440×900，主区滚到底，侧栏 / 页脚 / 页头全部在位 |

## v2 第二轮（head `3ec900e`，平台设置去掉外层卡片、两栏独立滚动）

ForgQi 第二条意见：平台列表通过布局不随内容滚动、去掉外层嵌套卡片。空间配置页改为每个 Tab 面板占满页头以下的剩余高度并在内部滚动；
平台设置是左列列表 + 右栏字段两栏各自滚动。以下文件在 `3ec900e` 上重拍并覆盖同名旧文件（旧版本仍可按旧 SHA 引用）：

| 文件 | 内容 |
| --- | --- |
| `issue1705-v2-dashboard-light-platform-bilibili-top.png` | 平台设置两栏布局，无外层卡片，浅色 |
| `issue1705-v2-dashboard-dark-platform-bilibili-bottom.png` | 右栏（哔哩哔哩 1223px）滚到底，左列平台列表、页头「保存」、侧栏都不动 |
| `issue1705-v2-mobile-dashboard-light-platform-bilibili-bottom.png` | 390px：上下堆叠，横向标签行固定在顶部，字段区独立滚动 |
| `issue1705-v2-dashboard-light-global-top.png` | 全局设置一致去掉卡片，分区标题 + 分隔线 |
| `issue1705-v2-overlay-select-dropdown-after-scroll.png` | 面板内预滚 1k px 打开 Select 并继续滚动，下拉跟随触发器 |
| `issue1705-v2-overlay-override-modal-select.png` | 「配置覆写」弹窗及其内部 Select（不受影响） |
| `issue1705-v2-submitfail-global-to-douyu.png` | commit 3 校验定位在嵌套滚动容器内仍正常 |
| `issue1705-v2-all-pages-light.png` | 13 页拼图（浅色，主区滚到底） |
| `issue1705-v2-streamers-light-30cards-bottom.png` | 直播管理 30 张卡片滚到底（与上一轮相同） |
