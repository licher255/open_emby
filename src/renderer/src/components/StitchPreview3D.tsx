import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { StitchResult } from '@shared/types'
import { useT } from '../i18n'

/** 线迹胶囊参数（世界单位 = mm） */
const THREAD_R = 0.18 // 绣线半径

interface Props {
  stitches: StitchResult
  hidden: Set<number>
}

/** 把针迹序列切成按颜色分组的线段（mm 坐标） */
function buildSegments(stitches: StitchResult, hidden: Set<number>): Map<number, Array<[number, number, number, number]>> {
  const segs = new Map<number, Array<[number, number, number, number]>>()
  let px = 0
  let py = 0
  for (const p of stitches.points) {
    if (p.flag === 0 && !hidden.has(p.color)) {
      let list = segs.get(p.color)
      if (!list) { list = []; segs.set(p.color, list) }
      list.push([px, py, p.x, p.y])
    }
    if (p.flag !== 2) { px = p.x; py = p.y }
  }
  return segs
}

/** 构建场景：布料底板 + 每色一个 InstancedMesh（胶囊体线迹） */
function buildScene(stitches: StitchResult, hidden: Set<number>): THREE.Group {
  const group = new THREE.Group()
  const { widthMm, heightMm } = stitches

  // 布料底板：略大于花版，用背景色（识别不到就用浅麻色）
  const bgHex = stitches.backgroundIndex >= 0 ? stitches.palette[stitches.backgroundIndex] : '#f2ede3'
  const fabric = new THREE.Mesh(
    new THREE.BoxGeometry(widthMm + 20, 1.2, heightMm + 20),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(bgHex), roughness: 0.95, metalness: 0 })
  )
  fabric.position.set(widthMm / 2, -0.6, heightMm / 2)
  fabric.name = 'fabric'
  group.add(fabric)

  // 线迹：胶囊沿 Y 轴，旋转到线段方向，scale.y 拉伸到线段长度
  const capsule = new THREE.CapsuleGeometry(THREAD_R, 1, 3, 6)
  const dummy = new THREE.Object3D()
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()

  for (const [color, list] of buildSegments(stitches, hidden)) {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(stitches.palette[color] ?? '#888888'),
      roughness: 0.55,
      metalness: 0.05
    })
    const mesh = new THREE.InstancedMesh(capsule, mat, list.length)
    mesh.name = `thread_color_${color}`
    list.forEach(([x0, y0, x1, y1], i) => {
      const dx = x1 - x0
      const dz = y1 - y0
      const len = Math.hypot(dx, dz)
      dir.set(dx, 0, dz).normalize()
      dummy.quaternion.setFromUnitVectors(up, dir)
      // 行间微小的上下交错，模拟线迹叠压的厚度感
      const lift = THREAD_R * 0.95 + (Math.round(y0 * 4) % 2) * 0.035
      dummy.position.set((x0 + x1) / 2, lift, (y0 + y1) / 2)
      dummy.scale.set(1, Math.max(len, 0.05), 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  }
  return group
}

/** 3D 针迹预览：线迹是有厚度的胶囊体，可旋转缩放；支持导出 GLB */
export default function StitchPreview3D({ stitches, hidden }: Props) {
  const t = useT()
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{ scene: THREE.Scene; group: THREE.Group } | null>(null)

  // 场景/渲染器只随针迹数据重建；隐藏层切换只换线迹组（见下方 effect）
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const W = mount.clientWidth || 640
    const H = 480

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#eceef2')

    const { widthMm, heightMm } = stitches
    const cx = widthMm / 2
    const cz = heightMm / 2
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, widthMm * 10)
    camera.position.set(cx, widthMm * 0.9, cz + heightMm * 0.9)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(cx, 0, cz)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.49 // 不穿到布下面

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(cx + widthMm * 0.6, widthMm, cz - heightMm * 0.4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xdde4ff, 0.5)
    rim.position.set(cx - widthMm * 0.5, widthMm * 0.4, cz + heightMm)
    scene.add(rim)
    sceneRef.current = { scene, group: new THREE.Group() }

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const m = o.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
      sceneRef.current = null
    }
  }, [stitches]) // eslint-disable-line react-hooks/exhaustive-deps

  // 线迹组：针迹或隐藏层变化时重建，复用已存在的场景
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return
    const group = buildScene(stitches, hidden)
    ctx.scene.add(group)
    ctx.group = group
    return () => {
      ctx.scene.remove(group)
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const m = o.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
    }
  }, [stitches, hidden])

  function exportGlb() {
    const ctx = sceneRef.current
    if (!ctx) return
    new GLTFExporter().parse(
      ctx.group,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'stitch_preview.glb'
        a.click()
        URL.revokeObjectURL(a.href)
      },
      (err) => console.error('GLB 导出失败', err),
      { binary: true }
    )
  }

  return (
    <div>
      <div ref={mountRef} className="stitch-3d" />
      <div className="scrub-row">
        <span className="mono-meta">{t('stitch.3dHint')}</span>
        <button className="btn-outline btn-sm" onClick={exportGlb}>{t('stitch.exportGlb')}</button>
      </div>
    </div>
  )
}
