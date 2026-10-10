export declare const SHARE_CODE_MAX_LENGTH: number;
export type ShareCodeSource = 'parse' | 'record';
export declare function extractShareCode(input: string): string;
export declare function parsedRecord(record: any): any | null;
export declare function buildShareCodeView(payload: any, source: ShareCodeSource, record?: any, baseUrl?: string): {
    source: ShareCodeSource;
    sourceLabel: string;
    shareCode: string;
    shareCodePreview: string;
    version: number;
    spriteCount: number;
    mode: {
        id: number;
        name: string;
        icon: string;
        configured: boolean;
    };
    magic: {
        id: number;
        name: string;
        icon: string;
        configured: boolean;
    };
    teams: any;
    parseCount: number;
    firstSeen: string;
    lastSeen: string;
    shareCodeHash: string;
    commandHint: string;
    copyright: string;
};
export declare function buildShareCodeText(data: any): string;
export interface ShareCodeClassicAssets {
    frame: string;
    logo: string;
    rocoIcon: string;
    star: string;
    wax: string;
    typeIcon: (name: string) => string;
    bloodIcon: (element: string) => string;
}
export interface ClassicNatureInfo {
    name?: string;
    up?: string;
    down?: string;
    summary?: string;
}
export declare function parseNaturePair(summary: unknown): {
    up: string;
    down: string;
};
export declare function buildShareCodeClassicView(view: any, assets: ShareCodeClassicAssets, natureLookup?: (id: string) => ClassicNatureInfo): {
    team: {
        mode_name: any;
        share_code: any;
        sprite_count: any;
        count_label: string;
        magic_icon: any;
        teams: any;
    };
    shareAssets: {
        frame: string;
        logo: string;
        rocoIcon: string;
        star: string;
        wax: string;
    };
};
