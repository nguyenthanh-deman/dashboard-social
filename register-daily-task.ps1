# Registers a Windows scheduled task that runs the daily snapshot (run-daily.bat).
# Usage (run once):  powershell -ExecutionPolicy Bypass -File .\register-daily-task.ps1 [-At 06:30]
# Remove:            Unregister-ScheduledTask -TaskName DashboardSocialDaily -Confirm:$false
param([string]$At = '06:30')
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$action = New-ScheduledTaskAction -Execute (Join-Path $dir 'run-daily.bat') -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At $At
# StartWhenAvailable: if the PC was off at the scheduled time, run as soon as it is back on
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'DashboardSocialDaily' -Action $action -Trigger $trigger -Settings $settings -Description 'Snapshot Zernio data and build the weekly report for dashboard-social' -Force | Out-Null
Get-ScheduledTask -TaskName 'DashboardSocialDaily' | Select-Object TaskName, State
Write-Host "Registered daily run at $At."
