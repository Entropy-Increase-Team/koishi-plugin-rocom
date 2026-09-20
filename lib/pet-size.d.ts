export interface WeightClass {
    label: '小块头' | '大块头';
    css: 'size-small' | 'size-large';
    threshold: number;
}
export declare function classifyWeight(weightKg: number, minKg: number, maxKg: number): WeightClass | null;
export interface SizeVariant {
    size_variant: string;
    size_variant_label: string;
    size_variant_class: string;
    size_variant_hint: string;
}
export declare function sizeVariantPayload(queryWeight: unknown, minKg: unknown, maxKg: unknown, rangeText?: string): SizeVariant;
