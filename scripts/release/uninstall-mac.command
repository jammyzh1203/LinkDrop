#!/bin/bash
# LinkDrop 卸载（macOS）：不会删除已下载的素材
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.linkdrop.premiere"
echo "已移除 LinkDrop 面板。"
echo "下载组件（yt-dlp 等）位于：$HOME/Library/Application Support/LinkDrop ，可手动删除。"
read -n 1 -s -r -p "按任意键关闭…"
