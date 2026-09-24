# Hotel property agent

Runs on the property's own machine, beside Wintouch. Syncs units, guests and
reservations *out* of Wintouch into hotel-core, and writes completed online
check-ins *back* into Wintouch — the only path back in (plan.md §620, §627).

Unlike tally's agent, it dials out over plain HTTPS with a bearer token
rather than holding a socket open (§627 — its push model tolerates minutes),
and both reads and writes go through Wintouch's own in-process business-tier
API rather than a SQL connection string, because that's what the legacy
agent already does successfully in production against this exact install
(confirmed by reading `sample/hotel/WHotWebService`'s DAO classes directly)
— see plan.md §653 for why that's a deliberate departure from §629's
original "SQL for reads" sketch.

## What it needs

- Windows, with the .NET Framework 4.8 runtime.
- Installed **into Wintouch's own folder** (`C:\wintouch\sgw`), so its
  assemblies are already on the process's search path at load time — the
  same layout the legacy agent used (its build output path was literally
  `wintouch\sgw\`).
- A Wintouch *application* user (an operator login for `SetCurrentUser`, not
  the SQL Server login in `Wintouch.config`) — ask an admin for one dedicated
  to this agent.

## Why there is no CI job for this project

Every other app in this repo builds in CI. This one cannot: it references
Wintouch's own proprietary DLLs by `HintPath`, and those files exist only on
a machine with Wintouch installed — they are never vendored into this
**public** repository, and CI has no such machine. `tally-agent`'s CI job
works precisely because tally's agent never loads a Wintouch assembly at
all (plan.md §636); this one always does, for both reads and writes, so the
same trick does not apply here.

**This means the code in this directory has not been build-verified.** It
was written as a close, field-by-field port of the legacy's own DAO classes
(`sample/hotel/WHotWebService/DAO/*.cs`), which are compiled and running in
production against this exact Wintouch install, and every business-tier
call it makes was checked against that source rather than guessed — but it
has not been compiled, let alone run, against the real assemblies. The
first real build has to happen on a Windows machine with Wintouch
installed; see the README TODO item this ships with for what to check
there.

## Install

1. Copy `hotel.config.example` to `hotel.config` beside the executable and
   fill in the site URL, the Wintouch folder, and the operator username/password.
2. In hotel-core's admin UI, issue an enrolment code.
3. Run once, with that code:

   ```
   Hotel.Agent.exe enrol ABCD2345
   ```

   The code is single-use and expires in minutes. The token it returns is
   long-lived and stored DPAPI-encrypted under `%ProgramData%\HotelAgent`.
4. Install and start the service:

   ```
   sc.exe create Hotel.Agent binPath= "C:\wintouch\sgw\Hotel.Agent.exe" start= auto
   sc.exe start Hotel.Agent
   ```

Re-enrolling with a fresh code replaces the agent currently reporting —
there is only ever one for the whole deployment (plan.md §638), unlike
tally's one-per-shop.

## Diagnostics

Run it from a console — the same binary — and it also prints to the
terminal; a real service has no console, so `%ProgramData%\HotelAgent\logs`
is the only place its output otherwise lands. `HOTEL_CONFIG` overrides the
config path.

## Not yet covered

- **Birthday, promo and check-out/online-payment** are out of scope here —
  separate README items (plan.md §629). This agent only ever runs the
  check-in/quiz-adjacent sync jobs the legacy's `ServiceManager` actually
  wired into its tick (units, guests, reservations, check-in write-back);
  `CheckOut.cs` and the invoice/payment DAOs were already dormant in the
  legacy and are not ported.
