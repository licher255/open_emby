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
import cropSimple from '../assets/icons/crop-simple.svg?raw'
import penNib from '../assets/icons/pen-nib.svg?raw'
import fillDrip from '../assets/icons/fill-drip.svg?raw'
import arrowRotateLeft from '../assets/icons/arrow-rotate-left.svg?raw'
import magnifyingGlassPlus from '../assets/icons/magnifying-glass-plus.svg?raw'
import magnifyingGlassMinus from '../assets/icons/magnifying-glass-minus.svg?raw'
import expand from '../assets/icons/expand.svg?raw'
import check from '../assets/icons/check.svg?raw'
import eye from '../assets/icons/eye.svg?raw'
import eyeSlash from '../assets/icons/eye-slash.svg?raw'
import rotateRight from '../assets/icons/rotate-right.svg?raw'
import bars from '../assets/icons/bars.svg?raw'
import arrowLeft from '../assets/icons/arrow-left.svg?raw'
import arrowRight from '../assets/icons/arrow-right.svg?raw'
import circleQuestion from '../assets/icons/circle-question.svg?raw'
import eraser from '../assets/icons/eraser.svg?raw'
import hand from '../assets/icons/hand.svg?raw'
import layerGroup from '../assets/icons/layer-group.svg?raw'
import trashCan from '../assets/icons/trash-can.svg?raw'

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
  'circle-info': circleInfo,
  'crop-simple': cropSimple,
  'pen-nib': penNib,
  'fill-drip': fillDrip,
  'arrow-rotate-left': arrowRotateLeft,
  'magnifying-glass-plus': magnifyingGlassPlus,
  'magnifying-glass-minus': magnifyingGlassMinus,
  expand,
  check,
  eye,
  'eye-slash': eyeSlash,
  'rotate-right': rotateRight,
  bars,
  'arrow-left': arrowLeft,
  'arrow-right': arrowRight,
  'circle-question': circleQuestion,
  eraser,
  hand,
  'layer-group': layerGroup,
  'trash-can': trashCan
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
