@echo off
chcp 65001 >nul
rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\com.linkdrop.premiere"
echo 已移除 LinkDrop 面板。下载组件位于 %APPDATA%\LinkDrop ，可手动删除。
pause
