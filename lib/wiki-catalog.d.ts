export interface WikiCatalog {
    key: string;
    title: string;
    aliases: string[];
    list_path?: string;
    detail_path: string;
    id_fields: string[];
    /** null 表示以后端 filters 是否带 q 为准 */
    search: boolean | null;
    _backend?: any;
}
export declare const WIKI_CATALOG_ROUTES: WikiCatalog[];
export declare const WIKI_CATALOG_ROUTES_BY_KEY: Map<string, WikiCatalog>;
export declare const WIKI_CATALOG_ROUTES_BY_ALIAS: Map<string, WikiCatalog>;
export declare function wikiGlobalCatalogPriority(catalog: {
    key?: string;
} | null | undefined): number;
export declare function wikiLabelForKey(key: string): string;
export declare function wikiSectionTitle(key: string): string;
