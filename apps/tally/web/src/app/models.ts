export interface Store {
  id: string;
  name: string;
  isActive: boolean;
  /** Whether an agent is enrolled — never anything about its token. */
  agentEnrolled: boolean;
  lastSeenAt: string | null;
}

export interface EnrolmentCode {
  code: string;
  expiresAt: string;
}
