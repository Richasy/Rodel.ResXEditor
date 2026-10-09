# Rodel.ResXEditor

独立的 VS Code `.resw` / `.resx` 资源编辑器。当前版本 `0.1.12` 是本地试用版，不发布到 Marketplace。

## 安装与打开

需要 VS Code 1.95 或更新版本。使用 **Extensions → … → Install from VSIX** 安装 `artifacts/rodel-resxeditor-0.1.12.vsix`，或：

```powershell
code --install-extension .\artifacts\rodel-resxeditor-0.1.12.vsix --force
```

资源文件右键 **Open Resource Editor**，或命令面板 **Rodel: Open Resource Editor**。也可以使用 **Reopen Editor With → Rodel Resource Editor**。扩展默认采用可选编辑器注册，避免抢占 XML / Git 比较；需要自动打开表格时，可在 VS Code 中选择此编辑器为默认。

第一次试用建议打开仓库的 `samples` 文件夹：`Strings/zh-CN/Resources.resw` 与 `Strings/en-US/Resources.resw` 是专门创建的独立样本。真实 IT之家资源仅用来读取布局与格式，没有修改。

## 表格操作

- 固定 Key 列，自动发现同一映射的语言并排列出，源语言下拉框可以切换；Comment 列显示源语言注释，可以隐藏。
- 顶部提供添加资源、翻译、保存，更多菜单包含批量添加、撤销/重做、Excel、注释显示和原文入口；菜单支持方向键和 Esc。选中资源才显示改名/复制/删除工具栏。右侧语言栏可收起。
- 单元格失去焦点时提交到 VS Code 文档，不会自动保存。Tab / Shift+Tab、Enter 导航；Shift+Enter 输入换行；Esc 放弃当前单元格草稿。
- Ctrl/Cmd+Enter 添加键，Bulk add 每行一个键；新增键、重命名、复制以及选中删除同步作用于同一映射的所有语言。
- 搜索 Key、Value、Comment；按 Key 正反排序；筛选缺失、与源值相同和只读资源。排序只改变展示，不重排原始 XML。
- 单元格右上角的圆点表示缺失，链接表示与源值相同，锁表示只读。状态不占行高；悬停或聚焦图标查看解释。编辑时 Alt+右方向键聚焦状态，Esc 返回文本。
- 侧栏显示每种语言的完成度、缺失项和相同值数量，点击缺失项定位到单元格。
- Save all 保存映射内所有脏文档；Ctrl/Cmd+S 也可使用。操作形成原生 WorkspaceEdit，支持文档撤销与重做。未提交的单元格草稿使用输入框自己的撤销栈。
- 重复键、损坏 XML、DTD 或合并标记阻止不安全编辑，使用 Open XML 修复。非字符串资源和复杂 XML 显示为只读，原文完整保留。

## 保存与冲突

修改通过原文范围补丁进行，不整份序列化 XML。保留非目标节点、头部、XML 注释、属性顺序、引号风格、`xml:space`、缩进、换行。简单 CDATA 在安全时继续保留。编码与 BOM 由 VS Code TextDocument 保存机制维护，已验证 UTF-8 BOM / CRLF 与 UTF-16 LE BOM。

跨语言操作是单个原子 WorkspaceEdit；保存各文件是顺序执行，不能承诺跨文件磁盘事务。文档仍可撤销，失败文件仍保留脏状态。编辑与预览都校验文档版本，不应用过时结果。外部修改同步使用原生文档机制；磁盘与脏文档冲突时表格明确提示，Save all 拒绝直接覆盖，请 Open XML 后保存，使用 VS Code 原生 Compare / Overwrite 流程解决。分屏视图共享文档。

## 语言发现与创建

支持：

```text
Project/Strings/zh-CN/Resources.resw
Project/Strings/en-US/Resources.resw
Project/Strings/zh-CN/Errors.resw       # 独立映射
Project/Resources.resx
Project/Resources.zh-CN.resx
Project/Resources.fr.resx
```

映射按项目路径与资源文件名隔离，不合并不同项目或不同资源组。普通独立资源也可以编辑，不依赖 Sprout。`.resw` 只在 `Strings/<language>` 约定下推断目录语言，避免把普通目录名误当成语言代码；`.resx` 使用文件名文化后缀。语言别名指向同一文化而产生歧义时明确报错。

目录、项目、现有资源右键 **Add Language Resource**，选择格式，输入 BCP-47 语言和文件名；也提供命令面板与 New File 入口。只创建请求的那一种语言，不存在隐含 `en-US` 创建或回退。显式 `rodelResx.defaultLanguage` 优先；`projectAdapter=auto` 可以读取最近项目的显式 `SproutDefaultLanguage`，多个项目默认值不一致时不猜测。原有默认语言文件与 csproj 不会被改写。

可通过 **Rodel: Enable Resource File Nesting** 主动启用 `.resx` 与 Designer 的 Explorer 嵌套。

## Copilot 翻译

点击 Copilot 或运行 **Rodel: Translate Resources with Copilot**。选中一条、几条，或不选择以处理全部缺失项；选目标语言和当前可用的 Copilot 模型。通过官方 `vscode.lm.selectChatModels({ vendor: 'copilot' })` 与 `sendRequest` 调用，授权由 VS Code / Copilot 处理。没有第三方翻译服务或额外 API Key。

请求包含 Key、Comment、源值、源/目标语言与可选术语表。已有非空人工翻译默认跳过。默认同时处理 3 个批次（translationConcurrency 可设为 1–6），有可取消进度与输入 Token 检查；每批完成后实时追加到差异预览，取消会保留已经通过校验的结果供确认应用，并停止后续批次、通知正在执行的模型请求取消，授权/配额错误明确提示。校验 `{0}`、`{name}`、格式符、标记及换行，校验失败的结果不会进入预览。预览逐条选择后才能应用；源文档或目标版本改变后拒绝应用。

Copilot 未安装、未登录或模型不可用时基础编辑照常可用。模型请求可能计入 Copilot 配额；测试不自动调用真实付费模型。

## Excel

Export 输出 `.xlsx`，格式为 `Key | Comment | language…`，冻结 Key / 表头；Comment 属于选定源语言。Import 校验列名、重复键、只读项与纯文本单元格，拒绝公式与数值单元格。先展示 Before / After，允许跳过具体更改；应用后保持未保存。不存在的行不表示删除；空白且不存在的目标单元格保持缺失状态。未知语言需先创建文件再导入。文件上限 10 MB、20,000 行、100 列。

## 可选 Designer

默认关闭。启用 `rodelResx.generateDesigner`，配置 `designerNamespace` 和准确的程序集资源基名 `designerBaseName`，打开中性 `.resx` 原文后运行 **Rodel: Generate ResX Designer**。当前只支持唯一的 ASCII C# 标识符字符串键；不覆盖其他工具生成的 Designer。不会生成 `.resw` 类型访问器，Sprout 生成器继续负责。

## 开发与验证

```powershell
npm ci
npm run check
npm test
npm run build
npm run test:host
npm run test:ui
npm run test:designer
npm run package
```

F5 启动独立 Extension Development Host，默认打开 `samples`。`test:host` 使用本机 VS Code 和独立的临时工作区/profile；可设置 `VSCODE_EXECUTABLE`。`test:ui` 用 headless Edge，或通过 `TEST_BROWSER` 指定兼容 Chromium 的浏览器。

代码分层：`src/core` 不依赖 VS Code；`documents.ts` 负责原生文档、版本检查和原子编辑；`editor.ts` 负责 CustomTextEditor 生命周期与消息边界；`copilot.ts` / `excel.ts` 处理外部输入与预览；`media` 是无框架 Webview。主题使用官方颜色、字体变量与 Codicons，CSP 禁止任意网络内容，资源文本只通过 DOM textContent/value 渲染。

验证细节、已完成与剩余项见 [docs/STATUS.md](docs/STATUS.md)。

## 参考

按公开功能范围独立实现，未复用其他扩展代码：

- [ResX Editor Pro 功能范围](https://marketplace.visualstudio.com/items?itemName=GingerTurtle.resx-editor-pro)
- [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)
- [Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)

长文本试用样本位于 `samples/LongText/Strings`，包含中文/英文段落、显式换行和空行、30 行文本、长 URL、长 Key 与长注释。单元格按实际折行自动增高，最多显示 12 行，剩余内容可在单元格内滚动；短文本块在行内垂直居中。

Copilot 翻译按目标语言批量处理，默认每批最多 20 条（`rodelResx.translationBatchSize`，范围 2–50），并按模型输入预算进一步拆分。没有单次翻译总量限制；选定语言的全部缺失项会分批连续处理，旧 `translationLimit` 设置不再生效。每批包含 Key、Source、Comment 和术语表，返回后验证 ID 与占位符，再进入差异预览；已有人工翻译保持不变。不自动以单条请求重试失败批次。

手动真实联调：`npm run test:copilot:live` 会在开发窗口复用本机 Copilot 登录，需点击“开始 Copilot 联调”、选择语言/模型并按官方流程授权。只复制 `samples/Copilot` 到独立测试目录，25 个键中有 3 个人工翻译、22 个缺失项，预计两个批次。不会修改样本源文件或真实项目资源。测试报告写入 `.vscode-test/copilot-live-*/report.json`，此命令不属于默认测试。

存量资源的自然语言语法检查列为后续低优先级功能：按语言批量检查拼写、语法及用词一致性，保留占位符与原有语义，返回可逐条接受的修订建议。它与当前 XML 结构校验分别处理。

真实 Copilot 联调已完成：gpt-5.4-mini 使用 2 个批次翻译 22 项，零保护校验失败，人工译文、源文及撤销/重做验证通过。记录见 `docs/COPILOT-LIVE-RESULT.json`。显式自动选择的联调方式为 `npm run test:copilot:live -- --auto`，仅固定 en-US 并优先选择轻量模型，仍遵循官方授权。

语言显示筛选：点击工具栏 Visible languages，可按语言代码或名称搜索并多选。Source 始终勾选、不可取消，切换 Source 后自动显示新源语言。首次打开默认展示源语言和最多两种目标语言，显示选择保存在当前资源编辑器状态中；支持 Show all 和 Source only。侧栏继续统计所有语言，点击隐藏语言的缺失项会自动显示并定位。筛选不改变增删改资源的范围或 Copilot 目标语言选择。资源筛选和 Source 下拉框采用设置页风格的主题化列表，支持方向键、Home/End、Enter、Escape 与字母定位。

More actions 菜单：Bulk add 批量添加键；Undo/Redo 撤销/重做已提交的资源编辑；Export to Excel… 导出 Key、源语言 Comment 与各语言列到 xlsx；Import from Excel… 读取 xlsx，校验后逐条预览差异，确认才应用；Show comment column 显示/隐藏源语言的注释列，图标和背景高亮表示开启，不附加勾选图标；Open resource XML 打开原文 XML。新增、复制、改名后自动选中并高亮对应行，清除可能隐藏资源的搜索/筛选并滚动定位，聚焦源语言 Value。批量新增高亮所有新行并定位到第一项。

翻译/导入差异预览支持按目标语言筛选，搜索 Key、源文、注释、原值和修改后文本，显示可见/总计/选中数量。筛选只影响显示，应用所有语言中已勾选的项；可批量勾选或取消勾选当前可见项。Proposed 列可直接编辑多行译文，后续批次保留修改和勾选状态。修改后再次检查 XML 字符、占位符、标记与换行；有错误的选中项须修正或取消勾选后才能应用，主机在写入前再次校验。确认应用后支持撤销/重做。Cancel translation 仅在请求进行中显示，完成和取消后隐藏。

预览的可见项选择使用单一切换按钮：可见项全选时取消全选，未全选时选中全部可见项，空筛选结果时禁用。短译文单行紧凑显示，多行/自动换行按内容展开，超过八行才显示内部滚动条；缩短文本后自动收紧。
