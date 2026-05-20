# Chess Coach — runner PowerShell (alternativa a `make` su Windows).
# Uso:
#   .\run.ps1 setup
#   .\run.ps1 fetch
#   .\run.ps1 analyze        # aggiungi -Deep per profondità alta, -Limit N per ultime N partite
#   .\run.ps1 metrics
#   .\run.ps1 dashboard
#   .\run.ps1 all

param(
    [Parameter(Position=0)][ValidateSet("setup","fetch","analyze","metrics","dashboard","all","clean","help")]
    [string]$Cmd = "help",
    [switch]$Deep,
    [int]$Limit = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Root ".venv"
$Py   = Join-Path $Venv "Scripts\python.exe"
$Pip  = Join-Path $Venv "Scripts\pip.exe"

function Use-Setup {
    Write-Host "==> Creo venv e installo dipendenze..." -ForegroundColor Cyan
    if (-not (Test-Path $Venv)) { python -m venv $Venv }
    & $Pip install --upgrade pip
    & $Pip install -r (Join-Path $Root "backend\requirements.txt")
    Push-Location (Join-Path $Root "frontend")
    npm install
    Pop-Location
}

function Use-Fetch    { & $Py (Join-Path $Root "backend\ingest.py") }
function Use-Analyze  {
    $args = @((Join-Path $Root "backend\analyze.py"))
    if ($Deep)        { $args += "--deep" }
    if ($Limit -gt 0) { $args += "--limit"; $args += $Limit }
    & $Py @args
}
function Use-Metrics   { & $Py (Join-Path $Root "backend\metrics.py") }
function Use-Dashboard {
    Push-Location (Join-Path $Root "frontend")
    npm run dev
    Pop-Location
}
function Use-Clean {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $Root "data\raw")
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $Root "data\analysis")
    Remove-Item       -Force -ErrorAction SilentlyContinue (Join-Path $Root "data\index.json")
}
function Show-Help {
    Write-Host "Comandi: setup | fetch | analyze [-Deep] [-Limit N] | metrics | dashboard | all | clean"
}

switch ($Cmd) {
    "setup"     { Use-Setup }
    "fetch"     { Use-Fetch }
    "analyze"   { Use-Analyze }
    "metrics"   { Use-Metrics }
    "dashboard" { Use-Dashboard }
    "all"       { Use-Fetch; Use-Analyze; Use-Metrics; Use-Dashboard }
    "clean"     { Use-Clean }
    default     { Show-Help }
}
