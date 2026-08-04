# 第三方组件说明

生产构建包含以下关键第三方组件：

| 组件 | 版本 | 许可 | 用途 |
|---|---:|---|---|
| `edge-tts-universal` | 1.4.0 | AGPL-3.0 | Edge TTS 浏览器协议、音色列表与音频合成 |
| `@ffmpeg/ffmpeg` | 0.12.15 | MIT | FFmpeg/WASM JavaScript 控制层 |
| `@ffmpeg/core` | 0.12.10 | GPL-2.0-or-later | 音频解码、静音裁剪、拼接与 MP3 编码 |
| `@webextkits/storage-local` | 1.0.0 | MIT | 类型化的 `chrome.storage.local` 设置存储 |
| `@univerjs/presets` / `@univerjs/preset-sheets-core` | 0.25.1 | Apache-2.0 | 项目电子表格、选择、格式与渲染 |
| `@fontsource/noto-sans-myanmar` | 5.3.0 | OFL-1.1 | 缅甸文显示字体 |
| React / React DOM | 19.2.8 | MIT | 工作台界面 |
| Lucide React | 0.468.0 | ISC | 界面图标 |

`@ffmpeg/core` 的构建包含 `libmp3lame`，因此本项目整体采用 AGPL-3.0，并公开完整对应源代码和构建脚本。发布包根目录包含项目 `LICENSE` 和本说明，`licenses/` 目录包含全部直接运行依赖所需的许可证文本。完整对应源代码及构建脚本与每个发布版本一同提供。

Microsoft Edge 的在线 TTS 服务属于 Microsoft。本项目不包含服务端模型、语音数据或 Microsoft 凭据，只在用户主动操作时从其浏览器发起请求。
