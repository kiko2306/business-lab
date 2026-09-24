export interface Identity {
  user: string;
  isAdmin: boolean;
}

/** A property. Units come from Wintouch; what is editable here is the flows. */
export interface Unit {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  checkinActive: boolean;
  quizActive: boolean;
  birthdayActive: boolean;
  promoActive: boolean;
}

/** The four guest flows, each switchable per unit (plan.md §629). */
export const FLOWS = [
  { key: 'checkinActive' as const, label: 'Online check-in' },
  { key: 'quizActive' as const, label: 'Post-stay feedback' },
  { key: 'birthdayActive' as const, label: 'Birthday' },
  { key: 'promoActive' as const, label: 'Promotions' },
];

export type FlowKey = (typeof FLOWS)[number]['key'];

export interface AgentStatus {
  enrolled: boolean;
  id?: string;
  label?: string;
  enrolled_at?: string;
  last_seen_at?: string | null;
}

export interface EnrolmentCode {
  code: string;
  expiresAt: string;
}

/** A pulse question. `isActive` is the only retirement path — see §646. */
export interface Question {
  id: string;
  text: string;
  type: 'rating' | 'text';
  isActive: boolean;
  sortOrder: number;
}
