// 元素配色表，供信笺风阵容分享与家园详情 classic 模板共用。
export const ELEMENT_COLORS: Record<string, string> = {
  草: '#4ebc73',
  火: '#db5525',
  水: '#3f89b4',
  光: '#6aa9fe',
  地: '#9a7e3f',
  冰: '#63aeda',
  龙: '#ed4962',
  电: '#e7c506',
  毒: '#ba62e0',
  虫: '#96ca0f',
  武: '#ff9636',
  翼: '#3ec7ca',
  萌: '#fc74a7',
  幽: '#9446ec',
  恶: '#cf467a',
  机械: '#40cba9',
  幻: '#9fa7f8',
  普通: '#babbc6',
  无: '#babbc6',
}

export function elementColor(name: string): string {
  return ELEMENT_COLORS[String(name || '').trim()] || '#a687d5'
}

// 「烈焰血脉」→「火」这类血脉名到元素名的归一。
export function bloodlineElement(name: string): string {
  return String(name || '').replace(/系血脉$/, '').replace(/血脉$/, '').trim() || '普通'
}
