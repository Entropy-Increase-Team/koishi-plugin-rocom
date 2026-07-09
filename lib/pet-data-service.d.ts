export interface PetDataOptionMaps {
    natures: Record<string, string>;
    bloodlines: Record<string, string>;
    types: Record<string, string>;
    talent_ratings: Record<string, string>;
}
export declare function petDataDisplay(value: any, defaultText?: string): string;
export declare function petDataImageUrl(petId: any, imageType?: 'image' | 'icon'): string;
export declare function petDataWikiPetId(value: any): string;
export declare function normalizeEpochSeconds(value: any): number;
export declare function petDataTimeText(value: any): string;
export declare function petDataSizeText(value: any, unit: 'g' | 'cm' | string): string;
export declare function petDataVoiceText(value: any): string;
export declare function petDataVoiceInfo(value: any): {
    value: string;
    hint: string;
    className: string;
};
export declare function petDataKgCompact(grams: any): string;
export declare function petDataWeightSizeInfo(pet: any, wikiPet: any): {
    label?: string;
    className?: string;
    hint?: string;
};
export declare function petDataOptionMaps(options: any): PetDataOptionMaps;
export declare function petDataLookup(mapping: Record<string, string>, value: any, defaultText?: string): string;
export declare function petDataVariant(pet: any, fallback?: any): {
    variantText: string;
    variantIcon: string;
};
export declare function petDataAttributes(pet: any): Array<{
    label: string;
    value: string;
    race: string;
    talent: string;
    percent: number;
}>;
export declare function petDataSkillItems(pet: any): any[];
export declare function petDataSkillIdsFromPayload(payload: any): string[];
export declare function petDataPetIdsFromPayload(payload: any): string[];
export declare function petDataSkillIconUrl(baseUrl: string, skillId: any, detail?: any): string;
export declare function petDataSkills(pet: any, skillLookup?: Record<string, any>, options?: {
    loadSkillIcons?: boolean;
    baseUrl?: string;
}): any[];
export declare function petDataCardItems(pet: any, optionMaps: PetDataOptionMaps, sizeInfo?: {
    label?: string;
    className?: string;
    hint?: string;
}): any[];
export declare function petDataExtractItems(payload: any, optionMaps: PetDataOptionMaps, skillLookup?: Record<string, any>, sizeLookup?: Record<string, any>, options?: {
    loadSkillIcons?: boolean;
    baseUrl?: string;
}): any[];
export declare function buildPetDataRenderData(res: any, uid: string, options?: {
    optionsPayload?: any;
    skillLookup?: Record<string, any>;
    sizeLookup?: Record<string, any>;
    singleQuery?: boolean;
    lowBandwidthMode?: boolean;
    baseUrl?: string;
}): any;
