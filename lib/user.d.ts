export interface Binding {
    binding_id: string;
    login_type: string;
    role_id: string;
    nickname: string;
    bind_time: number;
    is_primary: boolean;
}
export interface MerchantSubscription {
    group_id: string;
    channel_id?: string;
    platform?: string;
    user_id?: string;
    type?: string;
    mention_all: boolean;
    match_all?: boolean;
    items: string[];
    last_push_round: string | null;
    last_matched_items: string[];
    updated_by: string;
}
export interface HomeSubscription {
    key: string;
    kind: 'garden' | 'inspiration' | 'egg';
    uid: string;
    channel_id?: string;
    platform?: string;
    guild_id?: string;
    user_id?: string;
    updated_by: string;
    notify_state: {
        first?: boolean;
        all?: boolean;
    };
    updated_at: number;
    last_push_time?: number;
}
export declare class UserManager {
    private store;
    constructor(dataDir: string);
    getUserBindings(userId: string): Binding[];
    getPrimaryBinding(userId: string): Binding | null;
    saveUserBindings(userId: string, bindings: Binding[]): void;
    addBinding(userId: string, binding: Binding): void;
    deleteUserBinding(userId: string, index: number): Binding | null;
    switchPrimary(userId: string, index: number): boolean;
    removeBindingById(userId: string, bindingId: string): boolean;
    getAllUsersBindings(): Record<string, Binding[]>;
}
export declare class MerchantSubscriptionManager {
    private store;
    constructor(dataDir: string);
    upsert(key: string, sub: MerchantSubscription): void;
    get(key: string): MerchantSubscription | null;
    delete(key: string): boolean;
    getAll(): Record<string, MerchantSubscription>;
}
export declare class HomeSubscriptionManager {
    private store;
    constructor(dataDir: string);
    upsert(key: string, sub: HomeSubscription): void;
    deleteMatching(target: {
        platform?: string;
        channelId?: string;
        userId?: string;
    }, kind?: string, uid?: string): number;
    getAll(): Record<string, HomeSubscription>;
}
export interface AnnouncementSubscription {
    key: string;
    platform?: string;
    channel_id?: string;
    guild_id?: string;
    user_id?: string;
    updated_by: string;
    last_id?: string;
    since_ts?: number;
    updated_at: number;
}
export declare class AnnouncementSubscriptionManager {
    private store;
    constructor(dataDir: string);
    upsert(key: string, sub: AnnouncementSubscription): void;
    deleteMatching(target: {
        platform?: string;
        channelId?: string;
        userId?: string;
    }): number;
    getAll(): Record<string, AnnouncementSubscription>;
}
