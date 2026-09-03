# Two-factor authentication (TOTP)

The management dashboard is reachable from the internet over the Cloudflare
Tunnel (`homelab.tx-home-utils.com` / `api-homelab.tx-home-utils.com`),
independent of whether any managed app is exposed. Its login is username +
password only. Time-based one-time passwords (TOTP, RFC 6238) add a second
factor to that login.

- **Per account, opt-in.** Each admin turns it on for their own account. Once
  on, it is required for that account's next sign-in.
- **Not Authelia.** Authelia fronts *exposed apps*; the dashboard's own auth is
  this backend. Putting Authelia in front of the tool that starts Authelia
  would make "Authelia is down" mean "nobody can sign in to fix it".
- **Admins do not enrol on behalf of others.** An admin can reset another
  user's password, but cannot push a second factor onto someone else's phone.

## Turn it on

1. Sign in, open the user menu, and go to **Account security** (`/account`).
2. Click **Set up two-factor authentication**. The page shows a QR code and the
   secret in text.
3. In an authenticator app — Google Authenticator, 1Password, Aegis, etc. —
   scan the QR (or type the secret). The account shows up as
   **Homelab Management** with your username.
4. Enter the 6-digit code the app is showing and click **Activate**.
5. The page then shows **ten recovery codes, once**. Save them somewhere off
   this machine (a password manager, printed and filed). Each works once.
   Use **Download** or **Copy**, then **I've saved them**.

Two-factor is now on. The next sign-in on this account will ask for a code.

## Sign in with it on

1. Enter username and password as usual.
2. When the password is correct and the account has 2FA on, the login screen
   asks for a **6-digit code**. Enter the current code from the authenticator
   app.
3. No code to hand? Choose **use a recovery code** and enter one of the ten.
   That code is then spent.

The code step has its own short time limit — if it expires, **Start over** and
re-enter the password.

## Recovery codes

- Ten are issued when you activate, single-use, shown **only** at that moment.
- Using one to sign in consumes it. **Account security** shows how many are
  left.
- To get a fresh set, disable two-factor and set it up again — activation
  always issues a new ten and discards any old ones.

## Turn it off

On **Account security**, in the enabled state, enter **either** a current
6-digit code **or** your account password, then **Disable two-factor
authentication**. The secret and all recovery codes are deleted.

## Lost the authenticator (and the recovery codes)

This is a lockout. On the host:

```bash
./start.sh recover disable-2fa <username>
```

It takes only the username (no password), clears that account's TOTP secret,
deletes its recovery codes, and writes a `recovery_disable_2fa` audit row. The
account then signs in with password alone until it is enrolled again.

`./start.sh recover reset-password` deliberately does **not** also drop 2FA — a
lost password and a lost phone are different events. See
[recovery-troubleshooting.md](recovery-troubleshooting.md).

## How it works

- **Library**: `otplib` for TOTP, `qrcode` to render the enrolment QR as an
  inline SVG **on the server** — the browser never generates or sees anything
  the server didn't send. Both are ordinary bundled npm libraries (MIT), like
  `bcryptjs`; no `docs/licences.md` row.
- **Secret at rest**: the TOTP secret is sealed with AES-256-GCM under a key
  derived from `JWT_SECRET` (`HKDF-SHA256`, info `homelab-totp-secret-v1`) and
  stored as `v1:<iv>:<tag>:<ciphertext>` in `users.totp_secret`. Nothing new to
  configure. **Rotating `JWT_SECRET` invalidates every enrolment** — unsealing
  fails closed, so affected users must re-enrol (and can sign in with a
  recovery code, or be cleared with `recover disable-2fa`, in the meantime).
- **Recovery codes**: stored only as SHA-256 hashes (`totp_recovery_codes`).
  The codes are high-entropy random, so a fast hash is enough. A code is
  consumed in the same `UPDATE ... WHERE used_at IS NULL` that checks it, so a
  replay or race cannot spend one twice.
- **Login hand-off**: `POST /auth/login` with a correct password on a 2FA
  account returns `202 { mfaRequired: true, mfaToken }` and creates **no**
  session. `mfaToken` is a 5-minute JWT with `purpose: "mfa"`, signed with its
  own derived key so it can never be replayed as an access token.
  `POST /auth/login/totp { mfaToken, code }` finishes the sign-in.
- **Rate limiting**: both `/auth/login` and `/auth/login/totp` sit behind the
  shared auth rate limiter.

## Audit actions

| Action | When |
|---|---|
| `totp_activate` | enrolment completed (`success`) or a wrong code at activate (`failure`) |
| `totp_disable` | 2FA turned off (`success`) or a failed re-verify (`failure`) |
| `login_mfa_challenge` | password accepted, code step handed out |
| `login_mfa` | code step passed (`success`) or a bad code (`failure`) |
| `login_recovery_code_used` | a recovery code was spent to sign in |
| `recovery_disable_2fa` | `./start.sh recover disable-2fa` ran |

## API

The endpoints (`/auth/totp/{status,setup,activate,disable}`, the `202` branch
of `/auth/login`, and `/auth/login/totp`) are in
[openapi.yaml](openapi.yaml). All four `/auth/totp/*` calls need a valid access
token; the two login calls do not.
