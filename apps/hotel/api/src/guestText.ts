/**
 * The fixed set of guest-text template keys (plan.md §649.1) — rows are
 * seeded by 004_guest_text.sql and never added to or removed from by the
 * admin UI, only edited, so this list is what both the route and the seed
 * validate against rather than a value read out of the table itself.
 */
export const GUEST_TEXT_KEYS = [
  'CHECKIN_MAIL_SUBJECT',
  'CHECKIN_MAIL_TEXT',
  'CHECKIN_MAIL_BUTTON',
  'CHECKIN_PAGE_TEXT',
  'CHECKIN_PAGE_SUBMISSION_TEXT',
  'QUIZ_MAIL_SUBJECT',
  'QUIZ_MAIL_TEXT',
  'QUIZ_MAIL_BUTTON',
  'QUIZ_PAGE_TEXT',
  'QUIZ_PAGE_SUBMISSION_TEXT',
  'BIRTHDAY_MAIL_SUBJECT',
  'BIRTHDAY_MAIL_TEXT',
  'PROMO_MAIL_SUBJECT',
  'PROMO_MAIL_TEXT',
  'DATA_PROTECTION_TITLE',
  'DATA_PROTECTION_TEXT',
  'PRIVACY_POLICY_TITLE',
  'PRIVACY_POLICY_TEXT',
  'DECLARE_TRUE_DATA',
  'DECLARE_TERMS_READ',
] as const;

export type GuestTextKey = (typeof GUEST_TEXT_KEYS)[number];

export const GUEST_TEXT_LOCALES = ['en', 'pt-pt'] as const;

export type GuestTextLocale = (typeof GUEST_TEXT_LOCALES)[number];
