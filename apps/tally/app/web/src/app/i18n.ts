import { Pipe, PipeTransform } from '@angular/core';

/**
 * English and European Portuguese, no library. The English text *is* the key,
 * so templates stay readable (`{{ 'Refresh' | t }}`) and a string with no entry
 * below simply shows in English rather than as a raw key. `{name}` marks a
 * value filled in by the caller.
 *
 * The language is fixed for the life of the page: Angular takes LOCALE_ID once
 * at bootstrap, and dates and currency must follow the same choice as the
 * words, so switching stores it and reloads (see setLang).
 */
export type Lang = 'en' | 'pt-PT';

const STORAGE_KEY = 'tally-lang';

function detect(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'pt-PT') return stored;
  } catch {
    // Storage blocked (private window): fall through to the browser's language.
  }
  return navigator.language?.toLowerCase().startsWith('pt') ? 'pt-PT' : 'en';
}

export const lang: Lang = detect();

/** For `Intl` calls in code; the templates get theirs from LOCALE_ID. */
export const numberLocale = lang === 'pt-PT' ? 'pt-PT' : 'en-IE';

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered, but the reload below still applies it for this page.
  }
  location.reload();
}

const PT: Record<string, string> = {
  'Language': 'Idioma',
  'Invoices, employees and payments control': 'Controlo de faturas, funcionários e pagamentos',

  // Shop list
  'Shops': 'Lojas',
  'New shop name': 'Nome da nova loja',
  'Add shop': 'Adicionar loja',
  'Shop agent for Windows': 'Agente da loja para Windows',
  'Version': 'Versão',
  "Run the setup on the shop's machine (it asks for administrator rights), then paste the enrolment code from a shop below.":
    'Execute o instalador na máquina da loja (pede direitos de administrador) e cole o código de registo de uma das lojas abaixo.',
  'Download setup': 'Transferir instalador',
  'Loading…': 'A carregar…',
  'No shops yet. Add one above, then issue it an enrolment code to connect its agent.':
    'Ainda não há lojas. Adicione uma acima e emita-lhe um código de registo para ligar o respetivo agente.',
  'Shop': 'Loja',
  'Status': 'Estado',
  'Agent': 'Agente',
  'Last seen': 'Visto pela última vez',
  'Actions': 'Ações',
  'Active': 'Ativa',
  'Inactive': 'Inativa',
  'Not enrolled': 'Não registado',
  'Online': 'Online',
  'Offline': 'Offline',
  'Out of date — latest is {v}': 'Desatualizada — a mais recente é {v}',
  'Current version': 'Versão atual',
  'Open': 'Abrir',
  'Close': 'Fechar',
  'Manage': 'Gerir',
  'Rename': 'Renomear',
  'Deactivate': 'Desativar',
  'Activate': 'Ativar',
  'Delete': 'Eliminar',
  'New name': 'Novo nome',
  'Delete "{name}"? Its access grants and enrolled agent go with it.':
    'Eliminar "{name}"? Os acessos concedidos e o agente registado são eliminados com ela.',
  'Revoke the agent for "{name}"? It stops reporting on its next call.':
    'Revogar o agente de "{name}"? Deixa de reportar na próxima chamada.',

  // Shop management panel
  'Who can see this shop': 'Quem pode ver esta loja',
  'Authelia usernames. Anyone listed here sees this shop; administrators see every shop regardless.':
    'Nomes de utilizador do Authelia. Quem estiver na lista vê esta loja; os administradores veem todas, independentemente disso.',
  'Nobody yet — only administrators can see it.': 'Ainda ninguém — só os administradores a podem ver.',
  'Remove': 'Remover',
  'Authelia username': 'Utilizador do Authelia',
  'Grant': 'Conceder',
  'An agent is enrolled and is': 'Há um agente registado e está',
  'connected now': 'ligado neste momento',
  'not connected': 'desligado',
  '— out of date; the latest is': '— desatualizado; o mais recente é',
  ', download it above.': ', transfira-o acima.',
  'Issuing a new code replaces it — the machine currently reporting stops on its next call.':
    'Emitir um novo código substitui-o — a máquina que está a reportar deixa de o fazer na próxima chamada.',
  "No agent yet. Issue a code and enter it in the installer on the shop's POS machine, along with this site's address.":
    'Ainda não há agente. Emita um código e introduza-o no instalador, na máquina do POS da loja, juntamente com o endereço deste site.',
  'Issue enrolment code': 'Emitir código de registo',
  'Revoke agent': 'Revogar agente',
  'Copy this now — it is shown once.': 'Copie-o agora — só é mostrado uma vez.',
  'It is not stored anywhere readable, so it cannot be shown again. If it is lost, issue another.':
    'Não fica guardado em lado nenhum de forma legível, por isso não pode ser mostrado outra vez. Se se perder, emita outro.',
  'Copied': 'Copiado',
  'Copy': 'Copiar',
  'Expires': 'Expira',

  // Shop page
  'All shops': 'Todas as lojas',
  'Agent version': 'Versão do agente',
  'Closed day': 'Dia fechado',
  'Business day': 'Dia de trabalho',
  'As of': 'Atualizado às',
  'Day': 'Dia',
  'Running day': 'Dia em curso',
  'Refresh': 'Atualizar',
  'This shop is offline.': 'Esta loja está offline.',
  "Its agent is not connected, so there are no live figures to show. Nothing is displayed rather than showing the last known numbers as though they were current. It reconnects by itself once the shop's machine and network are back.":
    'O agente não está ligado, por isso não há valores em direto para mostrar. Não se mostra nada em vez de apresentar os últimos valores conhecidos como se fossem atuais. Volta a ligar-se sozinho assim que a máquina e a rede da loja estiverem de volta.',
  'Invoiced': 'Faturado',
  'Open tabs': 'Contas abertas',
  'Forecast': 'Previsto',
  'Tables in use': 'Mesas em uso',
  'awaiting payment': 'a aguardar pagamento',
  'Guests in': 'Clientes presentes',
  'Transactions': 'Transações',
  'Average ticket': 'Talão médio',
  'Customers': 'Clientes',
  'Discounts': 'Descontos',
  'Consumptions': 'Consumos',
  'Rooms, offers, internal use': 'Quartos, ofertas, consumo interno',
  'Occupancy': 'Ocupação',
  'Takings by hour': 'Receita por hora',
  'Taken by staff': 'Receita por funcionário',
  'Nothing taken yet.': 'Ainda nada faturado.',
  'By payment method': 'Por método de pagamento',
  'No payments yet.': 'Ainda sem pagamentos.',
  'Tables': 'Mesas',
  'Items sold': 'Artigos vendidos',
  'Table': 'Mesa',
  'State': 'Estado',
  'Staff': 'Funcionário',
  'Guests': 'Pessoas',
  'Opened': 'Abertura',
  'Total': 'Total',
  'Occupied': 'Ocupada',
  'Awaiting payment': 'A aguardar pagamento',
  'No tables open. {n} free.': 'Nenhuma mesa aberta. {n} livres.',
  'Nothing ordered yet.': 'Ainda nada pedido.',
  '{q} items, {v}.': '{q} artigos, {v}.',
  'Top items by quantity': 'Artigos mais vendidos por quantidade',
  'Nothing sold yet.': 'Ainda nada vendido.',
  'Item': 'Artigo',
  'Family': 'Família',
  'Quantity': 'Quantidade',

  // Charts
  'Nothing to show yet.': 'Ainda nada para mostrar.',
  'No takings yet today.': 'Ainda sem receita hoje.',
  'Peak {v} at {h}:00': 'Pico de {v} às {h}:00',

  // Errors
  'Not signed in, and reloading did not help. The proxy may not be forwarding identity headers.':
    'Sessão não iniciada e recarregar não ajudou. O proxy pode não estar a reencaminhar os cabeçalhos de identidade.',
  'Request failed ({status})': 'O pedido falhou ({status})',
  'Could not reach the shop ({status})': 'Não foi possível contactar a loja ({status})',
};

export function t(text: string, params?: Record<string, string | number | null>): string {
  let out = (lang === 'pt-PT' && PT[text]) || text;
  for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll(`{${k}}`, String(v ?? ''));
  return out;
}

@Pipe({ name: 't', standalone: true })
export class TPipe implements PipeTransform {
  transform(text: string, params?: Record<string, string | number | null>): string {
    return t(text, params);
  }
}
