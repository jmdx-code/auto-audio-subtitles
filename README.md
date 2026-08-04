# 自动音频字幕

一个仅面向最新版 Microsoft Edge 的 Manifest V3 扩展。它在浏览器前台工作台中调用 Edge TTS 生成音频，使用本地打包的 FFmpeg/WASM 裁剪静音、按最大时长拆分 MP3，并输出覆盖完整时间轴的 SRT。

## 当前功能

- 从 Google 表格复制单列数据，正确保留“表格行”和“单元格内部换行”。
- 表格每行是一个项目；文案单元格中的每个有效文本行是一条音频片段和 SRT 字幕。
- 项目工作区使用 Univer 电子表格：固定 A-D 四列，仅文案和项目名称可编辑；支持区域选择、单列粘贴、行高调整和多行单元格编辑，`Tab` 在可编辑单元格间导航。
- 工作表默认创建 20 行；添加项目或粘贴更多内容时会自动扩展，不会截断超出默认行数的文案。
- 工作台采用全高数据表格、紧凑工具栏、按需展开的设置侧栏和不遮挡内容的底部状态栏。
- 全局选择 Edge 音色、语速、音调，并使用相同参数在线试听。
- 自动裁剪静音：阈值 `-50 dB`，开头保留 `0.1 秒`；以 `。！？.!?။၊` 或双引号结尾保留 `0.5 秒`，其他结尾保留 `0.2 秒`。
- 按设定的最大时间在文本行之间拆分；单行音频超过上限时不从中间切开。
- 输出 `01.mp3、02.mp3…` 和一份覆盖全部音频的连续时间轴 SRT。
- 使用 File System Access API 写入用户授权目录；设置和目录句柄跨浏览器重启保存。
- 文案、项目名称和任务状态不缓存，刷新页面即清空。
- 支持暂停、继续、安全取消、单片段三次重试和失败项目重试。
- 所有 FFmpeg JavaScript/WASM 均打包在扩展内，不依赖 CDN，也不需要 Python、原生 FFmpeg 或后端服务。

## 输出规则

每个有效项目使用以下结构：

```text
用户选择的目录/
└─ MMDD-项目名称-序号/
   ├─ 01.mp3
   ├─ 02.mp3          # 总时长超过上限时才会出现
   └─ MMDD-项目名称-序号.srt
```

- 项目名称为空时文件夹名形如 `0803--01`。
- 空项目不生成文件，也不占用序号。
- 同名目录存在时会统一请求确认；确认后只清理旧的数字编号 MP3 和 SRT，不删除其他文件。
- 逐行 WAV/MP3 都是临时数据，处理完成、失败或取消后从扩展 OPFS 清理，不写入用户目录。

## 本地开发

要求：Node.js 20 或更高版本、最新版稳定版 Microsoft Edge。

```bash
npm ci
npm test
npm run build
```

构建产物位于 `dist/`。开发服务器可用：

```bash
npm run dev
```

生产依赖由 Vite 打包进 `dist/`，FFmpeg WASM、字体和许可证文件也随发布包提供。最终用户不需要安装 Node.js、执行 `npm install` 或在首次运行时下载代码依赖；只有在线语音合成本身需要连接 Microsoft 服务。

## 在 Edge 中安装测试

1. 执行 `npm run build`。
2. 在 Edge 地址栏打开 `edge://extensions`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展”，选择本项目的 `dist/` 目录。
5. 点击工具栏中的“自动音频字幕”图标；重复点击会聚焦已打开的工作台。

当前版本通过 GitHub Release ZIP 或本地解压方式分发，暂不发布到 Edge Add-ons 商店。开发版本更新后需要在扩展管理页点击“重新加载”。

## 权限说明

- `storage`：保存音色、语速、音调、最大分段时间、起始序号和试听文本；不保存文案。
- `tabs`：点击扩展图标时聚焦已经打开的工作台，避免重复创建页面。
- `https://speech.platform.bing.com/*`：获取 Edge 音色并进行在线语音合成。
- 输出目录访问不是 Manifest 权限；只有用户主动选择目录并授权后才能写入。
- 不申请无关域名权限，也不注入任何网页脚本。

## 已知限制

- Edge TTS 使用 Microsoft 的非公开接口，可能因服务端变更、限流或网络策略暂时不可用。
- 直接浏览器连接只保证 Microsoft Edge；Chrome、Firefox 和 Safari 不在支持范围内。
- 工作台必须保持打开。刷新或关闭会丢弃当前文案和未完成任务，但不会删除已完成项目。
- 暂停和取消会等待当前网络或 FFmpeg 操作结束后，在下一个安全检查点生效。
- 第一次音频处理需要加载约 32 MB 的本地 WASM 资源，之后由浏览器缓存。

## GitHub 安全发布

`.github/workflows/release.yml` 遵循指定的浏览器扩展安全发布规范：

- 只由 `v*` 标签推送触发。
- 在 Node.js 20 环境执行 `npm ci`、测试和构建。
- 从 `dist/` 内部压缩，保证 ZIP 解压后根目录直接包含 `manifest.json`。
- 发布包同时包含项目许可证、第三方组件说明和主要依赖许可证文本。
- 使用 `actions/attest-build-provenance@v2` 为最终 ZIP 创建构建来源证明。
- 使用默认 `GITHUB_TOKEN` 和 `softprops/action-gh-release@v2`，由 `github-actions[bot]` 上传 Release。

本地测试完成后，再将仓库提交到 `secure-artifacts` 组织并执行安全扫描与审核流程。不要在仓库、Issue 或构建日志中提交 GitHub Token。

### 如何发布新版本

发布版本必须与 `package.json` 和 `manifest.json` 中的版本一致。不要在 GitHub 网页中手工创建 Release 或上传、替换 ZIP；标签推送后由 GitHub Actions 构建、证明并上传产物。

1. 更新 `package.json` 和 `manifest.json` 的版本号，并完成本地验证：

   ```bash
   npm ci
   npm test
   npm run build
   ```

2. 检查并推送代码：

   ```bash
   git status
   git add -A
   git commit -m "release: v0.1.5"
   git push origin main
   ```

3. 创建并推送与版本号一致的附注标签：

   ```bash
   git tag -a v0.1.5 -m "v0.1.5"
   git push origin v0.1.5
   ```

4. 在仓库的 **Actions** 页面确认 `Release Browser Extension` 成功，再到 **Releases** 页面确认 ZIP 和 Attestation 均已生成。

版本号遵循语义化版本：

| 变更类型 | 版本位置 | 示例 |
|---|---|---|
| 不兼容变更 | 主版本 | `1.0.0` → `2.0.0` |
| 向后兼容的新功能 | 次版本 | `1.0.0` → `1.1.0` |
| 向后兼容的修复 | 修订版本 | `1.0.0` → `1.0.1` |

如果标签触发的 workflow 失败，先修复代码并推送新的提交，然后删除失败标签并在修复后的提交上重新创建：

```bash
git tag -d v0.1.5
git push origin :refs/tags/v0.1.5
git tag -a v0.1.5 -m "v0.1.5"
git push origin v0.1.5
```

## 开源许可

本项目使用 [GNU Affero General Public License v3.0](LICENSE) 发布。第三方依赖及许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Edge TTS 是非官方兼容实现；Microsoft、Edge 和 Google 均为其各自权利人的商标。本项目与这些服务提供方没有隶属或背书关系。
