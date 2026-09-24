/** Mirrors hotel-core's `toCheckin` response shape (routes/checkin.ts). */
export interface CheckinGuest {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  documentType: number | null;
  documentNumber: string | null;
  documentCountry: string | null;
  nationality: string | null;
  birthDate: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export interface CheckinExtra {
  firstName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  ageGroup: number;
}

export interface Checkin {
  unit: string;
  checkinOn: string;
  checkoutOn: string;
  roomName: string | null;
  occupants: { adults: number; children: number; babies: number };
  submitted: boolean;
  guest: CheckinGuest | null;
  extras: CheckinExtra[];
}

export function emptyGuest(): CheckinGuest {
  return {
    firstName: null, lastName: null, email: null,
    documentType: null, documentNumber: null, documentCountry: null,
    nationality: null, birthDate: null,
    addressLine1: null, postalCode: null, city: null, country: null,
  };
}

export function emptyExtra(): CheckinExtra {
  return { firstName: null, lastName: null, documentNumber: null, ageGroup: 0 };
}

/**
 * ponytail: placeholder codes, not yet confirmed against a real Wintouch
 * install. Nothing downstream reads document_type until the hotel agent's
 * write-back is built (README TODO), which is when the mapping needs to be
 * exact — correcting a select's values later is a one-line change.
 */
export const DOCUMENT_TYPES = [
  { value: 1, label: 'Passport' },
  { value: 2, label: 'National ID card' },
  { value: 3, label: "Driving licence" },
  { value: 0, label: 'Other' },
];

export const AGE_GROUPS = [
  { value: 0, label: 'Adult' },
  { value: 1, label: 'Child' },
  { value: 2, label: 'Baby' },
];
