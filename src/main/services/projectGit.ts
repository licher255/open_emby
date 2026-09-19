/** 项目版本库：每个项目目录是一个 Git 仓库（isomorphic-git，纯 JS，零外部依赖）。
 *  制版的每一步（导入/风格化/方案/针迹/导出）自动提交，全程有迹可循、可回退。 */
import fs from 'fs'
import path from 'path'
import git from 'isomorphic-git'

const AUTHOR = { name: 'open_emby', email: 'local@open_emby' }

export interface CommitInfo {
  oid: string
  message: string
  time: string // ISO8601
}

/** 初始化仓库（幂等） */
export async function initRepo(dir: string): Promise<void> {
  if (fs.existsSync(path.join(dir, '.git'))) return
  await git.init({ fs, dir, defaultBranch: 'main' })
}

/** 把工作区全部变更提交为一个版本；无变更返回 null */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await initRepo(dir)
  const matrix = await git.statusMatrix({ fs, dir })
  const changed = matrix.filter(([, head, worktree, stage]) => !(head === 1 && worktree === 1 && stage === 1))
  if (changed.length === 0) return null
  await Promise.all(
    changed.map(([filepath, , worktree]) =>
      worktree === 0
        ? git.remove({ fs, dir, filepath })
        : git.add({ fs, dir, filepath })
    )
  )
  return git.commit({ fs, dir, message, author: AUTHOR })
}

/** 提交历史（新→旧） */
export async function logCommits(dir: string, limit = 50): Promise<CommitInfo[]> {
  if (!fs.existsSync(path.join(dir, '.git'))) return []
  try {
    const commits = await git.log({ fs, dir, depth: limit })
    return commits.map((c) => ({
      oid: c.oid,
      message: c.commit.message.trim(),
      time: new Date(c.commit.committer.timestamp * 1000).toISOString()
    }))
  } catch {
    return [] // 尚无提交的仓库
  }
}

/** 回退到指定版本：不丢历史，把旧版本内容恢复为一次新提交 */
export async function restoreCommit(dir: string, oid: string): Promise<void> {
  await commitAll(dir, 'Auto-save before restore')
  const oldFiles = await git.listFiles({ fs, dir, ref: oid })
  const oldSet = new Set(oldFiles)

  // 恢复旧版本文件内容
  for (const filepath of oldFiles) {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath })
    const dest = path.join(dir, filepath)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, Buffer.from(blob))
  }
  // 删除旧版本中不存在的文件
  const current = await git.listFiles({ fs, dir })
  for (const filepath of current) {
    if (!oldSet.has(filepath)) {
      const p = path.join(dir, filepath)
      if (fs.existsSync(p)) fs.rmSync(p)
    }
  }
  await commitAll(dir, `Restore to ${oid.slice(0, 7)}`)
}
