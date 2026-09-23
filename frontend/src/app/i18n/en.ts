/**
 * English strings — also the fallback `TranslateService.t()` reaches for
 * when the active locale is missing a key (e.g. a page not yet migrated to
 * `t()`, plan.md §597). Keep this dictionary the superset.
 */
export const en: Record<string, string> = {
  'shell.nav.apps': 'Apps',
  'shell.nav.backups': 'Backups',
  'shell.nav.settings': 'Settings',
  'shell.nav.content': 'Content',
  'shell.nav.utils': 'Utils',
  'shell.nav.users': 'Users & roles',
  'shell.nav.auditLogs': 'Audit logs',
  'shell.nav.updates': 'Updates',
  'shell.nav.security': 'Security',
  'shell.nav.recovery': 'Recovery',
  'shell.signedInAs': 'Signed in as {{username}}',
  'shell.logout': 'Logout',
  'shell.languageLabel': 'Language',

  'login.title.signIn': 'Sign in',
  'login.title.mfa': 'Two-factor authentication',
  'login.subtitle.credentials': 'Use your administrator credentials to manage services.',
  'login.subtitle.mfaCode': 'Enter the 6-digit code from your authenticator app.',
  'login.subtitle.mfaRecovery': 'Enter the recovery code.',
  'login.username.label': 'Email / username',
  'login.username.error': 'Username must be 3-64 characters.',
  'login.password.label': 'Password',
  'login.password.error': 'Password is required and must be at most 128 characters.',
  'login.submit': 'Sign in',
  'login.mfa.codeLabel': 'Authentication code',
  'login.mfa.recoveryLabel': 'Recovery code',
  'login.mfa.error': 'Enter the code from your authenticator app, or a recovery code.',
  'login.mfa.verify': 'Verify',
  'login.mfa.useAuthenticator': 'Use your authenticator app',
  'login.mfa.useRecoveryCode': 'Use a recovery code',
  'login.mfa.startOver': 'Start over',
  'login.setup.prompt': 'First time here?',
  'login.setup.link': 'Create the initial administrator account',
  'login.toast.success': 'Signed in successfully.',
  'login.error.signInFailed': 'Unable to sign in.',
  'login.error.codeRejected': 'That code was not accepted.',
};
