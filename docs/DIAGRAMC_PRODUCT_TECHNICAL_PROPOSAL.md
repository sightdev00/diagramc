# DiagramC 通用 AI 图形工具产品与技术方案

> - 文档版本：1.0
> - 文档状态：正式方案（待评审）
> - 编制日期：2026-08-31
> - 适用范围：产品设计、技术选型、架构设计、里程碑规划与验收
> - 本阶段边界：只确定方案，不进入程序实现

## 1. 执行摘要

DiagramC 的目标不是生成一张不可继续编辑的图片，也不是在 Mermaid、Figma 或白板工具外再包装一层 AI。产品应定位为：

> 面向人和 AI 的通用结构化图形工作台，以可版本化的语义文档为唯一事实源，提供自然语言生成、可视化编辑、约束式自动布局、结构校验和多格式发布能力。

现有 archviz 原型已经验证了“YAML/JSON → IR → 校验 → 布局 → SVG/Mermaid”的基本路径，但当前能力仍属于工程架构图编译器，缺少可视化编辑闭环、通用文档模型、高质量连线路由、AI 安全增量修改协议以及插件化图类型。

本方案作出以下核心决策：

1. 保留现有 Python 编译器，将其重新定位为无界面编译器和 CI 工具，不作为交互式产品主体。
2. 新建浏览器优先的可视化编辑器，画布首选 AntV X6，React Flow 和 LogicFlow 作为原型验证备选。
3. 采用语言无关、带版本号的 Diagram Document V2；Python 和 TypeScript 都从同一 JSON Schema 获得约束。
4. 采用 ELK.js 作为分层、端口、复合图和正交连线的主要布局引擎；树形、力导向、网格和手工布局通过统一接口扩展。
5. AI 不直接写 SVG、坐标或整个 YAML，而是生成可校验、可预览、可撤销的领域命令。
6. 通用性通过“稳定内核 + 图类型插件”实现，不再通过不断扩充 NodeType 枚举实现。
7. Mermaid、D2、Graphviz、draw.io 等是导入、导出或辅助渲染适配器，不作为内部事实模型。
8. Figma 插件降为后续发布能力；首要目标是在 DiagramC 内完成从生成到编辑、布局、校验和导出的闭环。

## 2. 背景与问题定义

### 2.1 用户面临的问题

现有图形工具通常落在三个极端：

- Diagram-as-Code 易于版本管理和 AI 生成，但手工微调、局部布局和视觉打磨不便。
- 自由白板容易绘制，但缺少稳定语义、自动布局、结构校验和可审查的版本差异。
- 专业流程或建模工具结构严谨，但学习成本高，通常局限于特定图类型。

AI 生成又引入了新的问题：

- 模型容易重写整张图，而不是修改用户指定的一小部分。
- 模型生成的 SVG 或坐标难以继续编辑。
- 对话结果缺少可验证的结构变更和撤销边界。
- 图稍复杂后，布局质量、边交叉、文字溢出会迅速下降。

### 2.2 DiagramC 要解决的核心问题

DiagramC 必须同时解决以下四件事：

1. 图的内容具有明确、可扩展、可验证的语义。
2. 用户能够在画布、大纲和属性面板中直接编辑。
3. 自动布局能够与人工位置、固定节点和局部调整共存。
4. AI 的每次修改都可解释、可预览、可验证、可撤销。

## 3. 产品目标与非目标

### 3.1 产品目标

- 用户无需编写 YAML 即可从空白或模板创建图。
- 用户可用自然语言生成和增量修改图。
- 自动布局后仍可自由拖动、固定和局部重排。
- 图结构、布局和主题相互独立。
- 同一语义文档可输出适合网页、文档、PPT 和打印的不同呈现。
- 新图类型可以通过插件增加，而不修改核心数据模型。
- 文档能够进入 Git、CI 和工程文档流程。
- 默认支持本地保存和离线编辑；AI 服务可以替换或关闭。

### 3.2 非目标

首个可用版本不以以下能力为目标：

- 不替代 Figma、Illustrator 等像素级设计软件。
- 不提供完整 CAD、BPMN 执行引擎或仿真能力。
- 不在首版支持所有 UML、甘特图、时序图和复杂数学可视化。
- 不让第三方插件在主线程任意执行不受信任代码。
- 不把 LLM 生成结果视为无需校验的事实。
- 不追求一次性兼容所有第三方图形格式的全部样式语义。

## 4. 目标用户与核心场景

### 4.1 目标用户

- 需要制作架构图、流程图和汇报图的研发人员。
- 需要快速梳理业务流程和职责边界的产品、运营人员。
- 需要从代码、文档或数据生成关系图的 AI Agent。
- 需要在 Git/CI 中维护可重复生成图形的工程团队。
- 需要对图进行人工微调和正式发布的技术写作者。

### 4.2 核心场景

#### 场景 A：自然语言创建

用户输入“画一个订单退款流程，按用户、客服、财务三个泳道划分”，系统生成结构草稿、选择布局并进入可编辑画布。

#### 场景 B：选区增量修改

用户框选支付子流程，输入“在扣款后增加风控复核，失败进入人工审核”，系统只修改选中子图并显示结构 Diff。

#### 场景 C：自动整理

用户拖动关键节点并将其固定，选择“保持固定节点，只整理连线和其余节点”，布局引擎只调整允许移动的元素。

#### 场景 D：结构诊断

系统发现孤立节点、无出口流程、循环依赖、没有处理的错误分支、过长标签和信息密度过高区域，并给出可选择的修复操作。

#### 场景 E：多渠道发布

同一文档分别输出 16:9 演示图、A4 竖版 PDF、文档内嵌 SVG 和 Mermaid 降级版本。

#### 场景 F：工程自动生成

Agent 从仓库、接口定义或调用关系生成 DiagramC 文档，在 CI 中验证并输出 SVG；开发者随后在 Web 编辑器中进行人工调整。

## 5. 现有 diagramc 基线审查

### 5.1 已有资产

当前原型已经具备：

- Pydantic Diagram IR。
- YAML/JSON 解析。
- ID、引用和基础语义校验。
- 确定性的简单分层布局。
- SVG 和 Mermaid 输出。
- 主题覆盖机制。
- Typer CLI。
- Figma 友好 SVG 分组 ID。
- 5 项自动测试和两个示例。

这些资产应迁移而不是删除。

### 5.2 当前关键限制

#### 产品闭环缺失

当前 README 将 Figma 定义为人工精修环节。结构变更后需要重新生成、重新导入和人工对比，不具备一体化编辑闭环。

#### 模型领域化

NodeType、EdgeKind 和 GroupKind 是固定枚举，混入 runtime、gpu、agent 等工程语义。该模式无法支撑业务流程、组织图、思维导图等通用场景。

#### 布局与边关系脱节

现有布局按 group.order 纵向排列组、组内横向排列节点，没有根据边关系分层；LR 方向也未真正应用到 SVG 布局。

#### 几何结果不完整

LayoutResult 只包含节点和组矩形，不能表达端口位置、边路径、边标签、标注位置、碰撞诊断和人工位置约束。

#### 视觉质量不可扩展

当前边采用节点中心之间的固定贝塞尔曲线，缺少正交路由和避障；多个注释可能重叠；节点多时可能超出组和画布。

#### 测试仅证明流程可运行

现有测试验证节点存在、输出包含 SVG 文本等基本行为，尚未覆盖不重叠、路由合法、序列化往返、固定节点稳定性、视觉快照和大图性能。

### 5.3 仓库状态

截至本方案编制时，diagramc 是 algo-toolbox 父仓库中的未跟踪目录，并不是独立 Git 仓库。目录内的 .github/workflows/ci.yml 不会作为父仓库根级工作流自动执行。

进入实现阶段前必须先完成以下决策：

- 作为独立仓库管理；或
- 作为 algo-toolbox 的正式子目录纳入版本控制，并将 CI 合并到父仓库根工作流。

## 6. 相关项目调研

调研基于 2026-08-31 可访问的官方文档和官方仓库。评分表示与 DiagramC 的适配程度，不代表项目本身的绝对质量。

### 6.1 交互画布候选

| 项目 | 结构化编辑 | 通用图能力 | 开箱编辑能力 | React 集成 | 许可证 | 结论 |
|---|---:|---:|---:|---:|---|---|
| AntV X6 | 5 | 5 | 5 | 4 | MIT | 首选画布 |
| React Flow | 5 | 4 | 3 | 5 | MIT | 首选备选 |
| LogicFlow | 4 | 4 | 4 | 3 | Apache-2.0 | 国内生态备选 |
| maxGraph | 5 | 5 | 4 | 2 | Apache-2.0 | 成熟但集成复杂 |
| JointJS Community | 5 | 4 | 3 | 4 | MPL-2.0 | 许可证和高级版边界需评估 |
| Excalidraw | 2 | 3 | 5 | 4 | MIT | 适合自由白板，不作为结构图内核 |
| tldraw SDK | 3 | 4 | 5 | 5 | 生产需许可证 | 不作为默认底座 |
| Cytoscape.js | 4 | 4 | 3 | 3 | MIT | 知识图谱/大图分析插件候选 |

#### AntV X6

X6 官方定位是基于 HTML/SVG 的图编辑引擎，面向 DAG、ER、流程图和血缘图，提供选择、对齐线、缩放、端口、连接、变换、事件和导出插件。它更接近 DiagramC 所需的“完整图编辑底座”，而非只负责节点渲染。

采用建议：作为首选画布完成技术原型。

官方资料：

- https://x6.antv.antgroup.com/en/tutorial/about
- https://x6.antv.antgroup.com/en/tutorial/basic/graph
- https://x6.antv.antgroup.com/en/tutorial/plugins/export
- https://github.com/antvis/X6

#### React Flow

React Flow 是成熟的 React 节点编辑库，定制节点和 React 状态集成体验好，许可证宽松。其官方文档明确将自动布局交给 Dagre、D3、ELK 等外部库，完整的通用编辑器能力仍需自行组合。

采用建议：作为备选原型；如果产品最终更偏工作流节点 UI，而非通用结构图，可重新选择。

官方资料：

- https://reactflow.dev/
- https://reactflow.dev/learn/layouting/layouting
- https://github.com/xyflow/xyflow

#### LogicFlow

LogicFlow 面向业务流程图定制，具备核心、扩展和布局包，中文生态较友好，但产品心智仍更偏流程图。

采用建议：作为国内生态和流程场景对照组。

官方资料：

- https://github.com/didi/LogicFlow

#### maxGraph / draw.io

maxGraph 是 mxGraph 的 TypeScript 后继项目；draw.io 则是完整应用。两者功能成熟，但 draw.io 代码体量和产品耦合较大，不适合直接作为 DiagramC 的内核。maxGraph 可以作为复杂图编辑能力的参考和备选。

官方资料：

- https://maxgraph.github.io/maxGraph/
- https://github.com/maxGraph/maxGraph
- https://github.com/jgraph/drawio

#### Excalidraw

Excalidraw 是 MIT 许可的自由白板，提供开放 JSON、箭头绑定、撤销重做和 SVG/PNG 导出。它适合草图和自由标注，但缺少 DiagramC 所需的稳定领域语义和约束式布局。

采用建议：研究其交互和开放格式；后续可提供“草图风格主题”或 Excalidraw 导入导出，不作为结构图主内核。

官方资料：

- https://github.com/excalidraw/excalidraw
- https://docs.excalidraw.com/

#### tldraw

tldraw SDK 的形状、工具和响应式编辑模型具有参考价值，但官方当前许可要求生产环境使用试用、商业或爱好许可证。

采用建议：只作为产品交互参考，不成为默认依赖。

官方资料：

- https://tldraw.dev/community/license
- https://tldraw.dev/docs/editor

#### Cytoscape.js

Cytoscape.js 强项是网络可视化、图论分析和多种力导向布局，适合知识图谱和大规模关系网络，不适合承担文档型流程图编辑器的全部职责。

采用建议：未来作为 knowledge-graph 图类型的专用渲染或分析插件。

官方资料：

- https://js.cytoscape.org/

### 6.2 自动布局候选

| 项目 | 主要优势 | 主要限制 | 使用策略 |
|---|---|---|---|
| ELK.js | 端口、复合图、层级边、正交/折线/样条路由、配置丰富 | 配置复杂，EPL-2.0 | 主布局引擎 |
| Dagre | 简单、轻量、接入快 | 复合图和边路由能力弱 | 简单分层回退 |
| D3 Hierarchy | 树和层次结构直观 | 不适合一般有向图 | 树/组织图插件 |
| D3 Force / fCoSE | 关系网络自然 | 结果稳定性和可预测性较弱 | 知识图谱插件 |
| Graphviz | 多布局、多格式、成熟 | 浏览器集成和部署较重，当前为 EPL-2.0 | Headless 可选后端 |
| 当前 simple-layered | 确定、无依赖 | 质量有限 | 测试回退和兼容后端 |

ELK 官方支持端口、层级节点、复合图、边标签以及多种边路由方式；ELK.js 将这些算法提供给浏览器和 Node.js。

官方资料：

- https://eclipse.dev/elk/
- https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
- https://github.com/kieler/elkjs

### 6.3 Diagram-as-Code 与交换格式

#### Mermaid

Mermaid 具有大量图类型、GitHub 原生渲染、MIT 许可证和多布局支持，适合作为文档发布格式。但它的语法不能无损表达 DiagramC 的人工位置、锁定状态和全部视觉语义。

决策：支持导入和导出，但不作为内部事实源。

- https://github.com/mermaid-js/mermaid
- https://mermaid.js.org/config/layouts

#### D2

D2 具备良好的文本语法、主题和软件架构图呈现，适合作为后续文本交换格式。其核心采用 MPL-2.0。

决策：M4 之后评估适配器，不进入首版依赖。

- https://d2lang.com/
- https://github.com/terrastruct/d2

#### Graphviz DOT

Graphviz 适合工程自动化和 headless 渲染。其 dot 对有向分层图成熟，但不是交互式编辑模型。

决策：作为可选编译后端和 DOT 导入导出，不作为浏览器画布。

- https://graphviz.org/
- https://graphviz.org/docs/layouts/dot/

#### draw.io XML

draw.io 格式拥有广泛使用基础，但其 XML 和样式模型复杂。

决策：先支持基础节点、边、分组的有损导入导出，并明确兼容等级。

### 6.4 许可证原则

首选依赖应优先采用 MIT、Apache-2.0 等宽松许可证。ELK.js、Graphviz、D2、JointJS 等依赖需要保留相应许可证和 NOTICE，并在发布前完成正式法务复核。

本文中的许可证结论只用于技术选型，不构成法律意见。

## 7. 产品信息架构与交互方案

### 7.1 主界面

```text
┌──────────────────────────────────────────────────────────────────┐
│ 文件  编辑  插入  布局  主题  检查  导出        搜索 / 命令面板 │
├──────────────┬───────────────────────────────┬───────────────────┤
│ 大纲/图层     │                               │ 属性面板          │
│ 模板/组件库   │          无限画布             │ 内容/样式/布局    │
│ 搜索/问题列表 │                               │ 约束/数据/链接    │
├──────────────┴───────────────────────────────┴───────────────────┤
│ AI Copilot：输入框 / 作用范围 / 变更预览 / 诊断 / 执行历史       │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 编辑模式

产品提供三个互相同步的编辑入口：

1. 画布编辑：拖拽、连接、框选、分组、缩放、调整大小。
2. 大纲编辑：树形或表格方式编辑节点、层级和关系。
3. AI 编辑：通过自然语言对全图、选区或指定元素执行命令。

高级用户可以打开源码视图编辑 YAML/JSON，但源码视图不是默认入口。

### 7.3 关键可用性要求

- 双击直接修改文本。
- 拖出连接线时自动吸附有效端口。
- 多选后显示对齐、分布、分组和局部布局快捷操作。
- 自动布局前后使用动画，帮助用户保持空间认知。
- 支持固定节点、固定组、固定泳道和固定顺序。
- 支持只重新布局选区或当前组。
- 支持“只优化连线，不移动节点”。
- 文本自动测量、换行并驱动节点尺寸。
- 图过密时显示问题提示，而不是静默产生不可读结果。
- AI 变更在应用前显示新增、删除、修改和连线变化。
- 所有批量和 AI 操作以单个事务进入撤销栈。

## 8. 功能需求

### FR-01 文档与模板

- 新建空白文档。
- 从流程图、架构图、树图和通用关系图模板创建。
- 打开、另存、自动保存和恢复。
- 文档 schemaVersion 检查和迁移。
- 最近文档和模板搜索。

### FR-02 画布编辑

- 节点、边、组、泳道、注释和图片元素。
- 选择、多选、框选、复制、粘贴、删除。
- 对齐线、网格、吸附、等距分布。
- 节点调整大小、折叠和展开。
- 端口、边标签、折点和边类型编辑。
- 图层顺序、锁定、隐藏。

### FR-03 大纲和数据编辑

- 通过树形大纲修改层级。
- 批量修改标签、类型、分组和元数据。
- 从 Markdown 大纲、表格和 CSV 粘贴生成节点。
- 大纲选中与画布选中同步。

### FR-04 自动布局

- layered、tree、force、grid、manual、swimlane 布局配置。
- TB、LR、BT、RL 方向。
- 固定位置、同层、顺序、对齐、间距和泳道约束。
- 全图、选区、组内和连线-only 布局。
- 布局预览、取消和恢复。

### FR-05 AI Copilot

- 从自然语言生成新图。
- 对选区或指定元素执行增量修改。
- 从代码、Markdown、接口文档和关系数据提取图。
- 结构检查和一键修复。
- 命名统一、信息压缩、布局和主题建议。
- AI 变更 Diff、确认、撤销和操作记录。
- 云端与本地模型提供方可替换。

### FR-06 结构校验

- ID 唯一和引用完整。
- 端口类型和连接规则。
- 孤立节点、不可达节点和无出口流程。
- 非预期循环。
- 重复关系和悬空边。
- 标签过长、节点过密、交叉过多。
- 插件自定义规则。

### FR-07 主题与呈现

- 设计令牌：颜色、字体、字号、圆角、间距、阴影和线型。
- 主题继承和局部覆盖。
- 工程、演示、纸张、深色和草图主题。
- 16:9、A4、文档宽度等发布目标。
- 语义颜色与装饰颜色分离。

### FR-08 导入导出

- 无损：DiagramC JSON/YAML。
- 首版导入：DiagramC V1、Mermaid flowchart、Markdown 大纲、CSV。
- 首版导出：SVG、PNG、PDF、Mermaid、DiagramC JSON/YAML。
- 后续：D2、DOT、draw.io、Excalidraw。
- 导出前提供边界、字体、背景和分辨率预览。

### FR-09 插件

- 图类型、元素类型、验证器、布局配置、模板和适配器注册。
- 插件声明所需的 core API 版本。
- 插件数据保存在 extensions 命名空间。
- 不兼容插件不得破坏文档基础内容。

## 9. 非功能需求

### NFR-01 性能

- 目标基线：200 节点、400 条边可正常交互。
- 常规操作反馈目标低于 100 ms。
- 200 节点分层布局目标在主流办公电脑上 2 秒内完成。
- 布局在 Web Worker 中执行，不阻塞主线程。
- 大图启用视口裁剪、延迟渲染和语义缩放。

### NFR-02 稳定性

- 每个用户动作都是事务。
- 文档写入采用临时文件和原子替换策略。
- 自动保存不得覆盖最近的可恢复版本。
- 同版本引擎、同输入和同配置应产生稳定结果。

### NFR-03 安全与隐私

- 默认本地保存。
- 未经确认不得向模型提供整份仓库或完整文档。
- AI 请求显示数据范围和目标提供方。
- API Key 不进入前端持久文档和日志。
- 标签、外部 SVG、图片 URL 和导入内容必须清理。
- Mermaid 等第三方渲染器采用安全配置和隔离环境。
- 插件执行采用权限声明和隔离策略。

### NFR-04 可访问性

- 核心编辑操作支持键盘。
- 节点和关系可通过大纲访问。
- 主题满足基础对比度要求。
- 导出 SVG 包含 title、desc 或等价描述入口。

### NFR-05 可维护性

- Diagram Schema 是跨语言契约的唯一事实源。
- 核心层不依赖具体图类型。
- 布局、渲染、导入导出和 AI Provider 均通过接口隔离。
- 第三方依赖记录版本、许可证和 SBOM。

## 10. 总体技术架构

```text
                     ┌────────────────────────┐
                     │   DiagramC Web App     │
                     │ Canvas / Outline / AI  │
                     └───────────┬────────────┘
                                 │ Commands / Queries
                     ┌───────────▼────────────┐
                     │    Application Core    │
                     │ Transaction / History  │
                     │ Selection / Clipboard  │
                     └──────┬─────────┬───────┘
                            │         │
              ┌─────────────▼──┐   ┌──▼────────────────┐
              │ Diagram Core   │   │ AI Orchestrator   │
              │ Schema/Rules   │   │ Provider/Tools    │
              │ Migration/Diff │   │ Preview/Repair    │
              └──────┬─────────┘   └───────────────────┘
                     │
         ┌───────────┼───────────────┬────────────────┐
         │           │               │                │
┌────────▼─────┐ ┌───▼─────────┐ ┌───▼──────────┐ ┌──▼─────────────┐
│ Layout       │ │ Diagram     │ │ Renderer /   │ │ Persistence /  │
│ ELK/Tree/... │ │ Plugins     │ │ Exporters    │ │ Collaboration  │
└──────────────┘ └─────────────┘ └──────────────┘ └────────────────┘
                     │
                     ▼
          Python Headless Compiler / CI
```

### 10.1 模块职责

- Diagram Core：文档模型、迁移、命令执行、Diff 和核心校验。
- Application Core：事务、撤销、剪贴板、选区和编辑会话。
- Canvas Adapter：把 Diagram Document 投影到 X6 或备选画布。
- Layout Service：文本测量、图转换、布局执行、稳定化和路由。
- AI Orchestrator：上下文选择、工具调用、结果校验和预览。
- Plugin Registry：发现并装载图类型能力。
- Renderer/Exporter：生成 SVG、PNG、PDF 和文本格式。
- Headless Compiler：用于 CLI、批量任务和 CI。

## 11. Diagram Document V2

### 11.1 设计原则

- 语言无关：核心规范使用 JSON Schema。
- 可迁移：必须包含 schemaVersion。
- 开放类型：semanticType 使用命名空间字符串。
- 稳定 ID：节点、边、组和约束都有 ID。
- 内容与视图分离：语义数据不依赖当前坐标。
- 自动与手工共存：布局策略和人工覆盖同时保存。
- 插件隔离：扩展数据位于命名空间。

### 11.2 概念结构

```text
DiagramDocument
├── schemaVersion
├── document
├── elements[]
│   ├── node
│   ├── group
│   ├── lane
│   ├── note
│   └── image
├── relations[]
├── constraints[]
├── layouts{}
├── presentation
├── assets{}
├── extensions{}
└── metadata
```

### 11.3 示例

```yaml
schemaVersion: "2.0"
document:
  id: refund-process
  title: 退款处理
  diagramType: flowchart

elements:
  - id: risk-review
    kind: node
    semanticType: workflow.approval
    parentId: finance-lane
    data:
      label: 风控复核
      description: 检查高风险退款

relations:
  - id: payment-to-risk
    kind: directed
    semanticType: workflow.transition
    source:
      elementId: payment
      portId: out
    target:
      elementId: risk-review
      portId: in
    data:
      label: 高风险

constraints:
  - id: risk-order
    type: after
    subject: risk-review
    reference: payment

layouts:
  default:
    engine: elk
    profile: layered
    direction: RIGHT
    overrides:
      payment:
        pinned: true
        position: {x: 320, y: 180}

presentation:
  theme: professional-blue
  target: screen-16x9

extensions: {}
```

### 11.4 LayoutResult V2

```text
LayoutResult
├── bounds
├── elementRects
├── portPositions
├── edgeRoutes
├── edgeLabelRects
├── annotationRects
├── movedElements
├── diagnostics
└── engineMetadata
```

## 12. 命令、事务和撤销模型

所有编辑行为，包括画布拖动、批量编辑和 AI 操作，都转化为领域命令。

### 12.1 基础命令

- element.create
- element.update
- element.delete
- element.reparent
- relation.create
- relation.update
- relation.delete
- constraint.create/update/delete
- layout.apply
- layout.pin/unpin
- presentation.applyTheme
- document.updateMetadata

### 12.2 事务要求

一个事务包含：

- transactionId
- actor：human、ai、importer、system
- scope：document、selection、group
- preconditions
- operations
- inverseOperations
- diagnostics
- createdAt

事务必须先在文档副本上执行，通过校验后才能提交。失败时不得留下部分结果。

## 13. AI 方案

### 13.1 AI 的职责

- 将自然语言转换为 Diagram Commands。
- 从外部资料抽取候选元素和关系。
- 为结构问题提出修复命令。
- 为布局和主题选择参数。
- 生成图的文字说明和摘要。

### 13.2 AI 不负责的内容

- 不直接生成最终 SVG。
- 不直接控制像素坐标。
- 不绕过 Schema 和插件校验。
- 不在用户未知的情况下删除大范围内容。
- 不把未验证的仓库推断写成确定事实。

### 13.3 执行流程

```text
用户指令
  → 确定作用范围
  → 构建最小上下文
  → AI 工具调用
  → Schema 校验
  → 语义与权限校验
  → 在临时文档执行
  → 生成结构 Diff
  → 用户确认或自动应用
  → 布局预览
  → 提交事务
```

### 13.4 AI 工具接口示例

```json
{
  "transactionId": "tx-1024",
  "scope": {"type": "selection", "ids": ["detect", "publish"]},
  "operations": [
    {
      "op": "element.create",
      "tempId": "manual-review",
      "kind": "node",
      "semanticType": "workflow.approval",
      "data": {"label": "人工审核"}
    },
    {
      "op": "relation.insertBetween",
      "relationId": "detect-to-publish",
      "elementId": "manual-review"
    },
    {
      "op": "layout.apply",
      "scope": ["detect", "manual-review", "publish"],
      "profile": "local-layered"
    }
  ]
}
```

### 13.5 Provider 抽象

AI 层只依赖统一 Provider 接口：

- OpenAI-compatible API。
- 企业内部模型网关。
- 本地模型服务。
- 无 AI 模式。

Provider 负责鉴权、重试、流式输出和模型能力声明；Diagram Core 不依赖具体模型厂商。

## 14. 布局系统

### 14.1 布局流水线

```text
测量文本和节点
  → 选择布局 Profile
  → 转换为布局图
  → 应用固定/顺序/泳道等约束
  → Web Worker 执行布局
  → 保持心智地图的稳定化
  → 边路由和标签布局
  → 碰撞与越界诊断
  → 动画预览
  → 用户接受或回退
```

### 14.2 布局 Profile

| Profile | 适用场景 | 默认引擎 |
|---|---|---|
| layered | 流程图、架构图、依赖图 | ELK Layered |
| tree | 组织图、思维导图 | D3 Hierarchy / Tree |
| force | 知识图谱、关系网络 | fCoSE / D3 Force |
| grid | 卡片、模块清单 | 自研轻量布局 |
| swimlane | 跨角色流程 | ELK + 泳道约束 |
| manual | 完全手工 | 无自动引擎 |

### 14.3 心智地图稳定性

布局质量不仅是减少交叉，还要避免用户每次操作后“整张图跳动”。必须支持：

- 固定节点绝不移动。
- 未受影响区域尽量保持位置。
- 新节点优先插入相邻空间。
- 局部布局只更新选区和必要邻居。
- 同一输入尽量产生确定结果。
- 布局前后通过动画展示移动关系。

## 15. 插件体系

### 15.1 插件接口

```ts
interface DiagramPlugin {
  id: string
  version: string
  coreRange: string
  diagramTypes: DiagramTypeDefinition[]
  elementTypes: ElementTypeDefinition[]
  validators: DiagramValidator[]
  layoutProfiles: LayoutProfile[]
  templates: DiagramTemplate[]
  aiTools: AIToolDefinition[]
  importers: Importer[]
  exporters: Exporter[]
}
```

### 15.2 首批插件

- generic-graph：通用节点、关系、分组和注释。
- flowchart：开始、结束、处理、判断、异常分支。
- architecture：系统、服务、接口、数据库、队列、运行时。
- tree-mindmap：根节点、分支、折叠和树形布局。

### 15.3 第二批插件

- swimlane。
- state-machine。
- ER。
- knowledge-graph。
- sequence。
- timeline。

时序图和时间线不应强行复用普通二维节点图的所有布局语义，应允许插件提供专用坐标和交互规则。

## 16. 技术选型决策

### 16.1 推荐技术栈

| 层 | 首选 |
|---|---|
| Web 框架 | React + TypeScript |
| 构建 | Vite |
| 画布 | AntV X6 |
| 应用状态 | Zustand 或 Redux Toolkit，原型后确定 |
| Schema 校验 | JSON Schema + Ajv |
| 布局 | ELK.js + Web Worker |
| 树布局 | D3 Hierarchy |
| 测试 | Vitest + Testing Library + Playwright |
| 视觉回归 | Playwright Screenshot |
| Python Headless | 现有 Pydantic/Typer 架构演进 |
| 包管理 | pnpm workspace |
| 文档 | Markdown + ADR |

### 16.2 画布选型门禁

正式实现前，用同一份 V2 文档分别做 X6 和 React Flow 的限时原型。必须验证：

- 50 节点、80 边的渲染和编辑。
- 自定义节点和多端口。
- 嵌套组。
- 拖动、缩放、框选、对齐线和调整大小。
- ELK 布局结果回写。
- 固定节点和局部重排。
- SVG 导出一致性。
- 撤销栈和外部 Command Bus 对接。

如果 X6 在 React 状态同步、嵌套组或布局回写上出现不可接受问题，切换到 React Flow。该门禁应形成 ADR，不在实现过程中反复摇摆。

### 16.3 不采用方案

- 不直接 fork draw.io：代码体量大、产品耦合强。
- 不以 Mermaid 为内部模型：无法无损保存人工布局和交互状态。
- 不以 Excalidraw/tldraw 为结构化图内核：结构语义和布局约束不是其主目标，且 tldraw 存在生产许可要求。
- 不在浏览器主路径依赖 Graphviz 二进制：部署和跨平台成本高。
- 不继续扩充当前工程 NodeType 枚举：会把领域变化传播到核心层。

## 17. 建议目录结构

```text
diagramc/
├── apps/
│   └── web/
├── packages/
│   ├── schema/
│   ├── core/
│   ├── commands/
│   ├── editor-x6/
│   ├── layout/
│   ├── ai/
│   ├── exporters/
│   ├── importers/
│   ├── plugin-sdk/
│   └── plugins/
│       ├── generic-graph/
│       ├── flowchart/
│       ├── architecture/
│       └── tree-mindmap/
├── python/
│   └── diagramc_headless/
├── schemas/
│   ├── diagram-v1.schema.json
│   └── diagram-v2.schema.json
├── examples/
├── docs/
│   ├── adr/
│   └── specifications/
└── tests/
    ├── fixtures/
    ├── visual/
    └── interoperability/
```

现有 src/archviz 在迁移期可保留，待 V2 Headless CLI 稳定后再移动到 python/diagramc_headless。

## 18. 里程碑

里程碑按可验收能力划分，不在团队规模尚未确定时承诺固定日期。

### M0：项目与协议基线

交付：

- 仓库归属和 CI 生效。
- Diagram Document V2 JSON Schema。
- V1 → V2 迁移规则。
- Command 和 Transaction 规范。
- Layout、Plugin、Importer、Exporter 接口。
- 画布选型 ADR。

退出标准：

- 当前两个示例可迁移到 V2。
- Python 和 TypeScript 对同一 fixture 的校验结果一致。
- 规范文档通过评审。

### M1：最小可用编辑器

交付：

- 创建、打开、保存 DiagramC 文档。
- 节点、边、组和注释编辑。
- 大纲、画布和属性面板。
- 撤销重做、复制粘贴、自动保存。
- SVG/PNG/DiagramC 导出。
- 当前主题迁移。

退出标准：

- 用户无需修改源码即可从空白制作并导出一张流程图。
- 文档保存后重新加载不丢失人工调整。

### M2：高质量布局与呈现

交付：

- ELK.js Worker。
- 分层、树形、网格和手工布局。
- 端口、正交路由、边标签。
- 固定节点、局部布局、连线-only 布局。
- 文本测量、碰撞诊断。
- 视觉回归测试。

退出标准：

- 标准测试图不存在节点重叠和明显文字溢出。
- 固定节点在全图重排后位置不变。
- 200 节点基准满足性能目标。

### M3：AI Copilot

交付：

- Provider 抽象。
- Diagram Command 工具集。
- 选区上下文。
- AI 变更 Diff。
- 结构诊断和修复。
- 从 Markdown/代码描述生成图。

退出标准：

- AI 操作不直接修改坐标或绕过校验。
- 每次 AI 操作可以一次撤销。
- 删除和大范围修改必须预览确认。

### M4：通用插件与交换格式

交付：

- Plugin SDK。
- flowchart、architecture、tree-mindmap、swimlane。
- Mermaid、DOT、draw.io 等适配器。
- 版本 Diff 和 CI 增量输出。
- Figma 或其他发布插件评估。

## 19. 测试与质量策略

### 19.1 单元测试

- Schema 校验。
- 命令正向和逆向操作。
- 事务原子性。
- V1/V2 迁移。
- 插件注册和版本兼容。
- 主题合并。

### 19.2 属性与不变量测试

- 元素 ID 唯一。
- 关系端点始终存在。
- 撤销后文档与操作前一致。
- 保存加载往返不丢字段。
- 固定节点布局前后位置相同。
- 删除组时子元素处理符合策略。

### 19.3 布局测试

- 节点不重叠。
- 节点位于父组范围内。
- 边端点连接到合法端口。
- 标签不超出允许边界。
- 布局结果稳定。
- 大图性能基准。

### 19.4 视觉回归

建立覆盖以下结构的固定图库：

- 长中文和英文混合标签。
- 多层嵌套组。
- 反向边、自环和多重边。
- 高入度/高出度节点。
- 泳道跨越。
- 断开组件。
- 16:9、A4 和深色主题。

每次修改布局、主题或渲染器时生成截图 Diff。

### 19.5 端到端测试

- 空白创建 → 编辑 → 保存 → 重开 → 导出。
- 导入 Mermaid → 人工编辑 → DiagramC 保存。
- AI 修改 → Diff → 确认 → 撤销。
- 固定节点 → 局部布局 → 全图布局。
- 插件缺失时的降级打开。

## 20. 验收标准

首个正式可用版本必须满足：

1. 用户不接触 YAML 也能完成建图、编辑和导出。
2. DiagramC 自有格式保存加载无损。
3. AI 修改前可查看结构 Diff。
4. AI 和批量操作均可作为一次事务撤销。
5. 固定节点不会被自动布局移动。
6. 支持全图、选区、组内和连线-only 布局。
7. 标准测试图无节点重叠、无明显文字溢出。
8. 200 节点、400 边基准满足既定性能目标。
9. 新增插件节点类型时不修改 Diagram Core。
10. 云端 AI 关闭后，编辑、布局、校验和导出仍可使用。
11. 导出的 SVG、PNG 与画布呈现基本一致。
12. 所有第三方依赖具备版本、许可证和 NOTICE 记录。

## 21. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| “通用”导致范围失控 | 长期无法形成可用版本 | 内核通用，首版只交付四类图插件 |
| 自动布局结果跳动 | 用户失去空间认知 | 固定节点、局部布局、稳定化和动画 |
| AI 误删或重写 | 文档内容损坏 | 命令协议、临时执行、Diff、确认、撤销 |
| Python/TypeScript 模型漂移 | CLI 与 Web 不兼容 | JSON Schema 单一事实源和共享 fixtures |
| 画布库锁定 | 后期切换成本高 | Canvas Adapter 和选型原型门禁 |
| 复杂边路由性能差 | 大图卡顿 | Worker、布局分级、视口裁剪、可取消 |
| 第三方格式无法无损 | 用户预期落差 | 明确兼容等级，自有格式作为唯一无损格式 |
| 插件破坏文档 | 稳定性和安全问题 | Manifest、API 版本、权限和隔离 |
| 许可证变化 | 商业发布风险 | SBOM、版本锁定、法务门禁和替代后端 |

## 22. 迁移现有 archviz

迁移遵循“先兼容、后替换”：

1. 冻结现有 V1 示例作为兼容 fixtures。
2. 定义 Diagram V2 Schema 和 V1 → V2 转换器。
3. 让现有 Python parser 先输出 V2。
4. 将固定 NodeType 映射为 semanticType。
5. 扩展 LayoutResult，保留 simple-layered 作为回退后端。
6. 让现有 SVG/Mermaid renderer 消费 V2 投影。
7. Web 编辑器达到功能等价后，再迁移默认工作流。
8. 最后重命名 archviz 包或保留兼容命令别名。

迁移期不得同时手工维护两套含义不同的 Diagram 模型。

## 23. 实施前决策清单

进入编码前必须评审并关闭：

- [ ] DiagramC 是独立仓库还是 algo-toolbox 子项目。
- [ ] 是否接受浏览器优先、桌面端后续封装。
- [ ] Diagram Document V2 Schema。
- [ ] X6 与 React Flow 原型门禁结果。
- [ ] ELK.js 许可证和发布 NOTICE 方案。
- [ ] 首版必须支持的四类图。
- [ ] AI 默认提供方和本地模型接口边界。
- [ ] 文档本地保存、服务端保存与协作的优先级。
- [ ] 首版是否包含 PDF 导出。
- [ ] 插件首版只支持内置插件，还是开放第三方安装。

## 24. 参考资料

### 画布和编辑器

- React Flow：https://reactflow.dev/
- xyflow GitHub：https://github.com/xyflow/xyflow
- AntV X6：https://x6.antv.antgroup.com/en/tutorial/about
- AntV X6 GitHub：https://github.com/antvis/X6
- LogicFlow：https://github.com/didi/LogicFlow
- Excalidraw：https://github.com/excalidraw/excalidraw
- tldraw License：https://tldraw.dev/community/license
- Cytoscape.js：https://js.cytoscape.org/
- maxGraph：https://maxgraph.github.io/maxGraph/
- draw.io：https://github.com/jgraph/drawio
- JointJS License：https://www.jointjs.com/license

### 布局

- Eclipse Layout Kernel：https://eclipse.dev/elk/
- ELK Layered：https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
- elkjs：https://github.com/kieler/elkjs
- Graphviz：https://graphviz.org/

### Diagram-as-Code

- Mermaid：https://github.com/mermaid-js/mermaid
- Mermaid Layouts：https://mermaid.js.org/config/layouts
- D2：https://d2lang.com/
- D2 GitHub：https://github.com/terrastruct/d2

## 25. 结论

DiagramC 应从“工程架构图编译器”升级为“结构化图形工作台”。现有语义编译链是正确基础，但真正决定产品价值的是以下闭环：

```text
语义文档
  → AI 或人工增量编辑
  → 结构校验
  → 约束式布局
  → 人工局部调整
  → 视觉检查
  → 多格式发布
  → 可追踪版本变化
```

正式实施时，应优先完成版本化文档协议、可视化编辑器、命令事务和布局系统，再接入 AI。AI 必须建立在稳定可编辑模型之上，而不是成为绕过模型直接生成图片的捷径。
