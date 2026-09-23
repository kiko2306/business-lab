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

1. Copy `tally.config.example` to `tally.config` beside the executable and set
   the site URL and the Wintouch folder.
2. In Tally, open the shop and choose **Issue enrolment code**.
3. Run once, with that code:

   ```
   Tally.Agent.exe enrol ABCD2345
   ```

   The code is single-use and expires in minutes. The token it returns is
   long-lived and stored DPAPI-encrypted under `%ProgramData%\Tally`.
4. Install and start the service:

   ```
   sc.exe create Tally.Agent binPath= "C:\Program Files\Tally\Tally.Agent.exe" start= auto
   sc.exe start Tally.Agent
   ```

Re-enrolling with a fresh code replaces the machine currently reporting, so a
rebuilt POS needs no clean-up on the server.

## Diagnostics

Run it from a console — the same binary — and it logs to the terminal instead
of the event log. `TALLY_CONFIG` overrides the config path.
