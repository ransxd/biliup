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
