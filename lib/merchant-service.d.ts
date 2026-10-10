export interface MerchantItem {
    id: string;
    parentId?: string;
    name: string;
    icon: string;
    price: number | null;
    limit: number | null;
    startsAt: number | null;
    endsAt: number | null;
    active: boolean;
    category: string;
    source: 'live' | 'legacy';
    allDay: boolean;
    itemId?: string;
    itemKind?: string;
}
export interface NormalizedMerchant {
    source: 'live' | 'legacy';
    items: MerchantItem[];
}
export declare const numberOrNull: (v: unknown) => number | null;
export declare function livePrice(value: any): number | null;
export declare function merchantTimestampMs(value: any): number | null;
export interface MerchantNormalizeOptions {
    secondsOfDay?: (ms: number) => number;
    assetBaseUrl?: string;
    fallbackIcon?: string;
}
export declare function isAllDayMerchantProduct(refreshAt: number | null, startsAt: number | null, endsAt: number | null, roundValue: unknown, secondsOfDay?: (ms: number) => number): boolean;
export declare function wikiItemAssetUrl(baseUrl: string | undefined, itemId: unknown, itemKind: unknown): string;
export declare function collectAllDayProductNames(items: Array<{
    name?: string;
    allDay?: boolean;
}>): Set<string>;
export declare function normalizeLiveMerchant(payload: any, nowMs?: number, options?: MerchantNormalizeOptions): MerchantItem[];
export declare function normalizeLegacyMerchant(payload: any, nowMs?: number, options?: MerchantNormalizeOptions): MerchantItem[];
export declare function isLiveMerchantPayload(payload: any): boolean;
export declare function normalizeMerchant(payload: any, nowMs?: number, options?: MerchantNormalizeOptions): NormalizedMerchant;
