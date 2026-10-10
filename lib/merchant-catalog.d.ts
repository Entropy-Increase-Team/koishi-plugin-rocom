export declare const MERCHANT_ALL_ALIASES: Set<string>;
export interface MerchantCatalogItem {
    index: number;
    name: string;
    goods_id: number;
    item_id: number;
    item_num: number;
}
export declare function isAllAlias(token?: string): boolean;
/**
 * 把后端商品池归一成带序号的目录。
 *
 * 序号只取后端返回的顺序（index = 位置 + 1），解析订阅时立刻换成商品名落盘，
 * 所以后端调整目录顺序不会影响已有订阅。
 */
export declare function buildMerchantCatalog(randomGoods: unknown): MerchantCatalogItem[];
/**
 * 解析用户输入：序号 / 商品名 / 全部。
 *
 * - 纯数字按序号查目录，命中后换成规范名
 * - 目录里没有的文字按原样保留（后端随时会加新商品），同时记进 unrecognizedNames 供提示
 * - 目录为空（离线）时不报未识别，避免误伤
 */
export declare function resolveMerchantSelection(input: unknown, catalog: MerchantCatalogItem[]): {
    all: boolean;
    names: string[];
    unknownIndexes: string[];
    unrecognizedNames: string[];
};
/** 把订阅的商品名回显成「序号.名称」，方便用户对照商品列表。 */
export declare function describeMerchantItems(names: unknown, catalog: MerchantCatalogItem[]): string;
export declare class MerchantCatalogService {
    private filePath;
    private fetchRandomGoods;
    private memory;
    constructor(filePath: string, fetchRandomGoods: () => Promise<any>);
    /** 同步读磁盘缓存，供命令在离线时兜底。 */
    loadCachedCatalog(): MerchantCatalogItem[];
    writeCache(items: MerchantCatalogItem[]): boolean;
    /**
     * 取商品目录：内存缓存 → 后端全量商品池 → 磁盘缓存。
     * 全链路失败时返回上一次的目录（可能为空），由调用方决定怎么提示。
     */
    getCatalog(options?: {
        refresh?: boolean;
    }): Promise<MerchantCatalogItem[]>;
}
