import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..', '..')
const diagramDir = join(packageRoot, 'docs/diagrams')
const manifestPath = join(diagramDir, 'render-manifest.json')
const verifySource = process.argv.includes('--verify-source')
const expectedRenderer = {
  mmdc_version: '11.12.0',
  chromium_version: '151.0.7922.34',
}

const diagrams = [
  { id: 'composition-owner', width: 1280 },
  { id: 'module-ownership', width: 1280 },
  { id: 'request-mainline', width: 1280 },
  { id: 'attempt-state-machine', width: 1280 },
  { id: 'key-health-state', width: 1280 },
  { id: 'restore-sequence', width: 1280 },
]

const readPngDimensions = async path => {
  const png = await readFile(path)
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error(`render-architecture-diagrams: invalid PNG header: ${path}`)
  }
  return `${String(png.readUInt32BE(16))}x${String(png.readUInt32BE(20))}`
}

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')

const commandVersion = (command, args, label) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`render-architecture-diagrams: cannot read ${label} version: ${result.stderr || result.stdout}`)
  }
  return String(result.stdout || result.stderr).trim()
}

const assertRendererVersions = (mmdc, executablePath) => {
  const mmdcVersion = commandVersion(mmdc, ['--version'], 'mmdc')
  const chromiumVersion = commandVersion(executablePath, ['--version'], 'Chromium')
    .replace(/^Google Chrome for Testing\s+/u, '')
  if (mmdcVersion !== expectedRenderer.mmdc_version
    || chromiumVersion !== expectedRenderer.chromium_version) {
    throw new Error(`render-architecture-diagrams: renderer version mismatch: mmdc=${mmdcVersion}, chromium=${chromiumVersion}`)
  }
}

const render = async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXE || process.env.PUPPETEER_EXECUTABLE_PATH
  if (!executablePath) {
    throw new Error('render-architecture-diagrams: PLAYWRIGHT_CHROMIUM_EXE or PUPPETEER_EXECUTABLE_PATH is required')
  }
  const mmdc = process.env.MMDC_BIN || 'mmdc'
  assertRendererVersions(mmdc, executablePath)
  const tempDir = await mkdtemp(join(tmpdir(), 'multikey-diagrams-'))
  try {
    const puppeteerConfig = join(tempDir, 'puppeteer.json')
    await writeFile(puppeteerConfig, JSON.stringify({
      executablePath,
      args: ['--no-sandbox'],
    }))
    for (const diagram of diagrams) {
      const source = join(diagramDir, `${diagram.id}.mmd`)
      const output = join(diagramDir, `${diagram.id}.png`)
      const result = spawnSync(mmdc, [
        '-i', source,
        '-o', output,
        '-w', String(diagram.width),
        '-p', puppeteerConfig,
      ], { encoding: 'utf8' })
      if (result.status !== 0) {
        throw new Error(`render-architecture-diagrams: ${diagram.id} failed: ${result.stderr || result.stdout}`)
      }
      await readPngDimensions(output)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

const verify = async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.status !== 'frozen') {
    throw new Error('render-architecture-diagrams: manifest status must be frozen')
  }
  if (manifest.renderer?.mmdc_version !== expectedRenderer.mmdc_version
    || manifest.renderer?.chromium_version !== expectedRenderer.chromium_version) {
    throw new Error('render-architecture-diagrams: manifest renderer versions are not pinned')
  }
  const files = (await readdir(diagramDir)).filter(name => name.endsWith('.mmd') || name.endsWith('.png')).sort()
  const manifestPaths = new Set(Object.values(manifest.renders).flatMap(render => [render.source, render.png]))
  if (manifestPaths.size !== files.length || files.some(name => !manifestPaths.has(`docs/diagrams/${name}`))) {
    throw new Error('render-architecture-diagrams: manifest does not bind every committed diagram source and PNG')
  }
  for (const [id, render] of Object.entries(manifest.renders)) {
    if (!diagrams.some(diagram => diagram.id === id)) {
      throw new Error(`render-architecture-diagrams: unknown manifest diagram ${id}`)
    }
    const sourcePath = join(packageRoot, render.source)
    const pngPath = join(packageRoot, render.png)
    const sourceSha = await sha256(sourcePath)
    const pngSha = await sha256(pngPath)
    if (sourceSha !== render.source_sha256 || pngSha !== render.png_sha256) {
      throw new Error(`render-architecture-diagrams: ${id} is not bound to the frozen source/PNG`)
    }
    const actual = await readPngDimensions(pngPath)
    if (actual !== render.dimensions) {
      throw new Error(`render-architecture-diagrams: ${id} is ${actual}, expected ${render.dimensions}`)
    }
  }
}

if (verifySource) {
  await verify()
} else {
  await render()
  const renders = {}
  for (const diagram of diagrams) {
    const source = `docs/diagrams/${diagram.id}.mmd`
    const png = `docs/diagrams/${diagram.id}.png`
    renders[diagram.id] = {
      source,
      png,
      dimensions: await readPngDimensions(join(packageRoot, png)),
      source_sha256: await sha256(join(packageRoot, source)),
      png_sha256: await sha256(join(packageRoot, png)),
    }
  }
  await writeFile(manifestPath, `${JSON.stringify({ status: 'frozen', renderer: expectedRenderer, renders }, null, 2)}\n`)
  console.log('ARCHITECTURE_DIAGRAMS: rendered and bound')
}
