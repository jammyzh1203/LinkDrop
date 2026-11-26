#!/bin/bash
# 打包发布用安装包：dist/LinkDrop-<版本>.zip
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER=$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$ROOT/CSXS/manifest.xml")
NAME="LinkDrop-$VER"
OUT="$ROOT/dist"
STAGE="$OUT/$NAME"

rm -rf "$STAGE" "$OUT/$NAME.zip"
mkdir -p "$STAGE/extension"
# 发布包不带 .debug（远程调试端口只在开发时打开）
cp -R "$ROOT/CSXS" "$ROOT/index.html" "$ROOT/css" "$ROOT/js" "$ROOT/jsx" "$STAGE/extension/"
find "$STAGE" -name '.DS_Store' -delete

R="$ROOT/scripts/release"
cp "$R/install-mac.command"   "$STAGE/Install LinkDrop.command"
cp "$R/uninstall-mac.command" "$STAGE/Uninstall LinkDrop.command"
cp "$R/install-windows.bat"   "$STAGE/Install LinkDrop (Windows).bat"
cp "$R/uninstall-windows.bat" "$STAGE/Uninstall LinkDrop (Windows).bat"
cp "$R/README.txt"            "$STAGE/README.txt"
chmod +x "$STAGE"/*.command

(cd "$OUT" && zip -qr -X "$NAME.zip" "$NAME")
rm -rf "$STAGE"
echo "$OUT/$NAME.zip"
