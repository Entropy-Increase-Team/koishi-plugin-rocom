export type RankingKind = 'shining' | 'glass';
interface RankingMeta {
    title: string;
    subtitle: string;
    label: string;
    otherLabel: string;
    countField: string;
    otherCountField: string;
    theme: string;
}
export declare const RANKING_META: Record<RankingKind, RankingMeta>;
export interface RankingArgs {
    uid: string;
    limit: number;
}
export declare function parseRankingArgs(text: string, primaryUid?: string): RankingArgs;
export declare function formatRankingTime(value: unknown): string;
export declare function buildRankingView(payload: any, rankType: RankingKind, baseUrl: string, requestedUid?: string, now?: Date): {
    total: number;
    items: {
        rank: number;
        podiumClass: string;
        playerName: string;
        avatar: string;
        signature: string;
        primaryCount: number;
        secondaryCount: number;
        sampleCount: number;
        lastSeen: string;
    }[];
    current: any;
    requestedUid: string;
    shownCount: number;
    updatedAt: string;
    commandHint: string;
    copyright: string;
    title: string;
    subtitle: string;
    label: string;
    otherLabel: string;
    countField: string;
    otherCountField: string;
    theme: string;
};
export declare function buildRankingText(data: any): string;
export {};
