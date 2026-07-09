import { Context } from 'koishi'
import { RocomClient } from './client'
import { UserManager, MerchantSubscriptionManager, HomeSubscriptionManager, AnnouncementSubscriptionManager } from './user'
import { EggService } from './egg-service'
import { Renderer } from './render'
import { WikiService } from './wiki-service'
import { AtlasService } from './atlas-service'

export interface PluginConfig {
  apiBaseUrl: string
  wegameApiKey: string
  qqLoginDebugMode: boolean
  adminUserIds: string[]
  autoRefreshEnabled: boolean
  autoRefreshTime: string[]
  merchantSubscriptionEnabled: boolean
  merchantSubscriptionItems: string[]
  merchantUiStyle: 'new' | 'old'
  merchantPrivateSubscriptionEnabled: boolean
  merchantCheckMode: 'interval' | 'times'
  merchantCheckInterval: number
  merchantCheckTimes: string[]
  homeSubscriptionEnabled: boolean
  homeSubscriptionIntervalMinutes: number
  announcementSubscriptionEnabled: boolean
  announcementPollIntervalMinutes: number
  homeQueryWaitMs: number
  homeQueryPollIntervalMs: number
  homeQueryTimeoutMs: number
  lowBandwidthMode: boolean
  imageCompressionEnabled: boolean
  imageCompressionMinBytes: number
  imageCompressionLevel: number
}

export interface PluginDeps {
  ctx: Context
  config: PluginConfig
  client: RocomClient
  userMgr: UserManager
  merchantSubMgr: MerchantSubscriptionManager
  homeSubMgr: HomeSubscriptionManager
  announcementSubMgr: AnnouncementSubscriptionManager
  eggService: EggService
  renderer: Renderer
  wikiService: WikiService
  atlasService: AtlasService
}
