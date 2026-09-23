export interface Store {
  id: string;
  name: string;
  isActive: boolean;
  /** Whether an agent is enrolled — never anything about its token. */
  agentEnrolled: boolean;
  /** Whether that agent is on its socket right now (plan.md §634). */
  connected: boolean;
  lastSeenAt: string | null;
}

export interface EnrolmentCode {
  code: string;
  expiresAt: string;
}
