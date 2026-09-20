import type { PluginConfig } from './types';
export type GroupRole = 'owner' | 'admin' | 'member' | 'unknown';
export interface SubscriptionPermissionInput {
    privateChat: boolean;
    privateAllowed: boolean;
    groupRole: GroupRole;
    groupAdminEnabled: boolean;
    botAdminEnabled: boolean;
    whitelisted: boolean;
    authority: number;
    botAdminAuthority: number;
}
export declare function mayManageSubscription(p: SubscriptionPermissionInput): boolean;
export declare function groupRoleFromSession(session: any): GroupRole;
export declare function isDirectSession(session: any): boolean;
export declare function canManageSubscription(config: PluginConfig, session: any, privateAllowed?: boolean): boolean;
