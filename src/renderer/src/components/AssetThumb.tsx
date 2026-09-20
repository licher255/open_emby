import { useEffect, useState } from 'react'

/** 项目图稿缩略图：优先主进程缩放缩略图，不支持的格式回退全图 data URL */
export default function AssetThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.openEmby.files.readImageThumb(path, 320)
      .catch(() => window.openEmby.files.readImageDataUrl(path))
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [path])
  return url ? <img src={url} alt="" /> : <span className="asset-loading">…</span>
}
