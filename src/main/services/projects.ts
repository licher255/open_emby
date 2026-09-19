/** 项目库：工业制版软件的工作单元。
 *  布局：<dataRoot>/projects/<id>/project.json + images/（导入的图稿与风格化产出） */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
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
    .sort()
    .map((f) => {
      const e = manifest.get(f)
      return {
        path: join(dir, f),
        name: f,
        kind: e?.kind ?? inferKind(f),
        derivedFrom: e?.derivedFrom,
        createdAt: e?.createdAt ?? ''
      }
    })
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
export function loadProjectState(id: string): Record<string, unknown> | null {
  const p = join(projectDir(id), 'state.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

export async function saveProjectState(id: string, state: Record<string, unknown>, commitMessage: string): Promise<void> {
  if (!readMeta(id)) throw new Error(`项目不存在: ${id}`)
  writeFileSync(join(projectDir(id), 'state.json'), JSON.stringify(state, null, 2), 'utf-8')
  await commitAll(projectDir(id), commitMessage)
}

/** 项目版本历史（新→旧） */
export function projectHistory(id: string): Promise<CommitInfo[]> {
  return logCommits(projectDir(id))
}

/** 回退到指定版本（内容恢复为新提交，不丢历史） */
export async function restoreProject(id: string, oid: string): Promise<void> {
  await restoreCommit(projectDir(id), oid)
}
