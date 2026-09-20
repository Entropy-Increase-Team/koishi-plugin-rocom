# RoCom 4.1 对齐功能验收检查

检查日期：2026-09-21。依据：[对齐规划](astrbot-rocom-4.1-alignment-plan.md)、[当前台账](upstream-alignment-status.md)、当前工作区源代码和本地上游 `f6ecd9a`。

> 修复更新：下文保留修复前审计记录，当前状态及重新验证结果见 [修复验收记录](rocom-4.1-fixes-2026-09-21.md)。

## 结论

**当前实现尚不符合完整验收要求。** 新增命令、服务、模板和部分协议适配已经落地，类型检查、构建和打包清单检查通过，但存在可以离线复现的逻辑缺陷，不能全部归类为“等待生产接口联调”。

本次针对风险分支编写了 27 项离线检查，结果为 **9 项通过、18 项失败**。这些是针对性检查，不是全部功能覆盖率，也不表示整个插件只有 9 项功能能用。失败项包括同一问题的多个边界场景，具体归并见后文。

本次没有修复业务代码。新增了本报告、复现脚本和机器可读结果；执行构建更新了相应构建产物。未调用生产 API、未发送真实聊天消息、未发布 npm 包。渲染验证使用实际 art-template 和模拟 page，未进行真实 Chromium 截图或生产适配器联调。

## 1. 检查结果与证据

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run check` | 通过 | 当前源码类型检查通过 |
| `npm run build` | 通过 | TypeScript 构建和资源复制完成 |
| `npm pack --dry-run --ignore-scripts --json` | 通过 | 已单独构建，因此跳过重复构建；仅检查打包内容，不发布 |
| 打包清单 | 通过 | 334 个文件；压缩预估 19,950,090 字节，解包 31,120,403 字节；含两个新模板，未发现参考项目或 tests 被纳入 |
| `node tests/alignment-review.cjs` | 9 通过 / 18 失败 | 使用当前 TypeScript、合成 JSON 和模拟会话/发送/page |
| `git diff --check` | 有轻微问题 | `docs/commands.md:568` 存在文件末尾额外空行，不影响功能 |

首次 dry-run 因 npm 缓存位于工作区外发生权限错误，获准重试后成功，不属于业务缺陷。

复现文件：

- [离线检查脚本](../tests/alignment-review.cjs)
- [逐项结果 JSON](alignment-review-results.json)

复现命令：

```powershell
npm run check
npm run build
node tests/alignment-review.cjs
```

检查脚本对源文件做内存编译，个别未导出的转换/权限函数仅在内存里追加导出用于验证，不改动生产文件。存在失败断言时脚本退出码为 1，这是本次验收未通过的结果。

## 2. 必须先处理的问题

### R01 · P1：任务状态判断顺序错误，排队和失败可能被当作成功

位置：[src/client.ts](../src/client.ts)，`isCompletedGatewayPayload` 第 465 行附近，`pollIngameTask` 第 518、556 行附近。

当前先根据 `source/title/rows` 等字段判定“完成”，之后才检查 `status`。因此：

- `{ status: 'failed', task_id: 'T', source: 'ingame', error: '...' }` 直接作为业务成功结果返回。
- `{ status: 'queued', task_id: 'T', title: '排队中' }` 不进行一次轮询就返回。
- HTTP 202 且缺少 task_id，虽然设置错误信息，仍把排队对象返回给上层。
- `completed → result → data → goods` 只解一层，最终仍可能返回任务壳而非商品；与台账“每剥离一层”描述不符。

影响：玩家/家园/商人可能展示空数据，任务错误不显示，实时商人可能错误触发兜底。该判断中部分逻辑在旧版已存在，但此次计划明确要求修正，不能作为 API-01 已完成行为。

复现：`task/failed-state-must-not-return-business-data`、`task/queued-title-must-continue-polling`、`task/202-without-task-id-is-error`、`task/nested-result-data-retains-mapping` 均失败。

修正要求：先区分失败/排队/完成状态，再提取业务结果；排队缺 task_id 返回失败；受限深度递归解包并逐层继承 goods_mapping；补齐失败与排队样本后再联调。

### R02 · P1：保存 self_id 后，群推送仍没有使用对应 Bot

位置：[src/subscription-send.ts](../src/subscription-send.ts)，第 35、54–56 行附近。

`findBot()` 虽选中了 self_id 对应的 Bot，但通常群聊分支转而调用 `ctx.broadcast([platform:channelId], ...)`，没有使用选中的 bot。已核对本地 Koishi 实现：broadcast 按数据库里的频道 assignee 分配 Bot，传入参数不包含本订阅 self_id。

影响：多 Bot 时可能由另一 Bot 发送；目标频道未入库或未分配时可能完全不发。只存储 self_id 并不能完成多 Bot 对齐。

复现：`send/explicit-bot-must-send-group-message`，预期选择的 bot.sendMessage 被调用 1 次，实际 0 次，执行了广播。

修正要求：使用已选中的 Bot 定向发送，按已安装适配器的目标参数约定传 channel/guild；避免重新进入会改变 Bot 选择的全局广播路径。

### R03 · P1：空发送结果也记录为成功，导致漏推后不再重试

位置：[src/subscription-send.ts](../src/subscription-send.ts)，第 43–61 行附近。

当前发送只要没有抛异常就 `return true`。Koishi 的广播在频道不存在、被静默或下层发送失败被内部捕获时，可以返回 `[]`。目前返回空数组仍被视为成功，上层继续更新商人轮次、家园通知状态或公告游标。

影响：用户实际未收到消息，系统却永久跳过本轮提醒，图片失败后文字兜底也不触发。该问题来源于原有发送封装，但直接违反本轮“成功后才推进状态”的验收要求。

复现：`send/empty-message-ids-must-not-mark-success`，模拟广播返回 `[]`，实际结果仍为 true。

修正要求：根据适配器明确的成功返回判断消息是否送达；无有效结果时不推进去重状态；将日志和重试统一到该判断。

### R04 · P1：卸载取消信号未传入任务，旧实例仍可继续推送

位置：[src/commands/merchant.ts](../src/commands/merchant.ts)，第 553、558、692 行附近；[src/subscription-runner.ts](../src/subscription-runner.ts)。

runner 创建并 abort 了 signal，但 `merchantRunner(async () => ...)` 没有接收 signal，`checkMerchantSubscriptions()` 也不检查它，请求、渲染、发送均不会因为 runner 被取消而停止。

复现：`merchant/disposal-stops-inflight-send` 模拟查询尚未返回时卸载插件，再返回商品，实际仍发送 1 次。

另外，家园与公告仍为原始 `ctx.setInterval` 异步调用，没有互斥 runner；检查持续时间超过周期时可能重叠。客户端 legacy 商人兜底请求也没有透传取消信号。

修正要求：各订阅分别接入 runner；signal 贯穿请求，发送前再次检查；卸载与取消之后不允许旧任务写状态或发送。将台账“可取消”修改为待修复，直到上述复现通过。

### R05 · P1：群/私聊识别仍忽略 isDirect，可能绕过群管理分支

位置：[src/commands/merchant.ts](../src/commands/merchant.ts)，第 252–256 行附近；家园/公告的目标构造也使用类似 `!guildId` 判断。

已经新增 `isDirectSession()`，但实际商人订阅仍使用 `!session.guildId`。对于适配器明确提供 `isDirect: false`、有群 channelId 但没有 guildId 的会话，当前代码仍当成私聊，跳过群管理员判断，并可能记录成用户私聊推送目标。

复现：`permissions/group-without-guild-not-treated-as-private`。这是基于会话字段的确定错误；当前官方 QQ 适配器是否产生该形态仍需实际事件确认。

修正要求：所有订阅入口共用明确的会话类型判断；优先可信 isDirect/channel 类型，再做平台兼容；普通群成员不能因为缺 guildId 进入私聊免管理权限分支。

## 3. 影响对齐完整性的问题

### R06 · P2：Bot 管理员 authority 取错位置，公告也未统一权限

位置：[src/commands/merchant.ts](../src/commands/merchant.ts) 第 274 行附近；[src/commands/query.ts](../src/commands/query.ts) 第 1344 行附近；[src/commands/tools.ts](../src/commands/tools.ts) 第 215、237 行附近。

商人和家园读取 `session.authority` 或 `session.event.user.authority`，没有读取 Koishi 数据库用户的 `session.user.authority`。已核对本地 Koishi 的用户字段结构。普通群身份但 authority=4 的 Bot 管理员仍被拒绝，除非另外进 adminUserIds 白名单。

公告订阅/取消依旧只检查白名单，因此新增两个权限开关对公告不生效；AnnouncementSubscription 也未加入 self_id，新建公告订阅在多 Bot 平台上仍无法满足精确发送要求。

复现：`permissions/koishi-user-authority-is-read` 失败。公告未接入由入口代码确认。

修正要求：读取并保证加载 session.user.authority；三类订阅共用同一函数，公告同步保存/使用 self_id。角色匹配还需将 `includes('admin')` 改成明确枚举映射，当前 `not-admin` 也会被识别成管理员（已有离线复现）；不能把该复现直接等同于当前真实平台存在任意用户提权漏洞。

### R07 · P2：仅有 Token 时玩家查询仍拒绝提交，家园入口也未接通

位置：[src/client.ts](../src/client.ts)，第 718、742 行附近；[src/commands/query.ts](../src/commands/query.ts)，第 1925、1955 行附近。

玩家命令允许“无 UID、有 Token”继续执行，但 `ingamePlayerSearch/ingamePlayerCard` 内部仍直接拒绝空 UID，尚未调用后端就失败。家园客户端已经支持空 UID+Token，但家园命令仍先要求主绑定 UID，并且不传 auth。

复现：`player/token-only-can-submit-request`，实际网络提交次数为 0。规划中“Token 省略 UID”不能标为已接通。

修正要求：命令和客户端统一条件；Token 存在时省略 uid 参数并透传鉴权到提交/轮询，实服是否接受再单独联调。

### R08 · P2：玩家新增收集数和名片图只有数据字段，没有画到图片

位置：[src/commands/query.ts](../src/commands/query.ts)，第 1180–1182 行附近；[玩家模板](../src/render-templates/player-search/index.html)；[src/player-service.ts](../src/player-service.ts)，第 34 行附近。

`cardImageUrl/collectedShining/collectedGlass` 已放入渲染数据，但模板没有读取它们，sections/summaryCards 也没有这些指标。玩家命令文字回退仍仅输出 UID。

此外，旧响应包含非空 rows 时 `playerRows()` 直接返回 rows，后来合并进来的名片收集字段被丢弃；`card_icon_selected` 读取 appearance/business 而不是上游 card 根层，也会丢字段。

复现：`player/template-shows-collection-and-card`、`player/legacy-rows-plus-card-retains-new-fields` 均失败。

修正要求：扩展实际模板与文字内容；旧 rows 和新 card 字段合并后去重；按上游真实字段位置补读取。搜索 UID 与名片 UID 的一致性也应校验名片响应本身，而不是只检查搜索响应。

### R09 · P2：查蛋体型未进入图片和本地回退，缺失范围还会产生错误标签

位置：[src/render-templates/searcheggs/size.html](../src/render-templates/searcheggs/size.html)；[src/egg-service.ts](../src/egg-service.ts) 第 242、317、524 行附近；[src/pet-size.ts](../src/pet-size.ts) 第 20 行附近。

API 转换已计算体型，API 文字也有标签，但是 size.html 从不使用 size_variant 字段。离线 `formatPetCard/buildSizeSearchText` 也没有体型逻辑，因此接口回退后标签消失。

新体型辅助函数的 `Number(null) === 0` 导致缺失体重下界被当成 0。例如 `sizeVariantPayload(0.05, null, 3)` 会标“小块头”，而要求是缺失范围不判断。

复现：`egg/template-shows-size-label`、`egg/missing-range-does-not-become-zero` 失败；API 正常范围的阈值与文字检查通过。

修正要求：图文/API/离线复用同一判定；数值转换先排除 null/undefined/空字符串；模板显示标记、阈值、单位。

### R10 · P2：查蛋可配种总量忽略后端总数，误显示当前页数量

位置：[src/commands/egg.ts](../src/commands/egg.ts)，请求 `compatibleByGroup['__all__']`；[src/egg-service.ts](../src/egg-service.ts)，第 846–907 行附近。

命令额外调用合并蛋组接口获取 total，但 `buildSearchDataFromEggApi()` 没有使用 `__all__`，只把当前已加载成员去重计数。当总数 100、本页 1 个成员时，总可配种数显示 1。

复现：`egg/compatible-total-uses-backend-union-total`。本地上游对应函数会优先用 `__all__.total`。

修正要求：总量使用后端合并结果；预览条数单独显示；合并请求失败时标明当前展示/估计值，不能把预览数量冒充总数。

### R11 · P2：渲染总超时仍未覆盖截图，配置说明与行为不一致

位置：[src/render.ts](../src/render.ts)，第 114–120、161、293–309 行附近；[src/index.ts](../src/index.ts) 的 renderTimeout 配置。

deadline 只用于 page.goto，且 remainingMs 最小仍为 1000；后续图片/字体等待、evaluate、截图没有共同截止控制，也没有到期主动 close。截图未返回时不会进入 finally，已有 page.close 无法保证按预算释放资源。

复现：`render/deadline-includes-screenshot`，设置 20ms，模拟截图延迟，到 100ms 时既未返回也未关闭 page；测试最后等待模拟任务自然结束，不遗留后台任务。

`maxPageHeight` 只有类型和配置值，未执行分页；renderTimeout 主要在家园详情低带宽调用中传入，未成为所有渲染的统一配置。

修正要求：总预算触发时关闭本次 page，使在途操作结束；所有阶段使用剩余时间；把全局配置贯穿调用；实现分页或取消“已有高度限制”的宣称。

### R12 · P2：分享码文字回退缺天赋，排行榜指定用户标题不准确

位置：[src/share-code-service.ts](../src/share-code-service.ts)，`buildShareCodeText()`；[src/ranking-service.ts](../src/ranking-service.ts)，`buildRankingView/buildRankingText()`。

分享码图片数据有 ivs，但文字只显示精灵、血脉、性格、技能，缺规划要求的天赋；复现 `share/text-fallback-includes-talents` 失败。

排行榜 `current.uid === requestedUid` 时仍显示“我的名次”，显式查询他人也如此；文字固定“我的排名”。需要保留参数是否显式指定的信息，或统一采用中性的“该玩家名次”。

分享码提取的 `+`、两层百分号解码、历史记录对象、占位技能/天赋数量等离线检查已通过。历史重解析失败时，还需避免渲染“0 只精灵”的假成功结果。

## 4. 已知未完成与次要缺口

以下应作为未完成工作列入台账，不必伪装成生产接口不确定性：

| 内容 | 现状 | 要求 |
| --- | --- | --- |
| 公告图片 | 缺模板，当前以文字为主 | 按规划 P2 完成列表/详情图片及长内容分页 |
| 商人空结果重试 | 无 empty 结果分类，无最多三次重试 | times 模式尤其需要补齐，否则该检查点错过后等下一时段 |
| 对称抖动 | 仍为 0–30 秒，未使用 nextTimeFor 预调度 | 定时模式实现 ±30 秒或明确降低需求，不写成已经对齐 |
| 家园昵称/@提醒 | 仍按 UID 构造纯文本 | 完成规划 11.4，校验绑定/平台身份后 @ |
| 自定义时区边界 | dayStart 由当前秒数反推且 end=+24h；clock 为模块全局变量 | 夏令时日界与多插件实例隔离需要修正/验证 |
| 排行榜 50 名 | 单图无分页；不是已验证会截断 | 需要真实截图确定上限并完成分页验收 |
| 字体外置 | 台账已标延后 | 可保持独立优化，不作为核心新功能的首要阻塞 |
| 指令文档 | 新榜单/分享码已追加，但订阅权限和查蛋说明仍含旧行为 | 统一更新而非只在尾部追加新章节 |
| README | 未同步新增配置与能力 | 发布前补齐 |

## 5. 哪些已经有正向证据

- 新排行榜、分享码模块在 `index.ts` 中已注册，不只是新增孤立文件。
- 排行榜数量范围与单参数处理、长 UID 字符串保真通过离线检查。
- 分享码原始 `+` 和两次百分号解码通过，记录对象可本地解析，模板可由 art-template 生成 HTML。
- 商人 `goods: []` 不触发旧接口兜底，免费商品价格 0 和限购 0 被保留。
- 上海时区的基本时间换算正确，定时检查已从服务器本地时间改为 MerchantClock。
- 玩家 0/false 和相对资源 URL 转换通过基本检查。
- 一层 completed/result 解包能保留 goods_mapping。
- 查蛋正常范围的 5% 阈值与 API 文字体型标记正确。
- 新榜单/分享码模板及资源进入构建与 npm 包清单；暂无证据说明生产 API 权限或真实发送已验收。

## 6. 台账应如何调整

| 能力 | 建议状态 | 原因 |
| --- | --- | --- |
| API-01 | 开发中，需修复 | 有任务状态/多层解包确定失败，不只是待联调 |
| PLAYER-01 | 开发中，需修复 | Token 空 UID、字段合并和模板链路未完成 |
| MERCHANT-01 / SHOP-01 | 已接入，待修复基础链路并联调 | 商品转换和默认 3009 已写入，受 API/发送问题影响 |
| EGG-01 | 开发中，需修复 | 图片、本地降级、空值与总量存在缺口 |
| RANK-01 | 主体已实现，待展示边界与实服验收 | 参数/注册/模板有证据，标题和长图未完成 |
| SHARE-01 | 主体已实现，待补齐回退并联调 | 提取/模板正常，文字天赋和错误分支需补 |
| SUB-01 | 开发中，需修复 | Bot 选择、发送成功判定、权限、取消、公告链路未闭环 |
| VIEW-01 | 开发中 | 总截止未实施，公告/分页未完成 |
| ASSET-01 | 延后 | 维持原台账，记录后续安排 |

建议先修 R01–R06，再补玩家/查蛋展示与总量，最后完成渲染、公告及文档。离线失败项修正后重跑本脚本；通过不能替代真实后端、官方 QQ/OneBot 和 Chromium 的联调验收。
