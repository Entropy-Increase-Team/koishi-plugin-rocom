# player/card 与 player/search 格式化响应影响检查

依据：用户提供的 `src/doc/player-card.json`、`src/doc/player-search.json`，以及当前工作区实现。

结论：**主要嵌套结构已兼容，但名片图片地址存在确定的适配缺口；最后离线时间也需要格式化。** 本次是检查，没有修改业务代码。

## 已复现的问题

### 1. relative/ 标记未剥离，生成错误的名片图片地址

来源字段：

- `player-card.json`：`data.player_card_brief_info.business_card_info.cur_card_url`。
- `player-search.json`：`data.player_info.card_bussiness_card_url`。

两者均为 `relative/api/v1/resources/rocom/photo/...`。这里的 `relative/` 是接口的地址标记，应去掉后与 API 基础地址拼接。本地参考项目 `astrbot_plugin_rocom/main.py` 的 `_normalize_player_resource_url()` 已明确这样处理。

当前 `src/player-service.ts:24` 直接 `new URL(text, baseUrl)`，生成：

```text
实际： https://<API主机>/relative/api/v1/resources/rocom/photo/...
预期： https://<API主机>/api/v1/resources/rocom/photo/...
```

影响调用链：

- `洛克.玩家` → `buildPlayerView()` → `resourceUrl()` → 玩家模板名片图片。
- `洛克.档案` → `profileCardImage` → `resourceUrl()` → 档案模板名片图片。

玩家模板加载失败会隐藏图片，因此可能表现为“查询有结果但没有名片”，而不是直接报错。未访问生产资源，不能断言错误路径一定返回哪一种 HTTP 状态；地址与协议约定不符已经离线确认。

最小适配方向：在共享 `resourceUrl()` 中先移除开头的 `relative/`，保留绝对 URL、`/api/...` 和已有其他相对地址的行为；同时增加这两份真实格式样本的回归。

### 2. 最后离线时间原样显示为数字

示例的 `data.player_info.last_logout_time` 为秒级 Unix 时间戳。当前 `playerRows()` 保存原值，`cleanPlayerFieldValue()` 没有对应日期分支，`buildPlayerSearchRenderData()` 直接用它作为“最后离线”。

影响：玩家查询图片和文字展示未转换的时间戳。基础查询不受阻，但可读性不符合时间字段含义。

适配方向：针对时间字段区分秒/毫秒和已有日期文本；以明确时区格式化；零值/缺失显示未知。不要对所有数字字段统一转换日期。

## 已确认兼容的部分

| 位置/内容 | 样本验证结果 |
| --- | --- |
| 外层 `code/data/message` | HTTP 请求层正确解包 |
| `data.player_info` | 当前客户端识别为完成结果，基本资料可读取 |
| `data.player_card_brief_info` | 当前客户端识别为完成结果，名片字段可读取 |
| `meta.task_id` | 已完成业务对象不会被误认为仍需轮询的任务 |
| 昵称、等级、性别、签名、家园等级/舒适度 | 读取正常 |
| `online: false`、`visitor_num: 0` | 保留值，未当成空数据 |
| `card_pet_info` 的异色/炫彩收集数 | 正确读出并传入图片模板 |
| 名片头像和皮肤字段 | 读取正常 |
| card 示例没有显式 UID | 合并时保留 search 的 UID；无 UID 本身不构成错误 |
| completed/result 包装中的新业务结构 | 解包正常 |

card 缺少 UID 时只能沿用请求上下文，不能凭照片 URL 反推并声称独立完成身份校验；这是示例的信息边界。

## 新字段与影响范围

示例中的服装羁绊收集、名片前后标签、音乐等字段当前尚未纳入展示；这是可选信息未展示，不等于已有功能失效。名片精灵展示列表、职业快照等也不属于当前已声明的核心玩家展示字段。

直接受影响的是玩家查询与档案中依赖这两个接口的扩展信息。家园、商人、查蛋和分享码使用不同接口，仅从本次两个示例没有证据表明它们需要跟随改动。排行榜使用独立 rankings 接口，也不能据此推断其响应改变。

## 验证与限制

- 新增 [样本检查脚本](../tests/player-response-review.cjs)，直接读取用户指定 JSON，通过模拟 HTTP 调用当前 TypeScript 客户端、转换器和模板。
- 执行 `node tests/player-response-review.cjs`：**9 项，7 通过、2 失败**；失败分别是 search/card 地址，两者同属一个 URL 适配问题。
- [检查结果](player-response-review-results.json) 仅记录字段与状态，不复制示例中的用户身份、名片地址或 worker 信息。
- “最后离线原样显示”作为展示观察记录在结果中；未把未请求展示的全部新字段都定义成失败断言。
- 未请求生产 API、未发送聊天消息、未修改业务代码或构建产物。

此前通用测试覆盖了 `/api/...` 相对地址，没有覆盖本次示例中的 `relative/api/...` 标记，所以此前通过的 44 项测试不能替代此次样本验证。
