# CTRL dev launcher — single command starts Vite + waits for :5173 ready + launches ctrl.exe
#
# Why this exists:
#   The debug binary expects the PWA at http://localhost:5173 (Vite dev server).
#   Without Vite running, the WebView shows ERR_CONNECTION_REFUSED. The standard
#   fix is "open two terminals" or "npm run tauri:dev" (which rebuilds fully).
#   This script keeps the fast path: Vite in background, debug binary in
#   foreground, both shut down when you Ctrl-C.
#
# Usage:
#   .\scripts\dev.ps1
#
# Or from anywhere:
#   powershell -ExecutionPolicy Bypass -File D:\code-space\ctrl\scripts\dev.ps1

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$binary = Join-Path $root "src-tauri\target\x86_64-pc-windows-msvc\debug\ctrl.exe"
$viteLog = Join-Path $root ".dev-vite.log"

function Write-Step($msg, $color = "Cyan") {
    Write-Host "[dev] $msg" -ForegroundColor $color
}

# Pre-flight: binary built?
if (-not (Test-Path $binary)) {
    Write-Step "ctrl.exe not built yet — running cargo build (debug, Win target)..." "Yellow"
    & cargo build --manifest-path (Join-Path $root "src-tauri\Cargo.toml") --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) {
        Write-Step "cargo build failed; aborting" "Red"
        exit 1
    }
}

# Pre-flight: npm deps installed?
$webNodeModules = Join-Path $root "packages\ctrl-web\node_modules"
if (-not (Test-Path $webNodeModules)) {
    Write-Step "ctrl-web npm deps missing — running npm install..." "Yellow"
    Push-Location $root
    & npm install
    Pop-Location
    if ($LASTEXITCODE -ne 0) {
        Write-Step "npm install failed; aborting" "Red"
        exit 1
    }
}

# Start Vite in background
Write-Step "starting Vite dev server (logs -> $viteLog)..."
$viteJob = Start-Process -PassThru -WindowStyle Hidden `
    -FilePath "npm.cmd" `
    -ArgumentList "run","dev" `
    -WorkingDirectory $root `
    -RedirectStandardOutput $viteLog `
    -RedirectStandardError "$viteLog.err"

# Wait for :5173 (up to 45s — Vite cold start can be slow on first run)
Write-Step "waiting for Vite on :5173..."
$ready = $false
for ($i = 1; $i -le 45; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($r.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # not ready yet — keep polling
    }
}

if (-not $ready) {
    Write-Step "Vite did not respond within 45s. Last log lines:" "Red"
    Get-Content $viteLog -Tail 20 -ErrorAction SilentlyContinue
    Get-Content "$viteLog.err" -Tail 20 -ErrorAction SilentlyContinue
    if ($viteJob -and -not $viteJob.HasExited) {
        Stop-Process -Id $viteJob.Id -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
Write-Step "Vite ready (http://localhost:5173)" "Green"
Write-Step "launching ctrl.exe..."

# Launch ctrl.exe in foreground; cleanup vite + leftover ctrl when it exits
try {
    & $binary
} finally {
    Write-Host "`n[dev] cleaning up..." -ForegroundColor Cyan
    if ($viteJob -and -not $viteJob.HasExited) {
        Stop-Process -Id $viteJob.Id -Force -ErrorAction SilentlyContinue
    }
    Get-Process -Name "ctrl" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
