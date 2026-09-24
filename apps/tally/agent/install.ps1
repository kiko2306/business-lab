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
  .\install.ps1
  # Asks for the site URL, enrolment code and Wintouch folder — unless filled in
  # install.config beside the script. They are not parameters, so a code never
  # lands in shell history or a shared command line.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$Env:ProgramFiles\Tally"
)

$ErrorActionPreference = 'Stop'

$sourceDir = $PSScriptRoot
$exeName = 'Tally.Agent.exe'
if (-not (Test-Path (Join-Path $sourceDir $exeName))) {
    throw "$exeName not found next to install.ps1. Run this from the published output folder (dotnet publish), not the source tree."
}

# install.config (beside this script) pre-answers any of the three questions;
# an empty or missing value falls through to the prompt.
$answers = @{ url = ''; code = ''; wintouchDir = '' }
$answersPath = Join-Path $sourceDir 'install.config'
if (Test-Path $answersPath) {
    $xml = [xml](Get-Content -Path $answersPath -Raw)
    foreach ($key in @($answers.Keys)) {
        $node = $xml.tallyInstall.$key
        if ($node -and $node.value) { $answers[$key] = $node.value.Trim() }
    }
}

$Url = $answers.url
if (-not $Url) { $Url = Read-Host 'Tally site URL (e.g. https://tally.example.com)' }
$Code = $answers.code
if (-not $Code) { $Code = Read-Host 'Enrolment code (from Tally: issue one, then paste it here)' }
# The default matches this repo's own dev machine and every install seen so far
# (plan.md §629); Enter accepts it, a shop whose Wintouch lives elsewhere types
# its own folder.
$WintouchDir = $answers.wintouchDir
if (-not $WintouchDir) { $WintouchDir = Read-Host 'Wintouch folder (the one holding wintouch.config) [C:\wintouch\sgw]' }
if (-not $WintouchDir) { $WintouchDir = 'C:\wintouch\sgw' }
if (-not $Url -or -not $Code) { throw 'Both the site URL and the enrolment code are required.' }
if (-not (Test-Path (Join-Path $WintouchDir 'wintouch.config'))) {
    throw "No wintouch.config under $WintouchDir. Re-run and enter the folder Wintouch is installed in."
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
