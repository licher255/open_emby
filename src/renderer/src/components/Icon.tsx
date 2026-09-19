/** Font Awesome Free 图标（内置于 src/renderer/src/assets/icons，离线可用）。
 *  FA Free License: CC BY 4.0 —— https://fontawesome.com/license/free */
import plus from '../assets/icons/plus.svg?raw'
import folderOpen from '../assets/icons/folder-open.svg?raw'
import gear from '../assets/icons/gear.svg?raw'
import image from '../assets/icons/image.svg?raw'
import palette from '../assets/icons/palette.svg?raw'
import clipboardList from '../assets/icons/clipboard-list.svg?raw'
import route from '../assets/icons/route.svg?raw'
import fileExport from '../assets/icons/file-export.svg?raw'
import clockRotateLeft from '../assets/icons/clock-rotate-left.svg?raw'
import sliders from '../assets/icons/sliders.svg?raw'
import server from '../assets/icons/server.svg?raw'
import cubes from '../assets/icons/cubes.svg?raw'
import puzzlePiece from '../assets/icons/puzzle-piece.svg?raw'
import circleInfo from '../assets/icons/circle-info.svg?raw'

const ICONS = {
  plus,
  'folder-open': folderOpen,
  gear,
  image,
  palette,
  'clipboard-list': clipboardList,
  route,
  'file-export': fileExport,
  'clock-rotate-left': clockRotateLeft,
  sliders,
  server,
  cubes,
  'puzzle-piece': puzzlePiece,
  'circle-info': circleInfo
} as const

export type IconName = keyof typeof ICONS

export default function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <span
      className="icon"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}
