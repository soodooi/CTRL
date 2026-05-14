# CTRL release build + launch — single command builds a production-mode binary
# with the PWA bundled inside (no Vite dependency at runtime) and launches it.
#
# Use this to see the actual production form: the PWA loads from
# packages/ctrl-web/dist via tauri://localhost (no HTTP, no port).
#
# Usage:
#   .\scripts\release.ps1               # build + launch
#   .\scripts\release.ps1 -Build        # build only, do not launch
#   .\scripts\release.ps1 -SkipBuild    # launch only (rerun previous build)

param(
    [switch]$Build,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$binary = Join-Path $root "src-tauri\target\x86_64-pc-windows-msvc\release\ctrl.exe"
$pwaDist = Join-Path $root "packages\ctrl-web\dist"

function Write-Step($msg, $color = "Cyan") {
    Write-Host "[release] $msg" -ForegroundColor $color
}

if (-not $SkipBuild) {
    # 1. Build the PWA static dist
    Write-Step "building PWA static bundle..."
    Push-Location $root
    & npm run build
    Pop-Location
    if ($LASTEXITCODE -ne 0) {
        Write-Step "PWA build failed; aborting" "Red"
        exit 1
    }
    if (-not (Test-Path $pwaDist)) {
        Write-Step "PWA dist not produced at $pwaDist" "Red"
        exit 1
    }
    $sizeMB = [math]::Round((Get-ChildItem $pwaDist -Recurse | Measure-Object Length -Sum).Sum / 1MB, 2)
    Write-Step "PWA bundle ready ($sizeMB MB on disk)" "Green"

    # 2. Build the release binary
    Write-Step "building release Rust binary (cargo build --release, this takes 5-10 minutes)..."
    & cargo build --manifest-path (Join-Path $root "src-tauri\Cargo.toml") --target x86_64-pc-windows-msvc --release
    if ($LASTEXITCODE -ne 0) {
        Write-Step "cargo release build failed" "Red"
        exit 1
    }
    if (-not (Test-Path $binary)) {
        Write-Step "release binary not produced at $binary" "Red"
        exit 1
    }
    $binMB = [math]::Round((Get-Item $binary).Length / 1MB, 2)
    Write-Step "release binary ready ($binMB MB stripped, target = <=25 MB per ADR-002 §16)" "Green"
}

if ($Build) {
    Write-Step "build-only mode — exit without launching" "Cyan"
    exit 0
}

# 3. Launch
if (-not (Test-Path $binary)) {
    Write-Step "release binary missing — run without -SkipBuild first" "Red"
    exit 1
}
Write-Step "launching release ctrl.exe (kernel + WS bridge + PWA bundled)..."
& $binary
