import { Context, Schema } from 'koishi';
export declare const name = "rocom";
export declare const inject: {
    required: string[];
};
export interface Config {
    apiBaseUrl: string;
    wegameApiKey: string;
    qqLoginDebugMode: boolean;
    adminUserIds: string[];
    autoRefreshEnabled: boolean;
    autoRefreshTime: string[];
    merchantSubscriptionEnabled: boolean;
    merchantSubscriptionItems: string[];
    merchantUiStyle: 'new' | 'old';
    merchantPrivateSubscriptionEnabled: boolean;
    merchantCheckMode: 'interval' | 'times';
    merchantCheckInterval: number;
    merchantCheckTimes: string[];
    homeSubscriptionEnabled: boolean;
    homeSubscriptionIntervalMinutes: number;
    announcementSubscriptionEnabled: boolean;
    announcementPollIntervalMinutes: number;
    homeQueryWaitMs: number;
    homeQueryPollIntervalMs: number;
    homeQueryTimeoutMs: number;
    lowBandwidthMode: boolean;
    atlasZipUrls: string[];
    atlasGitUrl: string;
    imageCompressionEnabled: boolean;
    imageCompressionMinBytes: number;
    imageCompressionLevel: number;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
