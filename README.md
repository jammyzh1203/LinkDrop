# LinkDrop · Premiere Pro 链接素材面板

在 Premiere 里粘贴 YouTube / Bilibili / 抖音 / Vimeo 等链接，自动下载并出现在项目面板的素材箱里，无需手动导入。

## 功能

- **粘贴即下载**：在输入框粘贴（或点剪贴板按钮、或从浏览器把链接拖进面板），自动识别分享文案里的链接，支持一次粘贴多条
- **自动导入**：下载完成后导入到「网络素材」素材箱（名称可改），可选直接插入 / 覆盖到当前序列播放头
- **Premiere 兼容**：优先选 H.264 + AAC；如果只有 VP9 / AV1 / Opus（如 YouTube 4K），自动用 ffmpeg 转成 H.264（Mac 上用 VideoToolbox 硬件编码）
- **阅流分享链接**：支持 `yueliu.smallrig.com` 的分享页，自动读取分享里的全部视频（含子文件夹），每个文件一个任务。下载的是阅流云端转码版本（免登录可看的最高清晰度，如 4K 竖屏原片对应 1080×1920）；原文件和非视频文件需要登录阅流，暂不支持；有访问密码的分享暂不支持
- **画质**：480p / 720p / 1080p / 4K / 最高 / 仅音频
- **登录内容**：可读取 Chrome / Edge / Firefox / Safari 的 Cookies，用于 B 站高清 / 大会员、YouTube 年龄限制视频
- **素材跟着项目走**：默认保存到 `.prproj` 旁的「LinkDrop 素材」文件夹；未保存的项目则存到 `~/Movies/LinkDrop`
- 队列、并发下载、进度 / 速度 / 剩余时间、取消、重试、在访达中显示

## 安装

**下载安装包**：到 Releases 页面下载最新的 `LinkDrop-x.y.z.zip`，解压后：

- macOS：双击 `Install LinkDrop.command`（提示「无法验证开发者」时，到「系统设置 → 隐私与安全性」点「仍要打开」）
- Windows：双击 `Install LinkDrop (Windows).bat`

然后**重启 Premiere Pro**，菜单 **窗口 → 扩展 → LinkDrop 链接素材**。

> 安装脚本会把面板复制到 CEP 扩展目录，并开启 `PlayerDebugMode`（未签名的 CEP 扩展必须开启才会被加载）。

**从源码安装**：

```bash
./install.sh          # 复制安装
./install.sh --dev    # 符号链接安装，改完代码在 Premiere 里关掉面板再打开即可
```

Windows 源码安装：双击 `install.bat`。

**打包**：`./scripts/build.sh` 生成 `dist/LinkDrop-<版本>.zip`（版本号取自 `CSXS/manifest.xml`）。

## 依赖组件

| 组件 | 用途 | 获取方式 |
|---|---|---|
| yt-dlp | 解析与下载（必需） | 面板里点「一键安装」，从 yt-dlp 官方 GitHub 下载到 `~/Library/Application Support/LinkDrop/bin` |
| Deno 或 Node ≥ 20 | YouTube 解析需要的 JS 运行时 | 已装 Node 会自动使用；否则「安装 / 修复组件」会下载 Deno |
| ffmpeg | 合并高清音视频、转码 | 需自行安装（`brew install ffmpeg` 或放到 `~/bin`）；面板自动在常见位置查找 |

网站改版导致下载失败时，在设置里点「更新 yt-dlp」。

## 文件结构

```
CSXS/manifest.xml   CEP 清单（Premiere 22+，CSXS 9+）
index.html          面板界面
css/style.css       仿 Premiere 深色界面
js/downloader.js    yt-dlp / ffmpeg 封装（纯 Node，可脱离 Premiere 测试）
js/main.js          界面与队列逻辑
jsx/host.jsx        ExtendScript：建素材箱、importFiles、插入时间轴
.debug              远程调试：Premiere 运行时用 Chrome 打开 http://localhost:8088（不进发布包）
scripts/build.sh    打包发布用 zip
scripts/release/    发布包里的双击安装 / 卸载脚本和说明
```

## 说明

请仅下载你拥有版权或已获授权使用的内容，并遵守各平台的服务条款。
