import { chmodSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib/native/dsh-tui')
if (existsSync(target)) chmodSync(target, 0o755)
