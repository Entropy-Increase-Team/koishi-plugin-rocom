import { Context } from 'koishi';
export interface SubscriptionTarget {
    platform?: string;
    channelId?: string;
    guildId?: string;
    userId?: string;
    selfId?: string;
}
export declare function sentMessageIds(value: unknown): boolean;
export declare function sendScheduledMessage(ctx: Context, target: SubscriptionTarget, message: any, signal?: AbortSignal): Promise<boolean>;
export declare function sendScheduledImageWithFallback(ctx: Context, target: SubscriptionTarget, image: Buffer | Buffer[] | null, fallbackText: string, mentionAll?: boolean, signal?: AbortSignal): Promise<boolean>;
