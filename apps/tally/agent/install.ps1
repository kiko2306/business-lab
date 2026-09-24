#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the Tally shop agent as a Windows Service in one pass.

.DESCRIPTION
  Replaces the four manual steps in README.md's Install section (copy the
  files, edit tally.config, run `enrol`, `sc.exe create`/`start`) with one
  prompt-driven script — the README item this closes. Run it from the
  published output folder (`dotnet publish`), i.e. the same directory as
  Tally.Agent.exe.

  -RunAsAdministrator is required: installing into Program Files and
  registering a service both need elevation, and failing early with .NET's
  own clear error beats a confusing permission-denied partway through.

.EXAMPLE
  .\install.ps1 -Url https://tally.example.com -Code ABCD2345

.EXAMPLE
  .\install.ps1
  # Prompts for the site URL and enrolment code interactively.
#>
[CmdletBinding()]
param(
    [string]$Url,
    [string]$Code,
    [string]$InstallDir = "$Env:ProgramFiles\Tally",
    # Matches this repo's own dev machine and every install seen so far
    # (plan.md §629) — overridable for a shop whose Wintouch lives elsewhere.
    [string]$WintouchDir = "C:\wintouch\sgw"
)

$ErrorActionPreference = 'Stop'

$sourceDir = $PSScriptRoot
$exeName = 'Tally.Agent.exe'
if (-not (Test-Path (Join-Path $sourceDir $exeName))) {
    throw "$exeName not found next to install.ps1. Run this from the published output folder (dotnet publish), not the source tree."
}

if (-not $Url) { $Url = Read-Host 'Tally site URL (e.g. https://tally.example.com)' }
if (-not $Code) { $Code = Read-Host 'Enrolment code (from Tally: issue one, then paste it here)' }
if (-not $Url -or -not $Code) { throw 'Both the site URL and the enrolment code are required.' }
if (-not (Test-Path (Join-Path $WintouchDir 'wintouch.config'))) {
    throw "No wintouch.config under $WintouchDir. Pass -WintouchDir if Wintouch isn't installed there."
}

Write-Host "Installing into $InstallDir..."
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
if ((Resolve-Path $sourceDir).Path -ne (Resolve-Path $InstallDir).Path) {
    Copy-Item -Path (Join-Path $sourceDir '*') -Destination $InstallDir -Recurse -Force
}

# Same two settings the manual step edits into tally.config by hand
# (tally.config.example) — nothing else in this file varies per install.
$configPath = Join-Path $InstallDir 'tally.config'
@"
<?xml version="1.0" encoding="utf-8"?>
<tallyAgent>
  <url value="$Url" />
  <wintouchConfig path="$WintouchDir" />
</tallyAgent>
"@ | Set-Content -Path $configPath -Encoding UTF8

$exePath = Join-Path $InstallDir $exeName

Write-Host 'Enrolling...'
& $exePath enrol $Code
if ($LASTEXITCODE -ne 0) {
    throw 'Enrolment failed. Check the code is current (it expires in minutes) and the URL is reachable, then re-run this script.'
}

$serviceName = 'Tally.Agent'
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    # A fresh enrolment above already replaced whatever the server was
    # tracking (README.md: "re-enrolling ... replaces the machine currently
    # reporting") — restarting the existing service picks up the new token
    # rather than leaving a stale one running.
    Write-Host 'Service already registered; restarting to pick up the new enrolment...'
    Restart-Service -Name $serviceName
}
else {
    Write-Host 'Registering the service...'
    sc.exe create $serviceName binPath= "`"$exePath`"" start= auto | Out-Null
    sc.exe start $serviceName | Out-Null
}

Write-Host "Done. $serviceName is installed and running from $InstallDir."
