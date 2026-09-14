export default function Editor() {
  return (
    <div>
      <h1>制版编辑器</h1>
      <div className="card">
        <h2>规划中的功能</h2>
        <ul>
          <li>导入图片 → Agent 生成制版方案（色数 / 针法 / 密度）</li>
          <li>ComfyUI 风格化与局部重绘（选区 + 指令）</li>
          <li>针迹仿真预览（Canvas / WebGL）</li>
          <li>多色编排与换色顺序</li>
          <li>导出 DST / PES / JEF 到 exports/</li>
        </ul>
      </div>
    </div>
  )
}
