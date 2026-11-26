#!/bin/bash
# 卸载 LinkDrop（不会删除已下载的素材）
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.linkdrop.premiere"
echo "已移除面板。下载组件位于：$HOME/Library/Application Support/LinkDrop（可手动删除）"
