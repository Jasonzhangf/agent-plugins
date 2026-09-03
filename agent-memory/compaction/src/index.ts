import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'

/** The sole dsh-memory compaction provider; Basic owns surface safety and retry policy. */
export class MemoryCompactionEngine extends BasicCompactionEngine {
  constructor(ctx: ConstructorParameters<typeof BasicCompactionEngine>[0], config: BasicCompactionConfig = {}) {
    super(ctx, { ...config, memoryPrompt: true })
  }
}

export default MemoryCompactionEngine
