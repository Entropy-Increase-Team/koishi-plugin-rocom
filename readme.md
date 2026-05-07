# koishi-plugin-rocom
注意，本项目仍处于开发调试期，可能会有未知BUG的产生。  
> APIKey  
> sk-ba042e079cf9ccb30e72b3d5af458f45  
> sk-c7952558b84a176b76d0215760732330  
> sk-b3d96323b2b045282c52f81ca43fcad8  
> sk-5c14c1e5da063037d02c15e50285dd04  
> 交流反馈：1097809141  
[![npm](https://img.shields.io/npm/v/koishi-plugin-rocom?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-rocom)

Koishi 版洛克王国数据查询插件。插件基于 WeGame / 后端接口提供账号绑定、个人档案、战绩、背包、阵容、交换大厅、远行商人、查蛋配种、Wiki 查询等功能，并通过 `koishi-plugin-puppeteer` 将部分结果渲染为图片发送。

## 功能概览

| 分类 | 功能 |
| --- | --- |
| 账号管理 | QQ 扫码登录、微信扫码登录、凭证导入、绑定列表、切换账号、解绑、刷新凭证 |
| 数据查询 | 档案、战绩、背包、阵容推荐、阵容详情、交换大厅 |
| 商人提醒 | 远行商人查询、远行商人商品订阅、取消订阅 |
| 百科查询 | 精灵 Wiki、技能 Wiki |
| 查蛋配种 | 精灵查蛋、尺寸反查、候选结果、目标配种方案、配种判定 |
| 管理维护 | 刷新所有凭证、删除失效绑定、自动刷新凭证 |

> 图片位置：插件总览截图。建议插入 `docs/images/overview.png`。
### 安全免责声明

- 绑定后的 `token`、`ticket`、扫码凭证等均属于敏感信息，请务必自行妥善保存。
- 请勿截图公开、发送他人，或提交到公开仓库，避免凭证泄露后被冒用。
- 因凭证或绑定信息泄露导致的账号风险、查询被冒用或相关损失，需要由使用者自行承担。
- 非必要不要频繁手动刷新凭证，服务端会自动刷新。
## 使用前准备

本插件依赖 Koishi 的 `database` 服务和 `koishi-plugin-puppeteer` 服务。请先在 Koishi 控制台启用：

- `database`
- `puppeteer`
- `rocom`

如果图片渲染失败，插件会尽量回落为文字结果；但档案、战绩、背包、阵容、交换大厅、远行商人和查蛋配种等功能推荐配合 Puppeteer 使用。

> 图片位置：Koishi 插件启用与服务依赖截图。建议插入 `docs/images/setup-services.png`。

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiBaseUrl` | `https://wegame.shallow.ink` | 后端 API 基础地址 |
| `wegameApiKey` | 空 | WeGame API Key，如后端要求鉴权则填写 |
| `qqLoginDebugMode` | `false` | QQ 扫码登录调试模式，可能输出敏感凭证，仅调试时开启 |
| `adminUserIds` | `[]` | Bot 管理员用户 ID 列表，用于管理员命令 |
| `autoRefreshEnabled` | `false` | 是否启用自动刷新凭证 |
| `autoRefreshTime` | `["00:00", "12:00"]` | 自动刷新凭证的时间点 |
| `merchantSubscriptionEnabled` | `true` | 是否启用远行商人订阅检查 |
| `merchantSubscriptionItems` | `["国王球", "棱镜球", "炫彩精灵蛋"]` | 默认关注的远行商人商品 |
| `merchantCheckInterval` | `300000` | 远行商人订阅检查间隔，单位毫秒 |
| `merchantPrivateSubscriptionEnabled` | `true` | 是否允许私聊订阅远行商人推送 |
| `homeSubscriptionEnabled` | `true` | 是否启用家园菜园和灵感订阅推送 |
| `homeSubscriptionIntervalMinutes` | `5` | 家园订阅检查间隔，单位分钟 |
| `imageCompressionEnabled` | `true` | 是否在发送图片前启用 PNG 无损压缩 |
| `imageCompressionMinBytes` | `262144` | 触发压缩的最小图片大小，单位字节 |
| `imageCompressionLevel` | `9` | PNG zlib 压缩等级，范围 `0-9`，数值越大通常越小但更耗时 |

### 图片压缩设置

后台配置页中有单独的“图片压缩设置”分组。该功能会在图片发送前对 PNG 的 IDAT 数据做无损重压缩，不会改变图片尺寸、画质或透明度。若压缩失败，或压缩后文件没有变小，会自动发送原图。

> 图片位置：插件配置页截图。建议插入 `docs/images/config.png`。

## 快速开始

1. 启用 `database`、`puppeteer` 和本插件。
2. 使用 `洛克.QQ登录` 或 `洛克.微信登录` 绑定账号。
3. 发送 `洛克.档案` 测试账号数据是否可正常查询。
4. 发送 `洛克` 查看内置帮助菜单。

```text
洛克.QQ登录
洛克.档案
洛克.背包
洛克.查蛋 喵喵
```

> 图片位置：首次使用流程截图。建议插入 `docs/images/quick-start.png`。

## 帮助菜单

### `洛克`

查看插件内置帮助菜单，列出常用账号管理、数据查询和百科/查蛋命令。

```text
洛克
```

> 图片位置：帮助菜单截图。建议插入 `docs/images/help-menu.png`。

## 账号管理

大部分游戏数据查询功能需要先绑定洛克王国账号。查蛋、配种等本地数据功能无需登录。

### `洛克.QQ登录`

生成 QQ 扫码登录二维码。扫码成功后插件会自动创建绑定，并保存当前用户的主账号凭证。

```text
洛克.QQ登录
```

注意事项：

- 二维码有效时间约 2 分钟。
- 需要双设备扫码。
- QQ 扫码绑定支持后续刷新凭证。

> 图片位置：QQ 登录二维码截图。建议插入 `docs/images/account-qq-login.png`。

### `洛克.微信登录`

生成微信扫码登录链接。扫码成功后插件会自动创建绑定并保存账号。

```text
洛克.微信登录
```

注意事项：

- 链接有效时间约 2 分钟。
- 需要双设备扫码。

> 图片位置：微信登录链接截图。建议插入 `docs/images/account-wechat-login.png`。

### `洛克.导入 <tgp_id> <tgp_ticket>`

手动导入 WeGame 凭证，适用于已有 `tgp_id` 和 `tgp_ticket` 的场景。

```text
洛克.导入 你的tgp_id 你的tgp_ticket
```

> 图片位置：凭证导入结果截图。建议插入 `docs/images/account-import.png`。

### `洛克.绑定列表`

查看当前用户已经绑定的账号列表，并以图片面板展示。主账号会标记为“主账号”；如果图片渲染失败，会回退为文本列表。

```text
洛克.绑定列表
```

> 图片位置：绑定列表截图。建议插入 `docs/images/account-bindings.png`。

### `洛克.切换 <序号>`

切换当前用户的主账号。序号来自 `洛克.绑定列表`。

```text
洛克.切换 2
```

> 图片位置：切换账号结果截图。建议插入 `docs/images/account-switch.png`。

### `洛克.解绑 <序号>`

解绑指定序号的账号，并尝试删除服务端绑定记录。

```text
洛克.解绑 1
```

> 图片位置：解绑账号结果截图。建议插入 `docs/images/account-unbind.png`。

### `洛克.刷新`

刷新当前主账号凭证。当前实现主要适用于 QQ 扫码绑定的账号。

```text
洛克.刷新
```

> 图片位置：刷新凭证结果截图。建议插入 `docs/images/account-refresh.png`。

## 数据查询

以下功能需要先绑定账号。如果凭证过期，请重新登录或使用 `洛克.刷新`。

### `洛克.档案`

生成个人档案卡片，展示角色基础信息、评分、收藏、AI 点评、雷达图、近期战绩和部分玩家扩展资料。

```text
洛克.档案
```

> 图片位置：个人档案卡片截图。建议插入 `docs/images/query-profile.png`。

### `洛克.战绩 [页码]`

查看对战战绩概览和近期战斗记录。

```text
洛克.战绩
洛克.战绩 2
```

> 图片位置：战绩截图。建议插入 `docs/images/query-record.png`。

### `洛克.背包 [分类] [页码]`

查看精灵背包。支持按分类筛选，也支持翻页。

可用分类：

- `全部`
- `了不起`
- `异色`
- `炫彩`

示例：

```text
洛克.背包
洛克.背包 异色
洛克.背包 炫彩 2
洛克.背包 了不起精灵 3
```

> 图片位置：背包截图。建议插入 `docs/images/query-package.png`。

### `洛克.阵容 [分类] [页码]`

查看阵容推荐列表。参数可用来指定分类或页码。

```text
洛克.阵容
洛克.阵容 热门 2
洛克.阵容 PVP
```

> 图片位置：阵容推荐截图。建议插入 `docs/images/query-lineup.png`。

### `查看阵容 <阵容码>`

查看指定阵容的详情，包括阵容名称、标签、作者、精灵、技能和血脉信息。

示例：

```text
查看阵容 123456
```

> 图片位置：阵容详情截图。建议插入 `docs/images/query-lineup-detail.png`。

### `洛克.交换大厅 [页码]`

查看玩家交换大厅帖子。支持翻页。

示例：

```text
洛克.交换大厅
洛克.交换大厅 2
```

> 图片位置：交换大厅截图。建议插入 `docs/images/query-exchange-hall.png`。

## 远行商人

### `远行商人`

查看当前远行商人的商品、轮次和剩余时间。当前轮次按每日 `08:00 / 12:00 / 16:00 / 20:00` 计算。

```text
远行商人
```

> 图片位置：远行商人商品截图。建议插入 `docs/images/merchant-current.png`。

### `订阅远行商人 [商品名...]`

在群聊中订阅远行商人商品提醒。群内操作仅 `adminUserIds` 中配置的 Bot 管理员可设置；私聊场景支持个人自行订阅（需开启 `merchantPrivateSubscriptionEnabled`）。

查看当前订阅：

```text
订阅远行商人
```

设置订阅商品：

```text
订阅远行商人 国王球 棱镜球 炫彩精灵蛋
```

插件会定时检查远行商人商品，当当前商品命中订阅关键词时推送提醒。

> 图片位置：订阅远行商人结果截图。建议插入 `docs/images/merchant-subscribe.png`。

### `取消订阅远行商人`

取消当前群聊的远行商人订阅。群内操作仅 `adminUserIds` 中配置的 Bot 管理员可以操作；私聊场景可自行取消个人订阅。

```text
取消订阅远行商人
```

> 图片位置：取消订阅截图。建议插入 `docs/images/merchant-unsubscribe.png`。

## 家园订阅

### `订阅家园菜园 [uid]`

订阅指定 UID 的家园菜园成熟提醒。私聊场景可自行订阅；群聊场景仅 `adminUserIds` 中配置的 Bot 管理员可设置。

```text
订阅家园菜园
订阅家园菜园 12345678
```

不传 `uid` 时，会优先使用你当前绑定账号的 UID。

### `订阅家园灵感 [uid]`

订阅指定 UID 的家园精灵灵感完成提醒。私聊场景可自行订阅；群聊场景仅 `adminUserIds` 中配置的 Bot 管理员可设置。

```text
订阅家园灵感
订阅家园灵感 12345678
```

不传 `uid` 时，会优先使用你当前绑定账号的 UID。

### `取消订阅家园 [kind] [uid]`

取消当前会话的家园订阅。私聊场景可自行取消；群聊场景仅 `adminUserIds` 中配置的 Bot 管理员可操作。

```text
取消订阅家园
取消订阅家园 菜园
取消订阅家园 灵感 12345678
```

## Wiki 查询

### `洛克.wiki <精灵名>`

该功能暂时关闭。发送指令后会返回“该功能暂时关闭”。

```text
洛克.wiki 喵喵
```

> 图片位置：精灵 Wiki 查询截图。建议插入 `docs/images/wiki-pet.png`。

### `洛克.技能 <技能名>`

该功能暂时关闭。发送指令后会返回“该功能暂时关闭”。

```text
洛克.技能 火花
```

> 图片位置：技能 Wiki 查询截图。建议插入 `docs/images/wiki-skill.png`。

## 查蛋配种

查蛋配种功能使用本地 `Pets.json` 数据和后端尺寸查询接口，不需要登录账号。

### `洛克.查蛋 <精灵名>`

查询指定精灵的蛋组、性别比、孵化时间、身高体重范围、异色蛋概率、同蛋组可配种精灵等信息。

示例：

```text
洛克.查蛋 喵喵
```

匹配规则：

- 精确命中时直接展示查蛋结果。
- 模糊命中一个结果时会提示模糊匹配。
- 命中多个结果时会展示候选列表。

> 图片位置：精灵查蛋结果截图。建议插入 `docs/images/egg-search.png`。

### `洛克.查蛋 <身高> [体重]`

按尺寸反查精灵。身高使用游戏原生单位 `m`，体重使用 `kg`。同时提供身高和体重时，会优先调用后端尺寸查询接口；如果后端无结果，则回落到本地数据查询。

示例：

```text
洛克.查蛋 0.18
洛克.查蛋 0.18 1.5
洛克.查蛋 0.18m 1.5kg
洛克.查蛋 身高0.18m 体重1.5kg
```

> 图片位置：尺寸反查结果截图。建议插入 `docs/images/egg-size-search.png`。

### 查蛋候选结果

当精灵名称命中多个候选时，插件会展示候选列表。请根据候选列表使用更精确的名称重新查询。

```text

```

> 图片位置：查蛋候选结果截图。建议插入 `docs/images/egg-candidates.png`。

### `洛克.配种 <精灵名>`

查询想要孵出某个目标精灵时，可以选择哪些父体。默认孵蛋结果跟随母体，所以目标精灵会作为母体展示。

适合在你已经确定“目标宝宝”时使用。例如想孵出喵喵，就只需要输入目标精灵名，插件会返回可用于配种的父体方案。

示例：

```text
洛克.配种 喵喵
```

返回内容通常包括：

- 目标精灵信息
- 可选父体列表
- 相关蛋组
- 孵化时间
- 身高体重范围

> 图片位置：目标配种方案截图。建议插入 `docs/images/egg-want.png`。

### `洛克.配种 <父体> <母体>`

判断两只精灵是否可以配种。默认前一个参数为父体，后一个参数为母体，孵蛋结果跟随母体。

参数顺序很重要：

- 第一个参数：父体
- 第二个参数：母体
- 孵蛋结果：跟随母体

```text
洛克.配种 父体名称 母体名称
```

示例：

```text
洛克.配种 喵喵 火花
```

返回内容包括：

- 是否可以配种
- 共享蛋组
- 无法配种原因
- 孵化时长
- 身高体重范围

常见用法：

- 只输入一个精灵名：查询“怎样孵出这个精灵”
- 输入两个精灵名：判断“这两只精灵能不能配”
- 名称命中多个候选时：插件会返回候选列表，请换成更精确的精灵名重新查询

> 图片位置：配种判定截图。建议插入 `docs/images/egg-pair.png`。

## 管理命令

管理命令仅允许 `adminUserIds` 中配置的用户使用。

### `洛克.刷新所有凭证`

批量刷新所有用户的主账号凭证。仅支持可刷新的 QQ 扫码绑定账号。

```text
洛克.刷新所有凭证
```

> 图片位置：刷新所有凭证结果截图。建议插入 `docs/images/admin-refresh-all.png`。

### `洛克.删除失效绑定`

检查所有用户绑定的有效性，移除失效绑定，并清理对应本地凭证。

```text
洛克.删除失效绑定
```

> 图片位置：删除失效绑定结果截图。建议插入 `docs/images/admin-clean-invalid.png`。

### 自动刷新凭证

开启 `autoRefreshEnabled` 后，插件会按 `autoRefreshTime` 配置的时间点自动刷新所有可刷新的 QQ 绑定账号。

推荐配置示例：

```yaml
autoRefreshEnabled: true
autoRefreshTime:
  - "00:00"
  - "12:00"
```

> 图片位置：自动刷新配置截图。建议插入 `docs/images/admin-auto-refresh.png`。

## 常见问题

### 提示“您尚未绑定洛克王国账号”

请先使用 `洛克.QQ登录` 或 `洛克.微信登录` 绑定账号，再使用档案、战绩、背包、阵容、交换大厅等账号相关功能。

> 图片位置：未绑定提示截图。建议插入 `docs/images/faq-not-bound.png`。

### 图片生成失败

请检查：

- 是否启用了 `koishi-plugin-puppeteer`。
- Puppeteer 是否能正常启动浏览器。
- 服务器是否能访问模板中引用的远程图片。
- 平台是否允许发送图片消息。

插件在图片失败时会尽量发送文字回退结果。

> 图片位置：图片生成失败排查截图。建议插入 `docs/images/faq-render-failed.png`。

### QQ 扫码登录超时

二维码有效期约 2 分钟。超时后请重新发送 `洛克.QQ登录`。

> 图片位置：登录超时提示截图。建议插入 `docs/images/faq-login-timeout.png`。

### 远行商人订阅没有推送

请检查：

- `merchantSubscriptionEnabled` 是否开启。
- 群聊是否已经使用 `订阅远行商人 <商品名>` 设置订阅。
- 商品名称是否能匹配当前远行商人商品。
- Bot 是否有向目标群聊发送消息的权限。

> 图片位置：远行商人订阅排查截图。建议插入 `docs/images/faq-merchant-subscription.png`。

## 图片占位清单

建议将后续截图统一放在 `docs/images/` 目录下。

| 功能 | 建议图片路径 |
| --- | --- |
| 插件总览 | `docs/images/overview.png` |
| 服务启用 | `docs/images/setup-services.png` |
| 插件配置 | `docs/images/config.png` |
| 快速开始 | `docs/images/quick-start.png` |
| 帮助菜单 | `docs/images/help-menu.png` |
| QQ 登录 | `docs/images/account-qq-login.png` |
| 微信登录 | `docs/images/account-wechat-login.png` |
| 凭证导入 | `docs/images/account-import.png` |
| 绑定列表 | `docs/images/account-bindings.png` |
| 切换账号 | `docs/images/account-switch.png` |
| 解绑账号 | `docs/images/account-unbind.png` |
| 刷新凭证 | `docs/images/account-refresh.png` |
| 个人档案 | `docs/images/query-profile.png` |
| 战绩 | `docs/images/query-record.png` |
| 背包 | `docs/images/query-package.png` |
| 阵容推荐 | `docs/images/query-lineup.png` |
| 阵容详情 | `docs/images/query-lineup-detail.png` |
| 交换大厅 | `docs/images/query-exchange-hall.png` |
| 远行商人 | `docs/images/merchant-current.png` |
| 订阅远行商人 | `docs/images/merchant-subscribe.png` |
| 取消订阅远行商人 | `docs/images/merchant-unsubscribe.png` |
| 精灵 Wiki | `docs/images/wiki-pet.png` |
| 技能 Wiki | `docs/images/wiki-skill.png` |
| 精灵查蛋 | `docs/images/egg-search.png` |
| 尺寸反查 | `docs/images/egg-size-search.png` |
| 查蛋候选 | `docs/images/egg-candidates.png` |
| 目标配种方案 | `docs/images/egg-want.png` |
| 配种判定 | `docs/images/egg-pair.png` |
| 刷新所有凭证 | `docs/images/admin-refresh-all.png` |
| 删除失效绑定 | `docs/images/admin-clean-invalid.png` |
| 自动刷新配置 | `docs/images/admin-auto-refresh.png` |

## 许可证

本项目使用 MIT License。
