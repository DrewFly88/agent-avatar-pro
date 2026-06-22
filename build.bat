@echo off
chcp 65001 >nul 2>&1

:: ============================================================
:: Agent Avatar Pro — 仅构建前端（开发用）
:: 用于修改代码后重新生成 dist/index.js
:: ============================================================

echo.
echo  构建前端...
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未检测到 Node.js
    exit /b 1
)

cd /d "%~dp0frontend"

:: 如果 node_modules 不存在，先安装
if not exist "node_modules" (
    echo  首次构建，安装依赖...
    call npm install --silent
    echo.
)

call npm run build
if %errorlevel% neq 0 (
    echo.
    echo  [错误] 构建失败
    exit /b 1
)

echo.
echo  [√] 构建完成 → dist\index.js
echo.
