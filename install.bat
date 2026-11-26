@echo off
chcp 65001 >nul
REM LinkDrop 安装脚本（Windows）
set "SRC=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.linkdrop.premiere"
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
robocopy "%SRC%." "%DEST%" /E /XF install.sh uninstall.sh install.bat README.md /XD test >nul
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo 完成！请重启 Premiere Pro，然后在「窗口 - 扩展 - LinkDrop 链接素材」打开面板。
pause
