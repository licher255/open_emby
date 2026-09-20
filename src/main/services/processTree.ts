import { spawnSync, type ChildProcess } from 'child_process'

/** 同步结束服务进程树；应用退出前必须等待清理完成，避免遗留后台进程。 */
export function stopProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000
    })
    return
  }
  try { process.kill(-pid, 'SIGKILL') } catch {
    try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
  }
}
