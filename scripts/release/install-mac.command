#!/bin/bash
# LinkDrop 安装（macOS）：双击运行
cd "$(dirname "$0")"
SRC="$(pwd)/extension"
DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$DEST_DIR/com.linkdrop.premiere"

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "找不到 extension 文件夹，请先完整解压安装包再运行。"
  read -n 1 -s -r -p "按任意键关闭…"; exit 1
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null

# 未签名的 CEP 扩展需要开启 PlayerDebugMode 才会被 Premiere 加载
for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "LinkDrop 已安装到：$DEST"
echo
echo "请重启 Premiere Pro，然后打开菜单「窗口 → 扩展 → LinkDrop 链接素材」。"
echo "首次使用时在面板里点「一键安装」下载 yt-dlp。"
echo
read -n 1 -s -r -p "按任意键关闭…"
