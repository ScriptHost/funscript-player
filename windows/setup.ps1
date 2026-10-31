# Einrichtung des Handy Players unter Windows (als Administrator ausführen).
#   - installiert Node.js LTS (winget), falls nicht vorhanden
#   - erzeugt ein selbstsigniertes HTTPS-Zertifikat, falls in config.ps1 aktiviert und keins vorhanden
#   - öffnet den Port in der Windows-Firewall
#   - richtet den Autostart als geplante Aufgabe ein
#
#   -NoAutostart      keinen Autostart einrichten
#   -AtLogon          Autostart bei Anmeldung des aktuellen Benutzers statt beim Systemstart als SYSTEM
#                     (nötig, wenn der Medienordner ein verbundenes Netzlaufwerk ist)
#   -FirewallFrom     Firewall nur für diese Adresse(n) öffnen, z. B. die IP deines Reverse Proxys
param(
    [switch]$NoAutostart,
    [switch]$AtLogon,
    [string[]]$FirewallFrom = @('Any')
)

$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Bitte PowerShell als Administrator starten.'
}

$cfg = & "$PSScriptRoot\config.ps1"
$taskName = 'Handy Player'

# 1) Node.js
if (-not (Test-Path "$env:ProgramFiles\nodejs\node.exe") -and -not (Test-Path "$PSScriptRoot\node\node.exe")) {
    Write-Host 'Installiere Node.js LTS …'
    winget install --id OpenJS.NodeJS.LTS -e --scope machine --silent --accept-source-agreements --accept-package-agreements
    if (-not (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { throw 'Node.js-Installation fehlgeschlagen.' }
} else {
    Write-Host 'Node.js ist vorhanden.'
}

# 2) Zertifikat
if ($cfg.Https -and -not (Test-Path $cfg.PfxFile)) {
    Write-Host "Erzeuge selbstsigniertes Zertifikat für: $($cfg.CertNames -join ', ')"
    New-Item -ItemType Directory -Force (Split-Path $cfg.PfxFile) | Out-Null
    $cert = New-SelfSignedCertificate -DnsName $cfg.CertNames -CertStoreLocation 'Cert:\LocalMachine\My' `
        -FriendlyName 'Handy Player' -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy Exportable
    $pw = ConvertTo-SecureString $cfg.PfxPass -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $cfg.PfxFile -Password $pw | Out-Null
    Export-Certificate -Cert $cert -FilePath ([IO.Path]::ChangeExtension($cfg.PfxFile, '.cer')) | Out-Null
    Remove-Item "Cert:\LocalMachine\My\$($cert.Thumbprint)"
    Write-Host "  -> $($cfg.PfxFile) (die .cer daneben kannst du auf deinen Geräten als vertrauenswürdig importieren)"
}

# 3) Firewall
Get-NetFirewallRule -DisplayName $taskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $taskName -Direction Inbound -Protocol TCP -LocalPort $cfg.Port `
    -RemoteAddress $FirewallFrom -Action Allow | Out-Null
Write-Host "Firewall: TCP $($cfg.Port) geöffnet für $($FirewallFrom -join ', ')"

# 4) Autostart
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
if (-not $NoAutostart) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\start.ps1`" -Log"
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    if ($AtLogon) {
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $taskPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
    } else {
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Autostart eingerichtet und gestartet (Aufgabe '$taskName'). Logs: $PSScriptRoot\logs"
}

$scheme = if ($cfg.Https) { 'https' } else { 'http' }
Write-Host ""
Write-Host "Fertig. Aufrufen unter: ${scheme}://<IP-oder-Name-der-VM>:$($cfg.Port)"
