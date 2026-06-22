@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: ============================================================
:: Agent Avatar Pro — 一键安装脚本 (Windows)
:: 自动完成：npm install → npm run build → qwenpaw plugin install
:: ============================================================

echo.
echo  ============================================
echo   Agent Avatar Pro — 一键安装
echo  ============================================
echo.

:: ── 检查 Node.js ────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未检测到 Node.js，请先安装 https://nodejs.org/
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [√] Node.js %NODE_VER%

:: ── 检查 npm ────────────────────────────────────────────────
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未检测到 npm
    exit /b 1
)

:: ── 检查 qwenpaw CLI ────────────────────────────────────────
where qwenpaw >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未检测到 qwenpaw CLI
    echo         请确认 QwenPaw 已安装且 qwenpaw 命令在 PATH 中
    exit /b 1
)

echo  [√] qwenpaw CLI 可用
echo.

:: ── Step 1: 安装前端依赖 ────────────────────────────────────
echo  [1/3] 安装前端依赖...
echo.

cd /d "%~dp0frontend"
call npm install --silent
if %errorlevel% neq 0 (
    echo.
    echo  [错误] npm install 失败
    exit /b 1
)

echo  [√] 依赖安装完成
echo.

:: ── Step 2: 构建前端 ────────────────────────────────────────
echo  [2/3] 构建前端...
echo.

call npm run build
if %errorlevel% neq 0 (
    echo.
    echo  [错误] 前端构建失败
    exit /b 1
)

:: 验证构建产物
if not exist "%~dp0dist\index.js" (
    echo.
    echo  [错误] 构建产物 dist\index.js 未生成
    exit /b 1
)

echo.
echo  [√] 前端构建完成
echo.

:: ── Step 3: 安装插件 ────────────────────────────────────────
echo  [3/3] 安装插件到 QwenPaw...
echo.
echo  注意：请确保 QwenPaw 已关闭
echo.

cd /d "%~dp0"
qwenpaw plugin install "%~dp0"
if %errorlevel% neq 0 (
    echo.
    echo  [错误] 插件安装失败，请确认 QwenPaw 已关闭后重试
    exit /b 1
)

echo.
echo  ============================================
echo   安装完成！
echo  ============================================
echo.
echo  启动 QwenPaw 后即可使用 Agent Avatar Pro
echo.

pause
