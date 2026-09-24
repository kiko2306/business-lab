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
  /** Not a guest flow like the four above — an admin/back-office automation, so it's outside FLOWS (plan.md §656). */
  checkoutActive: boolean;
  /** Days before check-in / after check-out the guest email goes out (plan.md §651). */
  checkinOffsetDays: number;
  quizOffsetDays: number;
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

/** The hotel's own SMTP sender (plan.md §648). The password is never returned. */
export interface SmtpSettings {
  configured: boolean;
  host: string;
  port: number;
  encryption: 'tls' | 'ssl' | 'none';
  username: string;
  passwordConfigured: boolean;
  fromAddress: string;
  fromName: string;
  /** Recipient for the 15-minute agent-down alert (plan.md §651). Blank skips sending it. */
  alertEmail: string;
}

/**
 * A checked-out reservation with a bill computed from Wintouch, awaiting a
 * staff decision on who to bill it to (plan.md §656). No online payment and
 * no fiscal document here — settling one just tells Wintouch which account
 * the charges belong on; reception still invoices in Wintouch's own POS.
 */
export interface CheckoutLine {
  line: number;
  itemName: string;
  quantity: string;
  unitPrice: string;
}

export interface Checkout {
  id: string;
  number: string;
  line: number;
  checkoutOn: string;
  total: string;
  unit: string;
  guest: { code: string; firstName: string | null; lastName: string | null } | null;
  lines: CheckoutLine[];
}

/** One guest-text template row (plan.md §649.1). Fixed key set, no add/delete. */
export interface GuestTextTemplate {
  key: string;
  locale: 'en' | 'pt-pt';
  value: string;
  updatedAt: string;
}

/**
 * Grouped for the editor UI. Keys mirror the backend's fixed list
 * (`guestText.ts`) — duplicated rather than shared, same as `FLOWS` above and
 * per §629 decision #8 (no package the two app sides already share code
 * through).
 */
export const GUEST_TEXT_GROUPS = [
  {
    label: 'Online check-in',
    keys: [
      { key: 'CHECKIN_MAIL_SUBJECT', label: 'Email subject' },
      { key: 'CHECKIN_MAIL_TEXT', label: 'Email body' },
      { key: 'CHECKIN_MAIL_BUTTON', label: 'Email button text' },
      { key: 'CHECKIN_PAGE_TEXT', label: 'Page intro' },
      { key: 'CHECKIN_PAGE_SUBMISSION_TEXT', label: 'Page thank-you' },
    ],
  },
  {
    label: 'Post-stay feedback',
    keys: [
      { key: 'QUIZ_MAIL_SUBJECT', label: 'Email subject' },
      { key: 'QUIZ_MAIL_TEXT', label: 'Email body' },
      { key: 'QUIZ_MAIL_BUTTON', label: 'Email button text' },
      { key: 'QUIZ_PAGE_TEXT', label: 'Page intro' },
      { key: 'QUIZ_PAGE_SUBMISSION_TEXT', label: 'Page thank-you' },
    ],
  },
  {
    label: 'Birthday',
    keys: [
      { key: 'BIRTHDAY_MAIL_SUBJECT', label: 'Email subject' },
      { key: 'BIRTHDAY_MAIL_TEXT', label: 'Email body' },
    ],
  },
  {
    label: 'Promotions',
    keys: [
      { key: 'PROMO_MAIL_SUBJECT', label: 'Email subject' },
      { key: 'PROMO_MAIL_TEXT', label: 'Email body' },
    ],
  },
  {
    label: 'Legal declarations (check-in form)',
    keys: [
      { key: 'DATA_PROTECTION_TITLE', label: 'Data protection — title' },
      { key: 'DATA_PROTECTION_TEXT', label: 'Data protection — text' },
      { key: 'PRIVACY_POLICY_TITLE', label: 'Privacy policy — title' },
      { key: 'PRIVACY_POLICY_TEXT', label: 'Privacy policy — text' },
      { key: 'DECLARE_TRUE_DATA', label: 'Declaration of accuracy' },
      { key: 'DECLARE_TERMS_READ', label: 'Terms-read declaration' },
    ],
  },
] as const;
