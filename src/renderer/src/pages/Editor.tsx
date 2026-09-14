import { useEffect, useRef, useState } from 'react'
import type { DigitizePlan } from '@shared/types'

const STAGES = ['导入图稿', '风格化·色块分离', '制版方案', '仿真预览', '局部修改', '导出文件'] as const

const STITCH_TAG_CLASS: Record<string, string> = {
  satin: 'stitch-tag satin',
  tatami: 'stitch-tag tatami',
  run: 'stitch-tag run',
  outline: 'stitch-tag run'
}

export default function Editor() {
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [stylizedUrl, setStylizedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // 'stylize' | 'plan'
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<DigitizePlan | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = window.openEmby.comfy.onProgress(setProgress)
    return () => { off() }
  }, [])

  const stage = plan ? 2 : stylizedUrl ? 1 : imageUrl ? 0 : 0

  async function loadImage(path: string) {
    setImagePath(path)
    setImageUrl(await window.openEmby.files.readImageDataUrl(path))
    setStylizedUrl(null)
    setPlan(null)
    setError('')
  }

  async function pickImage() {
    const p = await window.openEmby.files.selectImage()
    if (p) await loadImage(p)
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    try {
      await loadImage(window.openEmby.files.pathForFile(f))
    } catch {
      setError('无法读取拖入的文件')
    }
  }

  async function stylize() {
    if (!imagePath) return
    setBusy('stylize'); setError(''); setProgress('')
    try {
      setStylizedUrl(await window.openEmby.comfy.stylize(imagePath, plan?.maxColors ?? 8))
      setProgress('')
    } catch (err) {
      setError('风格化失败：' + String(err) + '（请确认 ComfyUI 已启动，且设置中的底模存在）')
    } finally {
      setBusy(null)
    }
  }

  async function makePlan() {
    if (!imagePath) return
    setBusy('plan'); setError('')
    try {
      // MVP：直接对原图量化分析；风格化结果落盘后改为分析结果图
      setPlan(await window.openEmby.sidecar.digitizePlan(imagePath, ''))
    } catch (err) {
      setError('制版方案生成失败：' + String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="editor">
      <header className="editor-head">
        <h1>制版工作台</h1>
        <ol className="stage-strip">
          {STAGES.map((s, i) => (
            <li key={s} className={i <= stage ? 'done' : ''}>
              <span className="stage-num">{i + 1}</span>{s}
            </li>
          ))}
        </ol>
      </header>

      {!imageUrl && (
        <div
          ref={inputRef}
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={pickImage}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="dropzone-title">把图片放进来</div>
          <div className="dropzone-sub">点击选择或拖入 · PNG / JPG / WEBP / BMP / GIF / TIFF / AVIF</div>
          <span className="badge-new">NEW · AI 制版</span>
        </div>
      )}

      {imageUrl && (
        <div className="editor-grid">
          <div className="pane">
            <h2>原图</h2>
            <div className="img-frame"><img src={imageUrl} alt="original" /></div>
            <p className="mono-meta">{imagePath}</p>
          </div>
          <div className="pane">
            <h2>风格化 · 色块</h2>
            <div className="img-frame">
              {stylizedUrl
                ? <img src={stylizedUrl} alt="stylized" />
                : <div className="img-placeholder">{busy === 'stylize' ? progress || '生成中…' : '尚未生成'}</div>}
            </div>
            <p className="mono-meta">{busy === 'stylize' ? progress : stylizedUrl ? 'ComfyUI img2img' : '—'}</p>
          </div>
        </div>
      )}

      {imageUrl && (
        <div className="editor-actions">
          <button className="btn-pill" disabled={!!busy} onClick={stylize}>
            {busy === 'stylize' ? '生成中…' : '① 风格化 · 色块分离'}
          </button>
          <button className="btn-pill" disabled={!!busy} onClick={makePlan}>
            {busy === 'plan' ? '分析中…' : '② 生成制版方案'}
          </button>
          <button className="btn-outline" onClick={() => { setImageUrl(null); setImagePath(null); setPlan(null); setStylizedUrl(null) }}>
            换一张图
          </button>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {plan && (
        <div className="card plan-card">
          <h2>制版方案 · {plan.sizeMm.width}×{plan.sizeMm.height} mm</h2>
          <div className="chip-row">
            {plan.palette.map((c) => (
              <span key={c} className="thread-chip"><i style={{ background: c }} />{c}</span>
            ))}
          </div>
          <table>
            <thead><tr><th>区域</th><th>颜色</th><th>针法</th><th>密度 mm</th></tr></thead>
            <tbody>
              {plan.regions.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td><span className="thread-chip sm"><i style={{ background: r.color }} />{r.color}</span></td>
                  <td><span className={STITCH_TAG_CLASS[r.stitchType] ?? 'stitch-tag'}>{r.stitchType}</span></td>
                  <td className="mono-meta">{r.density.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.notes.map((n, i) => <p key={i} className="mono-meta">· {n}</p>)}
        </div>
      )}
    </div>
  )
}
