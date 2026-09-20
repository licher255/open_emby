/** 项目库：工业制版软件的工作单元。
 *  布局：<dataRoot>/projects/<id>/project.json + images/（导入的图稿与风格化产出） */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import type { ProjectImage, ProjectImageKind, ProjectInfo } from '@shared/types'
import { getSettings } from './settings'
import { commitAll, initRepo, logCommits, restoreCommit, type CommitInfo } from './projectGit'

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'])

function projectsRoot(): string {
  return join(getSettings().dataRoot, 'projects')
}

function projectDir(id: string): string {
  return join(projectsRoot(), id)
}

interface ProjectMeta { id: string; name: string; createdAt: string }

function readMeta(id: string): ProjectMeta | null {
  const p = join(projectDir(id), 'project.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

// ---------- 图片资产 manifest（角色 + 来源谱系，随 Git 留痕） ----------

interface ImageManifestEntry {
  name: string
  kind: ProjectImageKind
  derivedFrom?: string
  createdAt: string
  archivedAt?: string
}

function manifestPath(id: string): string {
  return join(projectDir(id), 'images', 'manifest.json')
}

function readManifest(id: string): ImageManifestEntry[] {
  const p = manifestPath(id)
  if (!existsSync(p)) return []
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return [] }
}

function writeManifest(id: string, entries: ImageManifestEntry[]): void {
  writeFileSync(manifestPath(id), JSON.stringify(entries, null, 2), 'utf-8')
}

function registerImage(id: string, name: string, kind: ProjectImageKind, derivedFrom?: string): void {
  const entries = readManifest(id).filter((e) => e.name !== name)
  entries.push({ name, kind, derivedFrom, createdAt: new Date().toISOString() })
  writeManifest(id, entries)
}

/** 旧项目没有 manifest：按文件名推断角色（stylized_* → stylized，其余 → original） */
function inferKind(name: string): ProjectImageKind {
  return name.startsWith('stylized') ? 'stylized' : 'original'
}

function imageFiles(id: string): ProjectImage[] {
  const dir = join(projectDir(id), 'images')
  if (!existsSync(dir)) return []
  const manifest = new Map(readManifest(id).map((e) => [e.name, e]))
  return readdirSync(dir)
    .filter((f) => IMG_EXT.has(extname(f).toLowerCase()))
    .map((f) => {
      const e = manifest.get(f)
      return {
        path: join(dir, f),
        name: f,
        kind: e?.kind ?? inferKind(f),
        derivedFrom: e?.derivedFrom,
        createdAt: e?.createdAt ?? statSync(join(dir, f)).mtime.toISOString()
      }
    })
    .filter((image) => !manifest.get(image.name)?.archivedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listProjects(): ProjectInfo[] {
  const root = projectsRoot()
  if (!existsSync(root)) return []
  const out: ProjectInfo[] = []
  for (const id of readdirSync(root)) {
    const meta = readMeta(id)
    if (!meta) continue
    out.push({ ...meta, imageCount: imageFiles(id).length })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function createProject(name: string): Promise<ProjectInfo> {
  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
  const meta: ProjectMeta = { id, name: name.trim() || '未命名项目', createdAt: new Date().toISOString() }
  mkdirSync(join(projectDir(id), 'images'), { recursive: true })
  writeFileSync(join(projectDir(id), 'project.json'), JSON.stringify(meta, null, 2), 'utf-8')
  await initRepo(projectDir(id))
  await commitAll(projectDir(id), 'Create project')
  return { ...meta, imageCount: 0 }
}

export function listProjectImages(id: string): ProjectImage[] {
  return imageFiles(id)
}

/** 归档图片：只从工作台隐藏，不删除原文件，仍可通过 Git 历史恢复。 */
export async function archiveProjectImage(id: string, imagePath: string): Promise<void> {
  if (!readMeta(id)) throw new Error(`项目不存在: ${id}`)
  const name = basename(imagePath)
  const file = join(projectDir(id), 'images', name)
  if (!existsSync(file)) throw new Error(`图片不存在: ${name}`)
  const entries = readManifest(id)
  const entry = entries.find((item) => item.name === name)
  if (entry) {
    entry.archivedAt = new Date().toISOString()
  } else {
    entries.push({ name, kind: inferKind(name), createdAt: statSync(file).mtime.toISOString(), archivedAt: new Date().toISOString() })
  }
  writeManifest(id, entries)
  await commitAll(projectDir(id), `Archive image ${name}`)
}

/** 重命名图片并同步 manifest 谱系和工作台中的绝对路径；扩展名始终沿用原文件。 */
export async function renameProjectImage(id: string, imagePath: string, requestedName: string): Promise<string> {
  if (!readMeta(id)) throw new Error(`项目不存在: ${id}`)
  const dir = join(projectDir(id), 'images')
  const oldName = basename(imagePath)
  const oldPath = join(dir, oldName)
  if (!existsSync(oldPath)) throw new Error(`图片不存在: ${oldName}`)
  const extension = extname(oldName)
  const stem = basename(requestedName.trim(), extname(requestedName.trim()))
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
  if (!stem) throw new Error('图片名称不能为空')
  const newName = `${stem}${extension}`
  const newPath = join(dir, newName)
  if (newName === oldName) return oldPath
  if (existsSync(newPath)) throw new Error(`已存在同名图片: ${newName}`)

  renameSync(oldPath, newPath)
  const entries = readManifest(id)
  if (!entries.some((entry) => entry.name === oldName)) {
    entries.push({ name: oldName, kind: inferKind(oldName), createdAt: statSync(newPath).mtime.toISOString() })
  }
  for (const entry of entries) {
    if (entry.name === oldName) entry.name = newName
    if (entry.derivedFrom === oldName) entry.derivedFrom = newName
  }
  writeManifest(id, entries)

  const statePath = join(projectDir(id), 'state.json')
  const state = loadProjectState(id) as (Record<string, unknown> & { plan?: { imagePath?: string } }) | null
  if (state) {
    for (const key of ['imagePath', 'stylizedPath', 'lineArtPath']) {
      if (state[key] === oldPath) state[key] = newPath
    }
    if (state.plan?.imagePath === oldPath) state.plan.imagePath = newPath
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8')
  }
  await commitAll(projectDir(id), `Rename image ${oldName} to ${newName}`)
  return newPath
}

/** 导入图片到项目（复制进项目 images/，重名自动加序号） */
export async function importImage(id: string, srcPath: string): Promise<string> {
  if (!readMeta(id)) throw new Error(`项目不存在: ${id}`)
  const dir = join(projectDir(id), 'images')
  mkdirSync(dir, { recursive: true })
  const ext = extname(srcPath)
  const stem = basename(srcPath, ext).replace(/[\\/:*?"<>|]/g, '_')
  let name = `${stem}${ext}`
  let n = 1
  while (existsSync(join(dir, name))) name = `${stem}_${n++}${ext}`
  const dest = join(dir, name)
  copyFileSync(srcPath, dest)
  registerImage(id, name, 'original')
  await commitAll(projectDir(id), `Import artwork ${name}`)
  return dest
}

/** 把 data URL 图片存进项目（风格化产出回存） */
export async function saveImageDataUrl(id: string, dataUrl: string, stem: string, kind: ProjectImageKind = 'stylized', derivedFrom?: string): Promise<string> {
  if (!readMeta(id)) throw new Error(`项目不存在: ${id}`)
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl)
  if (!m) throw new Error('非法的 data URL')
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const dir = join(projectDir(id), 'images')
  mkdirSync(dir, { recursive: true })
  let name = `${stem}.${ext}`
  let n = 1
  while (existsSync(join(dir, name))) name = `${stem}_${n++}.${ext}`
  const dest = join(dir, name)
  writeFileSync(dest, Buffer.from(m[2], 'base64'))
  registerImage(id, name, kind, derivedFrom)
  await commitAll(projectDir(id), `Stylized output ${name}`)
  return dest
}

/** 项目工作台状态（制版方案/针迹/当前选中图），持久化在 state.json 并被版本库跟踪 */
// 针迹序列（可达数万点、数 MB）不内嵌 state.json，外置为 stitches.json 引用，
// 避免每次 persist 都重写大 JSON；stitches.json 本身仍被 Git 跟踪，回退一致性不变。
const STITCHES_FILE = 'stitches.json'

export function loadProjectState(id: string): Record<string, unknown> | null {
  const p = join(projectDir(id), 'state.json')
  if (!existsSync(p)) return null
  try {
    const state = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown> & { stitches?: unknown }
    const ref = (state.stitches as { $artifact?: string } | null)?.$artifact
    if (ref) {
      const ap = join(projectDir(id), ref)
      state.stitches = existsSync(ap) ? JSON.parse(readFileSync(ap, 'utf-8')) : null
    }
    return state
  } catch { return null }
}

export async function saveProjectState(id: string, state: Record<string, unknown>, commitMessage: string): Promise<void> {
  if (!readMeta(id)) throw new Error(`项目不存在: ${id}`)
  let out = state
  const stitches = state.stitches as { points?: unknown } | null | undefined
  if (stitches && Array.isArray(stitches.points)) {
    writeFileSync(join(projectDir(id), STITCHES_FILE), JSON.stringify(stitches), 'utf-8')
    out = { ...state, stitches: { $artifact: STITCHES_FILE } }
  }
  writeFileSync(join(projectDir(id), 'state.json'), JSON.stringify(out, null, 2), 'utf-8')
  await commitAll(projectDir(id), commitMessage)
}

/** 项目版本历史（新→旧） */
export function projectHistory(id: string): Promise<CommitInfo[]> {
  return logCommits(projectDir(id))
}

/** 画布调整：sidecar 调用 Rust canvas_resize，结果登记为 original 资产（记录来源与物理尺寸） */
export async function canvasAdjust(
  id: string,
  srcPath: string,
  widthMm: number,
  heightMm: number,
  mode: string
): Promise<string> {
  if (!readMeta(id)) throw new Error(`项目不存在: ${id}`)
  const dir = join(projectDir(id), 'images')
  mkdirSync(dir, { recursive: true })
  const ext = extname(srcPath) || '.png'
  // 避免重复应用画布后文件名无限叠加 _100x100mm。
  const stem = basename(srcPath, extname(srcPath)).replace(/(?:_\d+(?:\.\d+)?x\d+(?:\.\d+)?mm)+$/i, '')
  let name = `${stem}_${widthMm}x${heightMm}mm${ext}`
  let n = 1
  while (existsSync(join(dir, name))) name = `${stem}_${widthMm}x${heightMm}mm_${n++}${ext}`
  const dest = join(dir, name)
  const res = await fetch(`${getSettings().sidecarUrl}/canvas/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: srcPath, destPath: dest, widthMm, heightMm, mode })
  })
  if (!res.ok) throw new Error(`画布调整失败: ${res.status} ${await res.text()}`)
  registerImage(id, name, 'original', basename(srcPath))
  await commitAll(projectDir(id), `Canvas ${widthMm}×${heightMm}mm (${mode})`)
  return dest
}

/** 回退到指定版本（内容恢复为新提交，不丢历史） */
export async function restoreProject(id: string, oid: string): Promise<void> {
  await restoreCommit(projectDir(id), oid)
}
