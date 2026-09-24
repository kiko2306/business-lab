# Tally shop agent

Runs on the shop's own machine, beside Wintouch. It **dials out** to the Tally
site and answers questions over that connection; nothing at the shop listens,
and no router change is needed (plan.md §627).

## What it needs

- .NET 8 runtime (or publish self-contained).
- Read access to Wintouch's SQL Server. Credentials are read from the local
  `wintouch.config` — they are never sent anywhere and never fetched from the
  server.

It does **not** load Wintouch's own assemblies, because it only reads. That is
why it is plain `net8.0` rather than x86-pinned like the hotel agent, whose
write path has to go through their API (plan.md §629).

## Install

1. `dotnet publish -c Release -r win-x64 --self-contained false` and copy the
   output folder onto the shop's machine (it needs the .NET 8 runtime, and
   `install.ps1` is copied along with everything else — it's part of the
   build output, not this source tree).
2. In Tally, open the shop and choose **Issue enrolment code**.
3. From an elevated PowerShell, in that folder:

   ```powershell
   .\install.ps1 -Url https://tally.example.com -Code ABCD2345
   ```

   Run it with no arguments to be prompted for the URL and code instead.
   Installs into `%ProgramFiles%\Tally`, enrols, and registers + starts the
   service in one pass — the four manual steps below, done for you.

Re-enrolling (re-running `install.ps1` with a fresh code) replaces the
machine currently reporting, so a rebuilt POS needs no clean-up on the
server — it just restarts the existing service once the new token is stored.

<details>
<summary>What the installer actually does (for a manual install, or to
understand a failure)</summary>

1. Copy `tally.config.example` to `tally.config` beside the executable and set
   the site URL and the Wintouch folder.
2. Run once, with the enrolment code:

   ```
   Tally.Agent.exe enrol ABCD2345
   ```

   The code is single-use and expires in minutes. The token it returns is
   long-lived and stored DPAPI-encrypted under `%ProgramData%\Tally`.
3. Install and start the service:

   ```
   sc.exe create Tally.Agent binPath= "C:\Program Files\Tally\Tally.Agent.exe" start= auto
   sc.exe start Tally.Agent
   ```

</details>

## Diagnostics

Run it from a console — the same binary — and it logs to the terminal instead
of the event log. `TALLY_CONFIG` overrides the config path.
