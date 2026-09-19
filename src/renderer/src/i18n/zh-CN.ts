import type { Messages } from './en'

/** 简体中文翻译包（key 必须与 en.ts 完全一致） */
export const zhCN: Messages = {
  // ---- 外壳 / 侧边栏 ----
  'app.newProject': '新建项目',
  'app.projects': '项目',
  'app.noProjects': '还没有项目',
  'app.settings': '设置与环境',
  'app.page.projects': '项目',
  'app.page.settings': '设置与环境',

  // ---- 新建项目弹窗 ----
  'modal.newProject': '新建项目',
  'modal.namePlaceholder': '项目名称，如：牡丹靠垫 12 色',
  'modal.cancel': '取消',
  'modal.create': '创建',

  // ---- 项目主页 ----
  'projects.title': '项目',
  'projects.newCard': '新建项目',
  'projects.newHint': '从一张图稿开始',
  'projects.imageCount': '{count} 张图稿',
  'projects.storageNote': '项目保存在数据根目录的 projects/ 下，图稿与风格化产出归属项目，并由 Git 留痕。',

  // ---- 编辑器：阶段 ----
  'step.import': '导入图稿',
  'step.stylize': '风格化·色块分离',
  'step.plan': '制版方案',
  'step.stitches': '针迹与预览',
  'step.export': '导出文件',

  // ---- 编辑器：输入/输出槽 ----
  'editor.input': '输入',
  'editor.output': '产物',
  'editor.noInput': '请先在第 1 步选择参考图',
  'editor.noReference': '还没有参考图',
  'editor.pastOutputs': '历史产物',
  'editor.layerBlocks': '色块',
  'editor.layerLineart': '线稿',
  'editor.layerOverlay': '叠加',

  // ---- 编辑器：图稿库 ----
  'editor.importImage': '＋ 导入图稿',
  'editor.importing': '导入中…',
  'editor.dropHint': '把图片拖到这里，或点击「导入图稿」',
  'editor.filter.all': '全部',
  'editor.filter.original': '参考图',
  'editor.filter.stylized': '色块图',
  'editor.original': '原图',
  'editor.stylizedPane': '风格化 · 色块',
  'editor.notGenerated': '尚未生成',
  'editor.generating': '生成中…',
  'editor.engineNote': 'emby-engine · EmbyColorBlockStylize（已存回项目）',

  // ---- 编辑器：操作 ----
  'editor.stylize': '① 风格化 · 色块分离',
  'editor.stylizing': '生成中…',
  'editor.plan': '② 生成制版方案',
  'editor.planning': '分析中…',
  'editor.stitch': '③ 生成针迹',
  'editor.stitching': '生成中…',
  'editor.export': '④ 导出 DST',
  'editor.exporting': '导出中…',

  // ---- 编辑器：方案 ----
  'plan.title': '制版方案 · {w}×{h} mm',
  'plan.region': '区域',
  'plan.color': '颜色',
  'plan.stitchType': '针法',
  'plan.density': '密度 mm',

  // ---- 针迹卡片 ----
  'stitch.title': '针迹仿真 · 检查与分层',
  'stitch.view2d': '2D 仿真',
  'stitch.view3d': '3D 预览',
  'stitch.checks': '检查',
  'stitch.layers': '换色层（{count}）',
  'stitch.layerName': '第 {order} 色',
  'stitch.layerStitches': '{count} 针',
  'stitch.progress': '绣制进度',
  'stitch.stitchCount': '{count} 针',
  'stitch.colorChanges': '{count} 次换色',
  'stitch.bgSkipped': '底布不绣',
  'stitch.exportedTo': '已导出：{files}',
  'stitch.3dHint': '拖动旋转 · 滚轮缩放',
  'stitch.exportGlb': '导出 GLB',

  // ---- 检查项 ----
  'check.size': '花版尺寸 {w} × {h} mm',
  'check.estTime': '预估绣制 {min} 分钟（按 800 针/分）',
  'check.bgOk': '底布背景已识别，自动跳过不绣',
  'check.colorsOk': '{count} 色，在机器换色能力内',
  'check.colorsWarn': '{count} 色超过常见机器换色上限（12 色），请减少限色数',
  'check.jumpsWarn': '{count} 处跳线超过 5mm，上机前确认剪线设置',
  'check.denseWarn': '针数超过 5 万，花版偏大，注意面料缩皱',

  // ---- 版本历史 ----
  'history.title': '版本历史',
  'history.count': '{count} 个版本',
  'history.restore': '回退',
  'history.empty': '暂无版本记录',
  'history.confirm': '回退到「{message}」？当前状态会先自动保存为一个新版本。',

  // ---- Toast ----
  'toast.imported': '图稿已导入项目',
  'toast.stylizeDone': '风格化完成，已存回项目图稿库',
  'toast.planDone': '制版方案已生成',
  'toast.stitchDone': '针迹生成完成：{stitches} 针 / {changes} 次换色',
  'toast.exportDone': '已导出 DST 与生产单（colorsheet.json）',
  'toast.restored': '已回退（原状态已自动保存）',
  'toast.fail.import': '导入失败：{error}',
  'toast.fail.drop': '无法读取拖入的文件',
  'toast.fail.stylize': '风格化失败：{error}（请确认 emby-engine 已启动，见设置与环境）',
  'toast.fail.plan': '制版方案生成失败：{error}',
  'toast.fail.stitch': '针迹生成失败：{error}',
  'toast.fail.export': '导出失败：{error}',
  'toast.fail.restore': '回退失败：{error}',

  // ---- 设置与环境 ----
  'settings.title': '设置与环境',
  'settings.tab.general': '通用',
  'settings.tab.backend': '后端服务',
  'settings.tab.models': '模型',
  'settings.tab.plugins': '插件',
  'settings.tab.about': '关于',
  'about.tagline': 'AI 刺绣制版工作台 —— 把每张图变成刺绣',
  'about.license': '个人非商用开放版 · 详见 LICENSE',
  'settings.backend': '后端服务',
  'settings.running': '运行中',
  'settings.notRunning': '未运行',
  'settings.engine': '生成引擎 emby-engine（Rust）',
  'settings.sidecar': '制版 Sidecar',
  'settings.dataRoot': '数据根目录',
  'settings.loading': '加载中…',
  'settings.models': '模型仓库（{count}）',
  'settings.modelsEmpty': 'models/ 目录暂无模型，从 HuggingFace 下载后自动列出',
  'settings.plugins': '插件（{count}）',
  'settings.pluginsEmpty': 'plugins/ 目录暂无插件',
  'settings.language': '语言 / Language',
  'settings.colName': '名称',
  'settings.colType': '类型',
  'settings.colPath': '路径',
  'settings.colId': 'ID',
  'settings.colVersion': '版本',
  'settings.version': '版本',
  'settings.modelLineup': '模型谱系',
  'settings.statusPlanned': '规划中',
  'settings.statusTraining': '训练中',
  'settings.statusAvailable': '可用',

  // ---- 标题栏 ----
  'win.minimize': '最小化',
  'win.maximize': '最大化',
  'win.restore': '还原',
  'win.close': '关闭'
}
