#!/bin/bash
# LinkDrop 安装脚本（macOS）
# 用法：./install.sh        复制安装
#       ./install.sh --dev  以符号链接安装（修改源码后在 Premiere 里重开面板即可生效）
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$DEST_DIR/com.linkdrop.premiere"

mkdir -p "$DEST_DIR"
rm -rf "$DEST"
if [ "$1" = "--dev" ]; then
  ln -s "$SRC" "$DEST"
  echo "已链接：$DEST -> $SRC"
else
  mkdir -p "$DEST"
  rsync -a --exclude 'install.sh' --exclude 'uninstall.sh' --exclude 'install.bat' --exclude 'README.md' --exclude 'test' "$SRC/" "$DEST/"
  echo "已复制到：$DEST"
fi

# 未签名的 CEP 扩展需要开启调试模式才会被 Premiere 加载
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
echo "已开启 CEP PlayerDebugMode（CSXS 9–12）"
echo
echo "完成！请重启 Premiere Pro，然后在菜单「窗口 → 扩展 → LinkDrop 链接素材」打开面板。"
