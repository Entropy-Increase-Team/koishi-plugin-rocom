export interface WeightClass {
  label: '小块头' | '大块头'
  css: 'size-small' | 'size-large'
  threshold: number
}

// 体重范围下端 5% / 上端 5% 判定大小块头；使用未四舍五入的数值比较。
export function classifyWeight(weightKg: number, minKg: number, maxKg: number): WeightClass | null {
  if (![weightKg, minKg, maxKg].every(Number.isFinite) || maxKg <= minKg) return null
  if (weightKg < minKg || weightKg > maxKg) return null
  const span = maxKg - minKg
  const small = minKg + span * 0.05
  const large = maxKg - span * 0.05
  if (weightKg <= small) return { label: '小块头', css: 'size-small', threshold: small }
  if (weightKg >= large) return { label: '大块头', css: 'size-large', threshold: large }
  return null
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number, digits = 3): string {
  return String(Number(value.toFixed(digits)))
}

export interface SizeVariant {
  size_variant: string
  size_variant_label: string
  size_variant_class: string
  size_variant_hint: string
}

const EMPTY_VARIANT: SizeVariant = {
  size_variant: '',
  size_variant_label: '',
  size_variant_class: '',
  size_variant_hint: '',
}

export function sizeVariantPayload(
  queryWeight: unknown,
  minKg: unknown,
  maxKg: unknown,
  rangeText = '',
): SizeVariant {
  const query = num(queryWeight)
  const low = num(minKg)
  const high = num(maxKg)
  if (query === null || low === null || high === null || high <= low) return EMPTY_VARIANT
  const cls = classifyWeight(query, low, high)
  if (!cls) return EMPTY_VARIANT
  const limit = formatNumber(cls.threshold)
  const range = rangeText || `${formatNumber(low)}-${formatNumber(high)}kg`
  return {
    size_variant: cls.css === 'size-small' ? 'small' : 'large',
    size_variant_label: cls.label,
    size_variant_class: cls.css,
    size_variant_hint: cls.label === '小块头'
      ? `小块头区间：≤ ${limit} kg（体重范围 ${range} 的前 5%）`
      : `大块头区间：≥ ${limit} kg（体重范围 ${range} 的后 5%）`,
  }
}
