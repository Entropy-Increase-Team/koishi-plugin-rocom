import { Context } from 'koishi';
import { RocomClient } from './client';
import { WikiCatalog } from './wiki-catalog';
export declare function normalizeQueryText(text: any): string;
export declare function wikiNamedValue(value: any): string;
export declare function wikiNames(values: any): string[];
export declare function wikiRangeLabel(data: any, keyMin: string, keyMax: string, unit: string): string;
export declare function similarityRatio(a: string, b: string): number;
export declare function wikiSimilarityScore(query: string, item: any): number;
export declare function wikiGenericValue(value: any, depth?: number): string;
export declare function wikiPickImage(item: any): string;
export declare function wikiTitleForItem(item: any, fallback?: string): string;
export declare function wikiMetaForItem(item: any, limit?: number, catalogKey?: string): Array<{
    label: string;
    value: string;
}>;
export declare function wikiCardForItem(item: any, fallback: string, catalog?: WikiCatalog | null): {
    title: string;
    image: string;
    summary: string;
    badges: string[];
    meta: {
        label: string;
        value: string;
    }[];
};
export declare function wikiSectionsForPayload(payload: any, catalog?: WikiCatalog | null): any[];
export declare function findExactWikiMatch(results: any[], query: string): any | null;
export declare function wikiCandidateText(query: string, items: any[], kind: string): string;
export declare function buildWikiPetRenderData(overview: any, profile: any, skills: any, family: any, handbook: any, query: string): {
    name: any;
    query: string;
    pet_id: any;
    number: any;
    form: any;
    formLine: string;
    quality: any;
    stage: any;
    pet_icon: any;
    main_image: any;
    type_names: string[];
    egg_groups: string[];
    description: any;
    classis: string;
    feature_name: any;
    feature_desc: any;
    ride_talent: string;
    height_label: string;
    weight_label: string;
    gender_ratio: string;
    move_type: any;
    habitats: string[];
    habitatsLabel: string;
    ecology: string;
    type_effectiveness: {
        label: string;
        value: string;
    }[];
    total_stats: any;
    pet_stats: {
        label: string;
        value: number;
        color: string;
        percent: number;
    }[];
    skill_groups: any[];
    family_members: any[];
    handbook_topics: any[];
    areas: string[];
    areasLabel: string;
    commandHint: string;
    copyright: string;
};
export declare function buildWikiSkillRenderData(item: any, petsData: any, query: string): {
    name: any;
    skill_id: any;
    query: string;
    icon: any;
    type: string;
    skill_type: string;
    damage_type: string;
    element_type: string;
    cost: any;
    power: any;
    families: any;
    description: any;
    flavor_text: any;
    tags: any;
    pets: any;
    pet_total: any;
    commandHint: string;
    copyright: string;
};
export declare function splitWikiCommandParts(text: string): {
    parts: string[];
    pageNo: number;
};
export declare function wikiCatalogByToken(token: string): WikiCatalog | null;
export declare class WikiService {
    private ctx;
    private client;
    private catalogsCache;
    private catalogsCacheTs;
    private optionsCache;
    private optionsCacheTs;
    private skillDetailCache;
    private petDetailCache;
    constructor(ctx: Context, client: RocomClient);
    getCatalogsPayload(force?: boolean): Promise<any>;
    getOptionsPayload(force?: boolean): Promise<any>;
    backendCatalogItems(payload: any): any[];
    catalogFromBackendItem(item: any): WikiCatalog;
    catalogForKeyFromPayload(key: string, catalogsPayload: any): WikiCatalog | null;
    catalogsFromPayload(catalogsPayload: any): WikiCatalog[];
    getCatalogByKey(key: string): Promise<WikiCatalog | null>;
    dynamicCatalogByToken(token: string, catalogsPayload: any): WikiCatalog | null;
    parseWikiCommand(text: string): {
        catalog: WikiCatalog | null;
        query: string;
        pageNo: number;
    };
    catalogUsageText(): string;
    buildCatalogRenderData(catalogsPayload: any, optionsPayload: any): {
        title: string;
        subtitle: string;
        summary: string;
        badges: any[];
        facts: any[];
        primary: any[];
        groups: {
            title: string;
            desc: string;
            items: {
                title: string;
                key: string;
                summary: string;
                desc: string;
                children: string;
            }[];
            total: number;
        }[];
        commandHint: string;
        copyright: string;
    };
    globalSearchCatalogs(catalogsPayload: any): WikiCatalog[];
    resultCommandExamples(items: any[], catalog?: WikiCatalog | null, limit?: number): string[];
    wikiPathParamsFromItem(catalog: WikiCatalog, item: any, rawText?: string): Record<string, string>;
    fillDetailPath(catalog: WikiCatalog, params: Record<string, string>): string;
    itemMatchesQueryExact(catalog: WikiCatalog, item: any, query: string): boolean;
    findCatalogMatch(catalog: WikiCatalog, items: any[], query: string, allowSingle?: boolean): any | null;
    suggestCatalogItems(catalog: WikiCatalog | null, query: string, limit?: number): Promise<any[]>;
    buildGenericRenderData(catalog: WikiCatalog | {
        title: string;
        key: string;
    }, payload: any, query: string, mode: string, pageNo?: number): {
        title: string;
        subtitle: string;
        image: string;
        summary: any;
        badges: string[];
        facts: {
            label: string;
            value: string;
        }[];
        actionHint: string;
        actionExamples: string[];
        cards: any;
        sections: any[];
        commandHint: string;
        copyright: string;
    } | {
        title: string;
        subtitle: string;
        image: string;
        summary: string;
        badges: string[];
        facts: {
            label: string;
            value: string;
        }[];
        cards: any[];
        sections: any[];
        commandHint: string;
        copyright: string;
        actionHint?: undefined;
        actionExamples?: undefined;
    };
    private mergeDetailPayloads;
    private itemDetailCompanionKeys;
    enrichItemDetail(catalog: WikiCatalog, detail: any): Promise<any>;
    resolveWikiPet(query: string): Promise<{
        detail: any;
        candidates: any[];
        error: string;
    }>;
    resolveWikiSkill(query: string): Promise<{
        detail: any;
        candidates: any[];
        error: string;
    }>;
    fetchWikiPetSections(petId: any): Promise<{
        profile: any;
        skills: any;
        family: any;
        handbook: any;
    }>;
    getSkillDetailCached(skillId: string): Promise<any | null>;
    getPetDetailCached(petId: string): Promise<any | null>;
    fetchGenericCatalog(catalog: WikiCatalog, query: string, pageNo: number): Promise<{
        payload: any;
        mode: string;
        error: string;
    }>;
    private fetchDetailForCatalogItem;
    fetchGlobalSearch(query: string, pageNo: number): Promise<{
        payload: any;
        mode: string;
        error: string;
    }>;
}
