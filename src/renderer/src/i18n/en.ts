/** 英文 —— 原生默认语言。所有 key 的唯一权威来源（其他语言包必须与它对齐）。 */
export const en = {
  // ---- 外壳 / 侧边栏 ----
  'app.newProject': 'New project',
  'app.projects': 'Projects',
  'app.noProjects': 'No projects yet',
  'app.settings': 'Settings & Environment',
  'app.page.projects': 'Projects',
  'app.page.settings': 'Settings & Environment',

  // ---- 新建项目弹窗 ----
  'modal.newProject': 'New project',
  'modal.namePlaceholder': 'Project name, e.g. Peony cushion 12 colors',
  'modal.cancel': 'Cancel',
  'modal.create': 'Create',

  // ---- 项目主页 ----
  'projects.title': 'Projects',
  'projects.newCard': 'New project',
  'projects.newHint': 'Start from an artwork',
  'projects.imageCount': '{count} images',
  'projects.storageNote': 'Projects live under projects/ in the data root; artwork and stylized outputs belong to the project and are versioned with Git.',

  // ---- 编辑器：阶段 ----
  'step.import': 'Import artwork',
  'step.stylize': 'Stylize · color blocks',
  'step.plan': 'Digitizing plan',
  'step.stitches': 'Stitches & preview',
  'step.export': 'Export files',

  // ---- 编辑器：输入/输出槽 ----
  'editor.input': 'Input',
  'editor.output': 'Output',
  'editor.noInput': 'Pick a reference image in step 1 first',
  'editor.noReference': 'No reference images yet',
  'editor.pastOutputs': 'Past outputs',
  'editor.layerBlocks': 'Color blocks',
  'editor.layerLineart': 'Line art',
  'editor.layerOverlay': 'Overlay',

  // ---- 编辑器：图稿库 ----
  'editor.importImage': '+ Import artwork',
  'editor.importing': 'Importing…',
  'editor.dropHint': 'Drop images here, or click "Import artwork"',
  'editor.filter.all': 'All',
  'editor.filter.original': 'Reference',
  'editor.filter.stylized': 'Color blocks',
  'editor.original': 'Original',
  'editor.stylizedPane': 'Stylized · color blocks',
  'editor.notGenerated': 'Not generated yet',
  'editor.generating': 'Generating…',
  'editor.engineNote': 'emby-engine · EmbyColorBlockStylize (saved to project)',

  // ---- 编辑器：操作 ----
  'editor.stylize': '1. Stylize · split color blocks',
  'editor.stylizing': 'Generating…',
  'editor.plan': '2. Build digitizing plan',
  'editor.planning': 'Analyzing…',
  'editor.stitch': '3. Generate stitches',
  'editor.stitching': 'Generating…',
  'editor.export': '4. Export DST',
  'editor.exporting': 'Exporting…',

  // ---- 编辑器：方案 ----
  'plan.title': 'Digitizing plan · {w}×{h} mm',
  'plan.region': 'Region',
  'plan.color': 'Color',
  'plan.stitchType': 'Stitch type',
  'plan.density': 'Density mm',

  // ---- 针迹卡片 ----
  'stitch.title': 'Stitch simulation · checks & layers',
  'stitch.view2d': '2D Simulation',
  'stitch.view3d': '3D Preview',
  'stitch.checks': 'Checks',
  'stitch.layers': 'Color layers ({count})',
  'stitch.layerName': 'Color {order}',
  'stitch.layerStitches': '{count} stitches',
  'stitch.progress': 'Stitch progress',
  'stitch.stitchCount': '{count} stitches',
  'stitch.colorChanges': '{count} color changes',
  'stitch.bgSkipped': 'fabric skipped',
  'stitch.exportedTo': 'Exported: {files}',
  'stitch.3dHint': 'Drag to rotate · scroll to zoom',
  'stitch.exportGlb': 'Export GLB',

  // ---- 检查项 ----
  'check.size': 'Design size {w} × {h} mm',
  'check.estTime': 'Est. {min} min @ 800 stitches/min',
  'check.bgOk': 'Fabric background detected — skipped from stitching',
  'check.colorsOk': '{count} colors, within machine capacity',
  'check.colorsWarn': '{count} colors exceed the common 12-color machine limit — reduce the palette',
  'check.jumpsWarn': '{count} jumps longer than 5 mm — check trim settings before production',
  'check.denseWarn': 'Over 50,000 stitches — large design, watch for fabric puckering',

  // ---- 版本历史 ----
  'history.title': 'Version history',
  'history.count': '{count} versions',
  'history.restore': 'Restore',
  'history.empty': 'No versions yet',
  'history.confirm': 'Restore to "{message}"? The current state will be auto-saved as a new version first.',

  // ---- Toast ----
  'toast.imported': 'Artwork imported into project',
  'toast.stylizeDone': 'Stylization done — saved to project assets',
  'toast.planDone': 'Digitizing plan ready',
  'toast.stitchDone': 'Stitches generated: {stitches} stitches / {changes} color changes',
  'toast.exportDone': 'DST and production sheet exported',
  'toast.restored': 'Restored (previous state was auto-saved)',
  'toast.fail.import': 'Import failed: {error}',
  'toast.fail.drop': 'Could not read the dropped file',
  'toast.fail.stylize': 'Stylization failed: {error} (check emby-engine in Settings & Environment)',
  'toast.fail.plan': 'Plan failed: {error}',
  'toast.fail.stitch': 'Stitch generation failed: {error}',
  'toast.fail.export': 'Export failed: {error}',
  'toast.fail.restore': 'Restore failed: {error}',

  // ---- 设置与环境 ----
  'settings.title': 'Settings & Environment',
  'settings.tab.general': 'General',
  'settings.tab.backend': 'Backend',
  'settings.tab.models': 'Models',
  'settings.tab.plugins': 'Plugins',
  'settings.tab.about': 'About',
  'about.tagline': 'AI embroidery digitizing studio — turn any picture into embroidery',
  'about.license': 'Personal, non-commercial open edition · see LICENSE',
  'settings.backend': 'Backend services',
  'settings.running': 'Running',
  'settings.notRunning': 'Not running',
  'settings.engine': 'Generation engine emby-engine (Rust)',
  'settings.sidecar': 'Digitizing sidecar',
  'settings.dataRoot': 'Data root',
  'settings.loading': 'Loading…',
  'settings.models': 'Model repository ({count})',
  'settings.modelsEmpty': 'No models in models/ yet — download from HuggingFace and they appear here',
  'settings.plugins': 'Plugins ({count})',
  'settings.pluginsEmpty': 'No plugins in plugins/',
  'settings.language': 'Language',
  'settings.colName': 'Name',
  'settings.colType': 'Type',
  'settings.colPath': 'Path',
  'settings.colId': 'ID',
  'settings.colVersion': 'Version',
  'settings.version': 'Version',
  'settings.modelLineup': 'Model lineup',
  'settings.statusPlanned': 'planned',
  'settings.statusTraining': 'training',
  'settings.statusAvailable': 'available',

  // ---- 标题栏 ----
  'win.minimize': 'Minimize',
  'win.maximize': 'Maximize',
  'win.restore': 'Restore',
  'win.close': 'Close'
} as const

export type LocaleKey = keyof typeof en
export type Messages = Record<LocaleKey, string>
