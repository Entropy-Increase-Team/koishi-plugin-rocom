import { PluginDeps } from '../types';
import { type ImageMetrics } from '../icon-metrics';
type MerchantCategoryKey = 'normal' | 'round' | 'weekend';
type MerchantProductForRender = {
    name: string;
    image: string;
    time_label: string;
    category: MerchantCategoryKey;
    round_id: number | null;
    is_active: boolean;
    start_time: number | null;
    end_time: number | null;
    price: number | null;
    limit: number | null;
    item_category: string;
    allDay: boolean;
    goods_id: string;
};
type MerchantCardItem = {
    goods_name: string;
    iconUrl: string;
    price: string | number;
    num: string;
    category: MerchantCategoryKey;
    roundId: number;
    isHot: boolean;
    isEnded: boolean;
    remainingStr: string;
    top: number;
};
export declare function buildMerchantRenderParams(pageHeight: number): {
    pageHeight: number;
    renderWidth: number;
    renderHeight: number;
    renderBaseWidth: number;
    renderBaseHeight: number;
    renderScale: number;
    renderZoom: number;
    renderDeviceScaleFactor: number;
    renderStroke11: number;
    renderStroke10: number;
    renderStrokeName: number;
    renderOffset3: number;
};
export declare function buildMerchantCardItems(products: MerchantProductForRender[], options: {
    includeEnded: boolean;
    iconMetrics?: Map<string, ImageMetrics>;
}): {
    pageHeight: number;
    renderWidth: number;
    renderHeight: number;
    renderBaseWidth: number;
    renderBaseHeight: number;
    renderScale: number;
    renderZoom: number;
    renderDeviceScaleFactor: number;
    renderStroke11: number;
    renderStroke10: number;
    renderStrokeName: number;
    renderOffset3: number;
    goods: {
        num: string;
        top: number;
        iconScale: number;
        iconOffsetX: number;
        iconOffsetY: number;
        goods_name: string;
        iconUrl: string;
        price: string | number;
        category: MerchantCategoryKey;
        roundId: number;
        isHot: boolean;
        isEnded: boolean;
        remainingStr: string;
    }[];
    bottomFrameTop: number;
};
/**
 * 今日卡片按轮次分行：热销（roundId 0，全天/跨天在架）置顶，第 1~4 轮升序。
 * 每件商品落在哪一轮由商品数据的 roundId 事先算好。
 */
export declare function buildTodayRows(goods: MerchantCardItem[], currentRoundId: number | null, iconMetrics?: Map<string, ImageMetrics>): {
    roundId: number;
    label: string;
    timeLabel: string;
    isCurrent: boolean;
    top: number;
    cellWidth: number;
    iconSize: number;
    items: {
        iconScale: number;
        iconOffsetX: number;
        iconOffsetY: number;
        goods_name: string;
        iconUrl: string;
        price: string | number;
        num: string;
        category: MerchantCategoryKey;
        roundId: number;
        isHot: boolean;
        isEnded: boolean;
        remainingStr: string;
        top: number;
    }[];
}[];
export declare function register(deps: PluginDeps): void;
export {};
