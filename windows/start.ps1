# Startet den Handy Player mit den Einstellungen aus config.ps1.
#   -Log  schreibt die Ausgabe nach windows\logs\ (wird vom Autostart benutzt)
param([switch]$Log)

$ErrorActionPreference = 'Stop'
$appDir = Split-Path $PSScriptRoot -Parent
$logDir = "$PSScriptRoot\logs"
if ($Log) {
    New-Item -ItemType Directory -Force $logDir | Out-Null
    trap { "$(Get-Date -Format s) $_" | Out-File -Append -Encoding utf8 "$logDir\error.log"; exit 1 }
}
$cfg = & "$PSScriptRoot\config.ps1"

function Find-Node {
    $candidates = @(
        "$PSScriptRoot\node\node.exe",
        "$env:ProgramFiles\nodejs\node.exe",
        (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        # winget-Installation nur für den aktuellen Benutzer
        (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS*\*\node.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName)
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    throw 'Node.js nicht gefunden. Bitte setup.ps1 ausführen oder "winget install OpenJS.NodeJS.LTS".'
}

if (-not (Test-Path $cfg.MediaDir)) { Write-Warning "Bibliotheksordner nicht gefunden: $($cfg.MediaDir)" }

$env:MEDIA_DIR = $cfg.MediaDir
$env:HOST      = $cfg.BindHost
$env:PORT      = [string]$cfg.Port
$env:AUTH_USER = $cfg.AuthUser
$env:AUTH_PASS = $cfg.AuthPass
$env:STASH_URL      = [string]$cfg.StashUrl
$env:STASH_API_KEY  = [string]$cfg.StashApiKey
$env:STASH_INSECURE = if ($cfg.StashInsecure) { '1' } else { '' }
$env:TLS_PFX = ''
$env:TLS_PFX_PASS = ''
if ($cfg.Https) {
    if (-not (Test-Path $cfg.PfxFile)) { throw "Zertifikat fehlt: $($cfg.PfxFile) – bitte setup.ps1 ausführen." }
    $env:TLS_PFX      = $cfg.PfxFile
    $env:TLS_PFX_PASS = $cfg.PfxPass
}

$node = Find-Node
if ($Log) {
    $p = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $appDir -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput "$logDir\out.log" -RedirectStandardError "$logDir\error.log"
    exit $p.ExitCode
} else {
    Push-Location $appDir
    try { & $node server.js } finally { Pop-Location }
}
