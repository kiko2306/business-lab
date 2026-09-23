/**
 * European Portuguese (pt-PT — "utilizador"/"palavra-passe"/"ecrã" spelling
 * and vocabulary, not Brazilian pt-BR). Keys not listed here fall back to
 * `en` (plan.md §597) — expected while later pages are still unmigrated.
 */
export const ptPT: Record<string, string> = {
  'shell.nav.apps': 'Aplicações',
  'shell.nav.backups': 'Cópias de segurança',
  'shell.nav.settings': 'Definições',
  'shell.nav.content': 'Conteúdo',
  'shell.nav.utils': 'Utilitários',
  'shell.nav.users': 'Utilizadores e funções',
  'shell.nav.auditLogs': 'Registos de auditoria',
  'shell.nav.updates': 'Atualizações',
  'shell.nav.security': 'Segurança',
  'shell.nav.recovery': 'Recuperação',
  'shell.signedInAs': 'Sessão iniciada como {{username}}',
  'shell.logout': 'Terminar sessão',
  'shell.languageLabel': 'Idioma',

  'login.title.signIn': 'Iniciar sessão',
  'login.title.mfa': 'Autenticação de dois fatores',
  'login.subtitle.credentials': 'Utilize as suas credenciais de administrador para gerir os serviços.',
  'login.subtitle.mfaCode': 'Introduza o código de 6 dígitos da sua aplicação de autenticação.',
  'login.subtitle.mfaRecovery': 'Introduza o código de recuperação.',
  'login.username.label': 'Email / nome de utilizador',
  'login.username.error': 'O nome de utilizador deve ter entre 3 e 64 carateres.',
  'login.password.label': 'Palavra-passe',
  'login.password.error': 'A palavra-passe é obrigatória e deve ter no máximo 128 carateres.',
  'login.submit': 'Iniciar sessão',
  'login.mfa.codeLabel': 'Código de autenticação',
  'login.mfa.recoveryLabel': 'Código de recuperação',
  'login.mfa.error': 'Introduza o código da sua aplicação de autenticação, ou um código de recuperação.',
  'login.mfa.verify': 'Verificar',
  'login.mfa.useAuthenticator': 'Utilizar a aplicação de autenticação',
  'login.mfa.useRecoveryCode': 'Utilizar um código de recuperação',
  'login.mfa.startOver': 'Recomeçar',
  'login.setup.prompt': 'Primeira vez aqui?',
  'login.setup.link': 'Criar a conta de administrador inicial',
  'login.toast.success': 'Sessão iniciada com sucesso.',
  'login.error.signInFailed': 'Não foi possível iniciar sessão.',
  'login.error.codeRejected': 'Esse código não foi aceite.',
};
