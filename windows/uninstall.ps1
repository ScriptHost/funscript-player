# Entfernt Autostart und Firewall-Regel (als Administrator). Dateien und Node.js bleiben erhalten.
$taskName = 'Handy Player'
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName $taskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*nodejs*" -or $_.Path -like "$PSScriptRoot*" } |
    Where-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like '*server.js*' } |
    Stop-Process -Force
Write-Host 'Autostart und Firewall-Regel entfernt.'
