@echo off
chcp 65001 >nul
REM LinkDrop 安装（Windows）：双击运行
set "SRC=%~dp0extension"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.linkdrop.premiere"
if not exist "%SRC%\CSXS\manifest.xml" (
  echo 找不到 extension 文件夹，请先完整解压安装包再运行。
  pause
  exit /b 1
)
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
robocopy "%SRC%" "%DEST%" /E >nul
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo LinkDrop 已安装到：%DEST%
echo.
echo 请重启 Premiere Pro，然后打开菜单「窗口 - 扩展 - LinkDrop 链接素材」。
echo 首次使用时在面板里点「一键安装」下载 yt-dlp。
pause
