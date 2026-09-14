# 插件开发指南

open_emby 通过插件扩展能力，欢迎社区 PR 贡献。

## 插件类型
| type | 用途 | 入口 entry |
|---|---|---|
| `workflow` | ComfyUI 工作流包（风格化/重绘/生成） | workflow.json（API 格式） |
| `exporter` | 新刺绣机格式导出器 | Python 模块（sidecar 加载） |
| `tool` | 编辑器工具（选区、配色、针法） | JS 模块（渲染侧沙箱） |
| `agent-skill` | 制版 Agent 能力（新工具/新策略） | Python 模块 |
| `theme` | 界面主题 | CSS |

## 目录约定
```
plugins/<id>/
├── plugin.json      # manifest，须通过 plugins/plugin.schema.json 校验
└── <entry>          # 入口文件
```

## 权限模型
manifest 中声明 `permissions`，宿主逐项授权：
- `comfyui` — 可提交/查询 ComfyUI 工作流
- `sidecar` — 可调用制版核心 API
- `fs` — 限定数据根目录内读写
- `net` — 外网访问（下载模型等）

## 贡献流程
1. Fork 仓库，在 `plugins/<your-id>/` 开发
2. manifest 通过 schema 校验，`pnpm run typecheck` 通过
3. PR 附：插件说明、截图、权限说明
