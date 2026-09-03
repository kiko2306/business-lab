# Security Checklist / Audit

- [x] Input validation for body/query/params on API endpoints
- [x] Allowlisted service name enforcement before service operations
- [x] Request body size limit (`REQUEST_BODY_LIMIT`)
- [x] CORS allowlist validation
- [x] Security headers via `helmet` (CSP, frame protections, MIME protections)
- [x] Rate limiting on mutation endpoints
- [x] Parameterized SQL queries and validated query inputs
- [x] Frontend form validation and invalid submission prevention
- [x] Clipboard paste sanitization for login/setup/settings forms
- [x] Smoke tests for auth/services/settings/health/audit/SSE/error paths
- [x] Optional TOTP two-factor on the dashboard login, per account, enforced
      once enabled ([two-factor.md](two-factor.md)) — secret sealed with
      AES-256-GCM, recovery codes stored as SHA-256 hashes and consumed
      atomically, dedicated 5-minute hand-off token for the second step
