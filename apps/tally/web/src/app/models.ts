export interface Store {
  id: string;
  name: string;
  isActive: boolean;
  /** Whether an agent is enrolled — never anything about its token. */
  agentEnrolled: boolean;
  /** Whether that agent is on its socket right now (plan.md §634). */
  connected: boolean;
  lastSeenAt: string | null;
  /** What the agent last reported on connecting (plan.md §672); null before its first connect. */
  agentVersion: string | null;
}

export interface EnrolmentCode {
  code: string;
  expiresAt: string;
}

export interface Identity {
  user: string;
  isAdmin: boolean;
}

/** Tally's own SMTP sender (plan.md §648). The password is never returned. */
export interface SmtpSettings {
  configured: boolean;
  host: string;
  port: number;
  encryption: 'tls' | 'ssl' | 'none';
  username: string;
  passwordConfigured: boolean;
  fromAddress: string;
  fromName: string;
}

/**
 * The shop-floor payloads.
 *
 * These are the contract the .NET agent implements, and they are **aggregated
 * on the shop side** — the legacy sent five raw DataTables and summed them in
 * the browser, including the whole sales table with no date filter (plan.md
 * §622, §626). Totals and counts arrive already computed; only genuinely
 * per-row detail crosses the wire.
 */
export interface Overview {
  asOf: string;
  totals: { invoiced: number; open: number };
  tables: { free: number; occupied: number; awaitingPayment: number };
  clients: { present: number };
  staff: { code: string; name: string; total: number }[];
  payments: { method: string; total: number }[];
  /** Takings per hour of the current trading day, empty hours included. */
  hourly: { hour: number; total: number }[];
}

export interface TableLine {
  quantity: number;
  description: string;
  total: number;
}

export interface ShopTable {
  table: number;
  state: 'occupied' | 'awaiting-payment';
  staff: string;
  guests: number;
  openedAt: string | null;
  total: number;
  lines: TableLine[];
}

export interface TablesView {
  asOf: string;
  free: number;
  occupied: number;
  awaitingPayment: number;
  tables: ShopTable[];
}

export interface SoldItemsView {
  asOf: string;
  totalQuantity: number;
  totalValue: number;
  items: { description: string; quantity: number; total: number }[];
}

/** The agent setup exe built into this image (plan.md §670). */
export interface AgentPackage {
  version: string;
  file: string;
}
