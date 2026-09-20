export interface PlayerRow {
    field?: string;
    label?: string;
    value?: unknown;
}
export type IngamePlayerPayload = {
    rows?: PlayerRow[];
    notes?: unknown[];
    title?: string;
    player_info?: Record<string, any>;
    player_card_brief_info?: Record<string, any>;
    [key: string]: any;
};
export declare function resourceUrl(value: unknown, apiBaseUrl: string): string;
export declare function playerRows(payload: any, uid: string): PlayerRow[];
export declare function cleanPlayerFieldValue(field: string, value: unknown): string;
export interface ParsedPlayer {
    title: string;
    nickname: string;
    uid: string;
    level: string;
    signature: string;
    rowMap: Record<string, string>;
    labelMap: Record<string, string>;
}
export declare function parseIngamePlayerPayload(payload: IngamePlayerPayload | null | undefined, uid: string): ParsedPlayer;
export declare function playerField(parsed: ParsedPlayer | null, field: string, defaultValue?: string): string;
export interface PlayerView {
    parsed: ParsedPlayer;
    cardImageUrl: string;
}
export declare function buildPlayerView(searchPayload: any, cardPayload: any, uid: string, apiBaseUrl: string): PlayerView;
export declare function mergePlayerPayloads(searchPayload: any, cardPayload: any): any;
export declare function playerPayloadUid(payload: any): string;
export declare function buildPlayerText(payload: any, uid: string): string;
