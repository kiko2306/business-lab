# Tally shop agent

Runs on the shop's own machine, beside Wintouch. It **dials out** to the Tally
site and answers questions over that connection; nothing at the shop listens,
and no router change is needed (plan.md §627).

## What it needs

- Nothing to install first: the setup exe is self-contained (it bundles the .NET runtime).
- Read access to Wintouch's SQL Server. Credentials are read from the local
  `wintouch.config` — they are never sent anywhere and never fetched from the
  server.

It does **not** load Wintouch's own assemblies, because it only reads. That is
why it is plain `net8.0` rather than x86-pinned like the hotel agent, whose
write path has to go through their API (plan.md §629).

## Install

The agent is **one file**: `Wintouch.Tally.Agent-Setup-<version>.exe`, self-contained (no
.NET runtime to install), downloaded from the Tally page (admins see a
**Download setup** card). Every image build publishes it from this source
tree (plan.md §670), so the file always matches the running site.

1. In Tally, open the shop and choose **Issue enrolment code**.
2. On the shop's machine, open the setup exe. It asks for administrator rights,
   then prompts for the site URL, the enrolment code and the Wintouch folder
   (Enter accepts `C:\wintouch\sgw`). It copies itself to
   `%ProgramFiles%\Wintouch.Tally.Agent`, writes `tally.config`, enrols, and registers and
   starts the service with restart-on-failure — the manual steps below, done
   for you.

To skip a prompt, save `install.config.example` as `install.config` next to the
setup exe and fill that value in; anything left empty is still asked.

**Versions.** `VERSION` here is the base (`1.0.0`); the build appends a hash of
every file in this folder, so the version shown on the Tally page and logged on
connect (`1.0.0-<hash>`) changes on any rebuild that changed the agent. Bump
`VERSION` by hand for a change worth naming.

**Updating** is just running the new setup: it keeps the installed URL and
Wintouch folder and, on an already-enrolled machine, asks for nothing — it stops
the service, replaces the exe and starts it again. A code (in `install.config`,
or asked for when you point it at a different site) re-enrols instead.

Re-running the setup with a fresh code replaces the machine currently
reporting, so a rebuilt POS needs no clean-up on the server — the setup stops
the running service, replaces the exe, and starts it again on the new token.

<details>
<summary>What the installer actually does (for a manual install, or to
understand a failure)</summary>

1. Copy the exe to `%ProgramFiles%\Wintouch.Tally.Agent`, and `tally.config.example` to `tally.config` beside it and set
   the site URL and the Wintouch folder.
2. Run once, with the enrolment code:

   ```
   Wintouch.Tally.Agent.exe enrol ABCD2345
   ```

   The code is single-use and expires in minutes. The token it returns is
   long-lived and stored DPAPI-encrypted under `%ProgramData%\Tally`.
3. Install and start the service:

   ```
   sc.exe create Wintouch.Tally.Agent binPath= "C:\Program Files\Wintouch.Tally.Agent\Wintouch.Tally.Agent.exe" start= auto
   sc.exe start Wintouch.Tally.Agent
   ```

</details>

## Diagnostics

Run `Wintouch.Tally.Agent.exe run` from a console — the same binary — and it logs to the
terminal instead of the event log. (With no arguments the exe is the setup.) `TALLY_CONFIG` overrides the config path.
