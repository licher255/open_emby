import { useEffect, useState } from 'react'
import { useCanvasView } from '../hooks/useCanvasView'

/** 自由画布预览：默认居中适配；拖拽平移、滚轮/双指捏合缩放（鼠标/触屏/Pencil 统一） */
export default function PanZoomStage({ url, lineUrl, overlay }: { url: string; lineUrl?: string | null; overlay?: boolean }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const cv = useCanvasView()

  useEffect(() => {
    const img = new Image()
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = url
  }, [url])

  // 内容就绪后居中适配
  useEffect(() => { if (nat) cv.fit(nat.w, nat.h) }, [nat]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={cv.ref} className="ws-panzoom" style={{ touchAction: 'none' }} {...cv.panHandlers}>
      {nat && (
        <div
          className="ws-pan-stage"
          style={{
            width: nat.w,
            height: nat.h,
            transform: `translate(${cv.view.tx}px, ${cv.view.ty}px) scale(${cv.view.scale})`
          }}
        >
          <img className="ws-pan-img" src={url} alt="" draggable={false} />
          {overlay && lineUrl && <img className="ws-pan-img layer-lineart" src={lineUrl} alt="" draggable={false} />}
        </div>
      )}
    </div>
  )
}
