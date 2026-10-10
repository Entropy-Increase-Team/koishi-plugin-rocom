export declare function merchantPriceDateKey(date?: Date): string;
export interface MerchantPriceSnapshot {
    price: number;
    origin_price: number;
    buy_limit_num: number;
    at: string;
}
export interface MerchantPriceEntry {
    goods_id: number;
    name: string;
    item_id: number;
    item_num: number;
    buy_limit_num: number;
    by_round: Record<string, MerchantPriceSnapshot>;
    price: number;
    origin_price: number;
    round: number;
}
export interface MerchantPriceLogItem {
    goods_id: number;
    name: string;
    goods_name?: string;
    item_id?: unknown;
    item_num?: unknown;
    buy_limit_num?: unknown;
    limit_buy_num?: unknown;
    price?: unknown;
    origin_price?: unknown;
}
export interface MerchantPriceLookup {
    goods_id: number;
    name: string;
    price: number;
    origin_price: number;
    buy_limit_num: number;
    item_id: number;
    item_num: number;
    round: number;
}
interface PriceLogState {
    date: string;
    updated_at: string;
    items: Record<string, MerchantPriceEntry>;
}
export declare class MerchantPriceLog {
    private filePath;
    private state;
    constructor(filePath: string);
    /** 读盘；日期不是今天就当作已清空（游戏内自然日滚动）。 */
    load(now?: Date): PriceLogState;
    save(now?: Date): void;
    /** 记录一批实时商品（价格 <= 0 的跳过，避免把无效值写进去）。 */
    record(goods: MerchantPriceLogItem[], options?: {
        now?: Date;
        round?: number;
    }): boolean;
    /** 按 goods_id（优先同名轮次）查当天记录，查不到再退回商品名。 */
    lookup(goodsId: unknown, name?: string, round?: number, now?: Date): MerchantPriceLookup | null;
    /** 调试 / 测试用：当前记录快照。 */
    snapshot(): any;
    clear(now?: Date): void;
}
export {};
