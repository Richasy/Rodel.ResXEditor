# Marketplace 发布 / Publishing

## 发布信息 / Identity

- Publisher ID: **Richasy**.
- Publisher Name: **云之幻**.
- Extension ID: **Richasy.rodel-resxeditor**.
- Version: **0.0.1**.
- Upload: **artifacts/rodel-resxeditor-0.0.1.vsix**.
- Extension metadata: `package.json`.
- Generated VSIX manifest: `artifacts/extension.vsixmanifest`，已包含在 VSIX 内，不必单独上传。
- Release checksum and screenshot URLs: `artifacts/release-manifest.json`.

Microsoft 登录账号的邮箱与显示名不是 Publisher ID。创建发布者时 **ID = Richasy，Name = 云之幻**。ID 必须与 package.json 的 publisher 一致；若不可用，修改 publisher 后重新运行 npm run package。

The Microsoft login email/display name is not the publisher ID. Create/select **ID Richasy**, **Name 云之幻**. If the ID is unavailable, update package.json and rebuild before uploading.

## 手动上传 / Manual upload

1. 打开 [发布者管理页](https://marketplace.visualstudio.com/manage)，用你的 Microsoft 账号登录，创建或选择上述 Publisher。
2. 点击 **New extension → Visual Studio Code**，上传 `artifacts/rodel-resxeditor-0.0.1.vsix`。
3. 完成表单并提交，等待验证和发布成功；若有错误，先根据页面提示修复。浏览器上传不需要把 PAT 提供给助手或写入仓库。
4. 打开公开页面，检查图标、中英介绍和四张截图，再在干净的 VS Code 配置中安装。预期链接：`https://marketplace.visualstudio.com/items?itemName=Richasy.rodel-resxeditor`。
5. 向助手确认成功后，再将 GitHub 仓库开源。当前保持私有，没有自动发布/开源。

English: sign in to publisher management, choose **Richasy**, select **New extension → Visual Studio Code**, upload the VSIX, submit and wait for validation. Check the public listing/screenshots and installation. Confirm success before making the GitHub repository public. The browser-upload flow does not require storing a PAT in the project.

## 私有仓库期间的截图 / Screenshots before open source

仓库 README 使用相对 PNG 路径。发布脚本先调用官方 vsce，再将截图注册为可寻址 VSIX 资源，仅改写包内 README 图片地址为版本化 Marketplace gallery URL，避免私有 GitHub 图片失效。生成的 release manifest 列出所有 URL 和包内路径。实际图片托管只能在上传发布后验证。

The repository README keeps relative PNGs. The package script calls official vsce, registers the PNGs as addressable VSIX assets, and rewrites only the packaged README to versioned gallery URLs. This avoids requiring a public GitHub repository before uploading. The release manifest lists all image URLs and paths; live hosting can only be checked after publication. Use **npm run package** for the final upload file; bare vsce package omits this finalization step.

## 重建与本地版本重置 / Rebuild and local reset

```powershell
npm ci
npm run package
code --uninstall-extension Richasy.rodel-resxeditor
code --install-extension .\artifacts\rodel-resxeditor-0.0.1.vsix --force
code --list-extensions --show-versions
```

重载前先应用并保存需要保留的预览结果，草稿只保留在当前编辑器会话。开发宿主使用源码，普通窗口使用已安装 VSIX。

Apply/save needed preview results before reloading: preview drafts are session-local. Development hosts use the source checkout; regular windows use the installed VSIX.

## 后续更新 / Updates

成功发布后需递增版本，保持 Publisher 与扩展名称稳定，不重复使用已发布版本。不要在未准备发布时运行 vsce publish。当前采用手动上传，无自动发布配置。

Increment the version for future updates; keep publisher/name stable and do not reuse published versions. Automated publishing can be configured separately.

Sources: [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [extension manifest](https://code.visualstudio.com/api/references/extension-manifest), [addressable VSIX assets](https://learn.microsoft.com/en-us/azure/devops/extend/develop/manifest#files).
