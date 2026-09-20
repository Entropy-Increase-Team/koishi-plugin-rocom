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
}
export interface NormalizedMerchant {
    source: 'live' | 'legacy';
    items: MerchantItem[];
}
export declare const numberOrNull: (v: unknown) => number | null;
export declare function livePrice(value: any): number | null;
export declare function merchantTimestampMs(value: any): number | null;
export declare function normalizeLiveMerchant(payload: any, nowMs?: number): MerchantItem[];
export declare function normalizeLegacyMerchant(payload: any, nowMs?: number): MerchantItem[];
export declare function isLiveMerchantPayload(payload: any): boolean;
export declare function normalizeMerchant(payload: any, nowMs?: number): NormalizedMerchant;
