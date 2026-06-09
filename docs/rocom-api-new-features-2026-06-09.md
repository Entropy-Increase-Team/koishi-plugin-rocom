# Rocom API 新接口接入修改说明

本文记录 2026-06-09 根据 `Rocom-API.md` 与参考实现 `src/doc/plugins/WeGame-plugin/modules/rocom` 为本仓库补充的新功能。

## 变更范围

- 补齐 `RocomClient` 中缺失的 RoCom API 封装。
- 将参考实现中已有交互的功能迁移为 Koishi 侧实现；其中换蛋广场仅保留逻辑代码，当前不注册指令入口。
- 更新帮助菜单与 `docs/commands.md`。
- 保持原有功能兼容：新接口失败时，查蛋尺寸反查仍会回退旧接口和本地数据。

## 客户端 API

修改文件：`src/client.ts`

新增或扩展的接口封装：

- `getAccounts()`：`GET /api/v1/games/rocom/accounts`
- `bindUid()`：`POST /api/v1/games/rocom/uid/bind`
- `getActivitiesInfo()`：`GET /api/v1/games/rocom/activities/info`
- `syncConfig()`：`POST /api/v1/games/rocom/config/sync`
- `getAnnouncementList()`：`GET /api/v1/games/rocom/announcement/list`
- `getLatestAnnouncement()`：`GET /api/v1/games/rocom/announcement/latest`
- `getAnnouncementDetail()`：`GET /api/v1/games/rocom/announcement/detail`
- `getEggSearch()`：`GET /api/v1/games/rocom/egg/search`
- `getEggGroups()`：`GET /api/v1/games/rocom/egg/groups`
- `getEggGroupPets()`：`GET /api/v1/games/rocom/egg/group-pets`
- `getEggPetGroups()`：`GET /api/v1/games/rocom/egg/pet-groups`
- `getEggExchanges()`：`GET /api/v1/games/rocom/community/egg-exchanges`
- `postEggExchange()`：`POST /api/v1/games/rocom/community/egg-exchanges`
- `getMyEggExchanges()`：`GET /api/v1/games/rocom/community/egg-exchanges/my`
- `getEggExchangeReviewStatus()`：`GET /api/v1/games/rocom/community/egg-exchanges/{post_id}/review-status`
- `closeEggExchange()`：`POST /api/v1/games/rocom/community/egg-exchanges/{post_id}/close`
- `createEggExchangeSubscription()`：`POST /api/v1/games/rocom/community/egg-exchange-subscriptions`
- `getEggExchangeSubscriptions()`：`GET /api/v1/games/rocom/community/egg-exchange-subscriptions`
- `deleteEggExchangeSubscription()`：`DELETE /api/v1/games/rocom/community/egg-exchange-subscriptions/{subscription_id}`
- `getEggExchangeEvents()`：`GET /api/v1/games/rocom/community/egg-exchange-events`

同时调整：

- `delete()` 支持传递 query 参数，满足删除换蛋订阅时携带用户归属参数。
- `queryPetSize()` 增加 `sameRideEgg` 和 `userIdentifier` 参数，保留旧尺寸查询接口兼容。
- 新增 `scopedParams()`，统一注入 `user_identifier` query 参数。

## 账号功能

修改文件：`src/commands/account.ts`

新增命令：

- `洛克.绑定UID <UID>`
- `洛克绑定UID <UID>`
- `绑定UID <UID>`

行为：

- 调用 `/api/v1/games/rocom/uid/bind`。
- UID 必须是 `4` 到 `20` 位数字。
- 绑定成功后写入本地绑定列表，并设为主账号。
- 如果后端返回 `frameworkToken`，同步写入 `role-token`，供后续账号数据或 ingame 查询使用。

## 查蛋功能

修改文件：

- `src/commands/egg.ts`
- `src/egg-service.ts`

新增能力：

- `洛克.查蛋 <身高> <体重>` 优先调用新的 `/api/v1/games/rocom/egg/search`。
- 新增 `/egg/search` 响应格式适配，支持 `items`、`height_range_m`、`weight_range_kg`、`unit_type`、`egg_groups` 等字段。
- 新接口失败时，依次回退：
  1. `/api/v1/games/rocom/pet/size-query`
  2. 本地 `Pets.json` 尺寸反查

新增渲染/文本构建方法：

- `buildEggSearchData()`
- `buildEggSearchText()`
- `formatEggSearchCard()`
- `formatEggSearchTextLine()`

## 换蛋广场

新增文件：`src/commands/community.ts`

当前状态：

- 保留换蛋广场相关逻辑代码与 API 调用封装，便于后续按需恢复或内部复用。
- `src/commands/community.ts` 不再包含 Koishi `ctx.command(...)` 注册，仅导出 `createCommunityHandlers(deps)` 逻辑工厂。
- `src/index.ts` 不再导入换蛋广场逻辑。
- 帮助菜单与 `docs/commands.md` 不再暴露换蛋广场、发布换蛋帖、换蛋订阅等可用指令。

实现内容：

- 公开换蛋帖分页查询。
- 发布换蛋帖，格式按文档要求包含学号。
- 查询当前归属下的帖子。
- 关闭自己的帖子，支持 `traded` 与 `cancel`。
- 查询帖子审核状态。
- 创建、查看、取消订阅。
- 手动拉取订阅事件，并提示保存 `next_event_id` 用于下次查询。

权限规则：

- 换蛋订阅在群聊中仅允许 `adminUserIds` 中配置的 Bot 管理员操作。
- 私聊中允许用户自行管理订阅。
- 由于当前没有注册换蛋广场指令入口，上述权限逻辑暂不对外生效。

## 活动、公告与配置同步

新增文件：`src/commands/tools.ts`

新增命令：

- `洛克.日历 [刷新]`
- `洛克日历 [刷新]`
- `洛克.公告 [页码]`
- `洛克公告 [页码]`
- `洛克.最新公告`
- `洛克最新公告`
- `洛克.公告详情 <公告ID>`
- `洛克公告详情 <公告ID>`
- `洛克.同步配置`
- `洛克同步配置`

实现内容：

- 活动日历以文本方式展示活动名称、时间、说明、奖励摘要。
- 公告列表以文本方式展示标题、发布时间、摘要和公告 ID。
- 最新公告复用公告详情文本格式。
- 公告详情会将 HTML 正文转换为纯文本，并列出最多 3 个图片资源链接。
- 配置同步命令仅允许 `adminUserIds` 中的管理员调用，并要求后端 API Key 具备 `admin.access` 权限。

说明：

- 当前仓库没有参考模块中的 `activities` 图片模板，因此活动日历先采用文本输出。
- 后续若迁移参考模板，可在 `Renderer` 中接入图片版活动日历。

## 插件入口与菜单

修改文件：`src/index.ts`

本次新增且仍保留的注册：

- `registerTools(deps)`

保留但未注册：

- `src/commands/community.ts` 中的 `createCommunityHandlers(deps)` 换蛋广场逻辑。

帮助菜单新增入口：

- `洛克.绑定UID`
- `洛克.日历`
- `洛克.公告`

帮助菜单已取消入口：

- `换蛋广场`
- `订阅换蛋`
- `取消换蛋订阅`

## 文档

修改文件：

- `docs/commands.md`
- `docs/rocom-api-new-features-2026-06-09.md`

`docs/commands.md` 新增内容：

- 账号管理中的 UID 绑定说明。
- 活动与公告章节。
- 查蛋尺寸反查的新接口与回退说明。
- 移除换蛋广场可用指令说明，仅在本修改说明中记录逻辑保留状态。
- 管理命令中的配置同步说明。

## 验证

已执行：

```bash
npx tsc -p tsconfig.json --noEmit --pretty false
```

结果：

- TypeScript 检查通过。
- npm 输出了既有配置警告：`Unknown user config "python"`，不影响本次类型检查结果。

后续建议：

- 在具备有效 `wegameApiKey` 的运行环境中实测：
  - `洛克.绑定UID`
  - `洛克.查蛋 0.18m 1.5kg`
  - `洛克.公告`
  - `洛克.日历`
