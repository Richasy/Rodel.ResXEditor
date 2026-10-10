# Marketplace 发布 / Publishing

## 发布信息 / Identity

- Publisher ID: **RichasyZhang**.
- Publisher Name: **云之幻**.
- Extension Name: **Rodel Resource Editor**.
- Extension ID: **RichasyZhang.rodel-resource-editor**.
- Version: **0.0.2**.
- Upload: **artifacts/rodel-resource-editor-0.0.2.vsix**.
- Extension metadata: `package.json`.
- Generated VSIX manifest: `artifacts/extension.vsixmanifest`，已包含在 VSIX 内，不必单独上传。
- Release checksum and screenshot URLs: `artifacts/release-manifest.json`.

Microsoft 登录账号的邮箱与显示名不是 Publisher ID。创建发布者时 **ID = RichasyZhang，Name = 云之幻**。ID 必须与 package.json 的 publisher 一致；若不可用，修改 publisher 后重新运行 npm run package。

The Microsoft login email/display name is not the publisher ID. Create/select **ID RichasyZhang**, **Name 云之幻**. If the ID is unavailable, update package.json and rebuild before uploading.

## 手动上传 / Manual upload

1. 打开 [发布者管理页](https://marketplace.visualstudio.com/manage)，用你的 Microsoft 账号登录，创建或选择上述 Publisher。
2. 选择已有扩展的 **Update**，上传 `artifacts/rodel-resource-editor-0.0.2.vsix`。
3. 完成表单并提交，等待验证和发布成功；若有错误，先根据页面提示修复。浏览器上传不需要把 PAT 提供给助手或写入仓库。
4. 打开公开页面，检查图标、中英介绍和四张截图，再在干净的 VS Code 配置中安装。预期链接：`https://marketplace.visualstudio.com/items?itemName=RichasyZhang.rodel-resource-editor`。
5. 仓库现已开源；本次只生成更新包，不自动发布到 Marketplace。

English: sign in to publisher management, choose **RichasyZhang**, select **Update** on the existing extension, upload the VSIX, submit and wait for validation. Check the public listing/screenshots and installation. The GitHub repository is public. The browser-upload flow does not require storing a PAT in the project.

## README 与截图 / README and screenshots

仓库使用 README.md（英文）与 README.zh-CN.md（中文），互相提供语言切换链接。VSIX 只包含英文 README，中文链接打开公开仓库文件。

使用官方 vsce 将图片相对路径转换为公开 GitHub raw HTTPS 地址，不再依赖自定义 Marketplace 图库资源。发布清单列出四张截图的地址；打包后检查所有地址返回 HTTP 200 和 PNG 内容。

The repository has separate English and Chinese READMEs. Only the English README is included in the VSIX; its language link opens the public Chinese document. Official vsce rewrites screenshots to public GitHub raw URLs. The release manifest lists the URLs, checked for HTTP 200 and PNG content.

## 重建与本地版本重置 / Rebuild and local reset

```powershell
npm ci
npm run package
code --uninstall-extension RichasyZhang.rodel-resource-editor
code --install-extension .\artifacts\rodel-resource-editor-0.0.2.vsix --force
code --list-extensions --show-versions
```

重载前先应用并保存需要保留的预览结果，草稿只保留在当前编辑器会话。开发宿主使用源码，普通窗口使用已安装 VSIX。

Apply/save needed preview results before reloading: preview drafts are session-local. Development hosts use the source checkout; regular windows use the installed VSIX.

## 后续更新 / Updates

已有扩展上传新版本使用 **Update**。临时下架使用 **Unpublish**；不要使用 **Remove**，删除后的扩展名称会永久保留，原发布者也无法重新使用。

Use **Update** to upload a new version and **Unpublish** for temporary withdrawal. **Remove** permanently reserves the deleted extension name, including against reuse by its original publisher.

成功发布后需递增版本，保持 Publisher 与扩展名称稳定，不重复使用已发布版本。不要在未准备发布时运行 vsce publish。当前采用手动上传，无自动发布配置。

Increment the version for future updates; keep publisher/name stable and do not reuse published versions. Automated publishing can be configured separately.

Sources: [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [extension manifest](https://code.visualstudio.com/api/references/extension-manifest), [addressable VSIX assets](https://learn.microsoft.com/en-us/azure/devops/extend/develop/manifest#files).
