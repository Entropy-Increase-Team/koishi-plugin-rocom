import { Context } from 'koishi';
export type JsonObject = Record<string, unknown>;
export declare const isObject: (v: unknown) => v is JsonObject;
export declare function inheritGoodsMapping<T extends JsonObject>(parent: JsonObject, child: T): T & {
    _goods_mapping?: unknown;
};
/** 传给 ingame 请求的可选授权上下文：指定 UID 查询时透传凭证，不自动替换为主账号。 */
export interface IngameAuthContext {
    fwToken?: string;
    userIdentifier?: string;
}
export interface IngameTaskPollOptions {
    /** 服务端同步等待毫秒（long-poll），这段时间内服务端会尽量直接返回结果而不入队 */
    waitMs?: number;
    /** 进入排队后轮询任务状态的间隔毫秒 */
    intervalMs?: number;
    /** 进入排队后等待任务完成的总超时毫秒 */
    timeoutMs?: number;
    /** 任务进入排队（拿到 task_id）时回调一次，可用于向用户发送“排队中”提示 */
    onQueued?: (taskId: string) => void | Promise<void>;
    /** 取消信号；插件卸载或调用方放弃时用于中止在途请求与轮询 */
    signal?: AbortSignal;
}
export declare class RocomClient {
    private baseUrl;
    private apiKey;
    private timeout;
    private lastError;
    private lastErrorBrief;
    constructor(baseUrl: string, apiKey: string, timeout?: number);
    private sanitizeUid;
    private attachGoodsMapping;
    private wegameHeaders;
    private rocomHeaders;
    private formatHttpError;
    private simplifyErrorMessage;
    private shouldRetryIngameWithApiKey;
    private isSensitiveLogKey;
    private maskSensitiveValue;
    private sanitizeForLog;
    private headersForLog;
    private stringifyForLog;
    private logRequestFailureDetails;
    private get;
    private post;
    private scopedParams;
    private delete;
    private requestWithStatus;
    private requestIngameWithFallback;
    private getIngameTask;
    private static normalizeTaskStatus;
    private static extractTaskId;
    private static isCompletedGatewayPayload;
    private static inspectIngamePayload;
    private static taskErrorMessage;
    private pollIngameTask;
    private queuedQuery;
    qqQrLogin(ctx: Context, userIdentifier: string): Promise<any>;
    qqQrStatus(ctx: Context, fwToken: string, userIdentifier: string): Promise<any>;
    wechatQrLogin(ctx: Context, userIdentifier: string): Promise<any>;
    wechatQrStatus(ctx: Context, fwToken: string, userIdentifier: string): Promise<any>;
    importToken(ctx: Context, tgpId: string, tgpTicket: string, userIdentifier: string): Promise<any>;
    createBinding(ctx: Context, fwToken: string, userIdentifier: string): Promise<any>;
    refreshBinding(ctx: Context, bindingId: string, userIdentifier: string): Promise<any>;
    deleteBinding(ctx: Context, bindingId: string, userIdentifier: string): Promise<boolean>;
    getAccounts(ctx: Context, userIdentifier?: string, accountType?: number): Promise<any>;
    bindUid(ctx: Context, uid: string, userIdentifier?: string): Promise<any>;
    getRole(ctx: Context, fwToken: string, accountType?: number, userIdentifier?: string): Promise<any>;
    getEvaluation(ctx: Context, fwToken: string, userIdentifier?: string): Promise<any>;
    getLastError(defaultMessage?: string): string;
    getLastErrorBrief(defaultMessage?: string): string;
    private setLastError;
    getPetSummary(ctx: Context, fwToken: string, userIdentifier?: string): Promise<any>;
    getCollection(ctx: Context, fwToken: string, userIdentifier?: string): Promise<any>;
    getBattleOverview(ctx: Context, fwToken: string, userIdentifier?: string): Promise<any>;
    getBattleList(ctx: Context, fwToken: string, pageSize?: number, afterTime?: string, userIdentifier?: string): Promise<any>;
    private isIngamePlayerPayload;
    ingamePlayerSearch(ctx: Context, uid: string, options?: IngameTaskPollOptions & {
        auth?: IngameAuthContext;
    }): Promise<any>;
    ingamePlayerCard(ctx: Context, uid: string, options?: IngameTaskPollOptions & {
        auth?: IngameAuthContext;
        source?: string;
    }): Promise<any>;
    getPets(ctx: Context, fwToken: string, petSubset?: number, pageNo?: number, pageSize?: number, userIdentifier?: string): Promise<any>;
    getLineupList(ctx: Context, fwToken: string, pageNo?: number, category?: string, userIdentifier?: string): Promise<any>;
    getExchangePosters(ctx: Context, fwToken: string, pageNo?: number, userIdentifier?: string): Promise<any>;
    getMerchantInfo(ctx: Context, refresh?: boolean, options?: IngameTaskPollOptions & {
        auth?: IngameAuthContext;
    }): Promise<any>;
    queryPetSize(ctx: Context, diameter: number, weight: number, pool?: string, pageNo?: number, pageSize?: number, userIdentifier?: string): Promise<any>;
    searchEggBySize(ctx: Context, heightMeters: number, weightKg: number, pageNo?: number, pageSize?: number, userIdentifier?: string): Promise<any>;
    getPetCollectionRanking(ctx: Context, rankType: 'shining' | 'glass', limit?: number, uid?: string, options?: {
        userIdentifier?: string;
    }): Promise<any>;
    parseShareCode(ctx: Context, shareCode: string, userIdentifier?: string): Promise<any>;
    getShareCodeRecords(ctx: Context, options?: {
        shareCode?: string;
        hash?: string;
        pageNo?: number;
        pageSize?: number;
        modeId?: number;
        magicId?: number;
    }, userIdentifier?: string): Promise<any>;
    getActivitiesInfo(ctx: Context, refresh?: boolean, userIdentifier?: string): Promise<any>;
    syncConfig(ctx: Context, userIdentifier?: string): Promise<any>;
    getAnnouncementList(ctx: Context, params?: {
        category_id?: number | string;
        page?: number;
        limit?: number;
        order?: string;
    }, userIdentifier?: string): Promise<any>;
    getLatestAnnouncement(ctx: Context, params?: {
        category_id?: number | string;
        order?: string;
    }, userIdentifier?: string, signal?: AbortSignal): Promise<any>;
    getAnnouncementDetail(ctx: Context, threadId: number | string, userIdentifier?: string): Promise<any>;
    getEggGroups(ctx: Context, userIdentifier?: string): Promise<any>;
    getEggGroupPets(ctx: Context, groupIds: string | number[], matchMode?: 'any' | 'all', pageNo?: number, pageSize?: number, userIdentifier?: string): Promise<any>;
    getEggPetGroups(ctx: Context, query: string, limit?: number, userIdentifier?: string): Promise<any>;
    getEggExchanges(ctx: Context, params?: Record<string, any>, userIdentifier?: string): Promise<any>;
    postEggExchange(ctx: Context, data: Record<string, any>, userIdentifier?: string): Promise<any>;
    getMyEggExchanges(ctx: Context, params?: Record<string, any>, userIdentifier?: string): Promise<any>;
    getEggExchangeReviewStatus(ctx: Context, postId: string | number, userIdentifier?: string): Promise<any>;
    closeEggExchange(ctx: Context, postId: string | number, closeReason?: string, userIdentifier?: string): Promise<any>;
    createEggExchangeSubscription(ctx: Context, filters: Record<string, any>, userIdentifier?: string): Promise<any>;
    getEggExchangeSubscriptions(ctx: Context, userIdentifier?: string): Promise<any>;
    deleteEggExchangeSubscription(ctx: Context, subscriptionId: string | number, userIdentifier?: string): Promise<any>;
    getEggExchangeEvents(ctx: Context, subscriptionId: string | number, afterEventId?: string, limit?: number, userIdentifier?: string): Promise<any>;
    ingameHomeInfo(ctx: Context, uid: string, options?: IngameTaskPollOptions & {
        auth?: IngameAuthContext;
    }): Promise<any>;
    ingameMerchantInfo(ctx: Context, shopId?: string | number | null, options?: IngameTaskPollOptions & {
        auth?: IngameAuthContext;
    }): Promise<any>;
    ingamePetData(ctx: Context, uid: string, extras?: {
        petGid?: string | number;
        npcId?: string | number;
    }, options?: IngameTaskPollOptions & {
        auth?: IngameAuthContext;
    }): Promise<any>;
    getFriendship(ctx: Context, fwToken: string, userIds: string, userIdentifier?: string): Promise<any>;
    getStudentState(ctx: Context, fwToken: string, accountType?: number, userIdentifier?: string): Promise<any>;
    getStudentPerks(ctx: Context, fwToken: string, area?: number, accountType?: number, userIdentifier?: string): Promise<any>;
    searchWikiPet(ctx: Context, query: string, limit?: number): Promise<any>;
    searchWikiSkill(ctx: Context, query: string, limit?: number): Promise<any>;
    getWikiPetDetail(ctx: Context, options: {
        id?: number;
        name?: string;
    }): Promise<any>;
    private wikiPagedParams;
    listWikiPets(ctx: Context, q?: string, pageNo?: number, pageSize?: number, filters?: Record<string, any>): Promise<any>;
    getWikiPet(ctx: Context, petId: string | number): Promise<any>;
    getWikiPetProfile(ctx: Context, petId: string | number): Promise<any>;
    getWikiPetSkills(ctx: Context, petId: string | number): Promise<any>;
    getWikiPetFamily(ctx: Context, petId: string | number): Promise<any>;
    getWikiPetHandbook(ctx: Context, petId: string | number): Promise<any>;
    listWikiSkills(ctx: Context, q?: string, pageNo?: number, pageSize?: number, filters?: Record<string, any>): Promise<any>;
    getWikiSkill(ctx: Context, skillId: string | number): Promise<any>;
    getWikiSkillPets(ctx: Context, skillId: string | number): Promise<any>;
    getWikiCatalogs(ctx: Context): Promise<any>;
    getWikiOptions(ctx: Context): Promise<any>;
    getWikiPath(ctx: Context, path: string, params?: Record<string, any>): Promise<any>;
    listWikiCatalogItems(ctx: Context, path: string, q?: string, pageNo?: number, pageSize?: number, search?: boolean): Promise<any>;
    get wikiAssetBaseUrl(): string;
}
