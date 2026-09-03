/** Locale copy for the composer concurrency stepper. */
export const zh = {
  'label': '并发请求上限',
  'current': '当前：{value}',
  'uncapped': '不限',
  'decrease': '减少并发请求上限',
  'increase': '增加并发请求上限',
  'reset': '恢复默认并发请求上限',
  'error': '调整失败',
} as const

export const en = {
  'label': 'Concurrent requests',
  'current': 'Current: {value}',
  'uncapped': 'Uncapped',
  'decrease': 'Decrease concurrent-request cap',
  'increase': 'Increase concurrent-request cap',
  'reset': 'Reset concurrent-request cap',
  'error': 'Adjustment failed',
} as const

export type ConcurrencyKey = keyof typeof zh