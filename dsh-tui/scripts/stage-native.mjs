import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const source = resolve('native/target/release/dsh-tui')
const target = resolve('lib/native/dsh-tui')
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
chmodSync(target, 0o755)
