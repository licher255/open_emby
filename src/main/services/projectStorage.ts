import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const writes = new Map<string, Promise<unknown>>()

/** Include the Git commit in the transaction so another operation cannot stage its files. */
export async function withProjectWrite<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(dir)
  const previous = writes.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(action)
  writes.set(key, next)
  try { return await next }
  finally { if (writes.get(key) === next) writes.delete(key) }
}

export function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.write-${randomUUID()}.tmp`)
  try {
    const fd = openSync(temporary, 'wx')
    try { writeFileSync(fd, data, 'utf8'); fsyncSync(fd) }
    finally { closeSync(fd) }
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

class UnsupportedStateVersion extends Error {}

function readSnapshot(dir: string, path: string): Record<string, unknown> {
  const state = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid project state')
  if (state.schemaVersion !== undefined && state.schemaVersion !== 1) {
    throw new UnsupportedStateVersion(`Unsupported project state version ${state.schemaVersion}`)
  }
  const artifact = (state.stitches as { $artifact?: unknown } | null)?.$artifact
  if (artifact !== undefined) {
    if (typeof artifact !== 'string' || !artifact) throw new Error('Invalid stitch artifact reference')
    const file = resolve(dir, artifact)
    const local = relative(resolve(dir), file)
    if (isAbsolute(artifact) || isAbsolute(local) || local === '..' || local.startsWith(`..\\`) || local.startsWith('../')) {
      throw new Error('Stitch artifact must be inside its project')
    }
    const data = readFileSync(file, 'utf8')
    const digest = /^artifacts\/stitches-([a-f0-9]{64})\.json$/.exec(artifact)?.[1]
    if (digest && createHash('sha256').update(data).digest('hex') !== digest) throw new Error('Stitch artifact checksum mismatch')
    state.stitches = JSON.parse(data)
    if (!Array.isArray((state.stitches as { points?: unknown })?.points)) throw new Error('Invalid stitch artifact')
  }
  return state
}

export function loadStateSnapshot(dir: string): Record<string, unknown> | null {
  const current = join(dir, 'state.json')
  const backup = join(dir, '.state-backup.json')
  if (!existsSync(current) && !existsSync(backup)) return null
  try { return readSnapshot(dir, current) }
  catch (error) {
    if (error instanceof UnsupportedStateVersion) throw error
    if (!existsSync(backup)) throw new Error(`Cannot read project state. Restore a project version. ${String(error)}`)
    const recovered = readSnapshot(dir, backup)
    console.warn(`[project] recovered previous state from ${backup}`)
    return recovered
  }
}

/** Publish immutable stitches first, then atomically switch the state that references them. */
export function saveStateSnapshot(dir: string, state: Record<string, unknown>): void {
  const current = join(dir, 'state.json')
  const previous = loadStateSnapshot(dir)
  const encode = (value: Record<string, unknown>): string => {
    let out: Record<string, unknown> = { ...value, schemaVersion: 1 }
    const stitches = value.stitches as { points?: unknown } | null
    if (stitches && Array.isArray(stitches.points)) {
      const data = JSON.stringify(stitches)
      const digest = createHash('sha256').update(data).digest('hex')
      const artifact = `artifacts/stitches-${digest}.json`
      const path = join(dir, artifact)
      if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== digest) atomicWrite(path, data)
      out = { ...out, stitches: { $artifact: artifact } }
    }
    return JSON.stringify(out, null, 2)
  }
  const next = encode(state)
  if (previous) atomicWrite(join(dir, '.state-backup.json'), encode(previous))
  atomicWrite(current, next)
}
