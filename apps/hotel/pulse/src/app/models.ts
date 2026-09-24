/** Mirrors hotel-core's `toFeedback` response shape (routes/pulse.ts). */
export interface PulseQuestion {
  id: string;
  text: string;
  type: 'rating' | 'text';
  answer: string | null;
}

export interface Feedback {
  unit: string;
  checkinOn: string;
  checkoutOn: string;
  roomName: string | null;
  submitted: boolean;
  questions: PulseQuestion[];
}

export interface PulseAnswer {
  questionId: string;
  // hotel-core's `int()` util only accepts a real JSON number, not a
  // numeric string, for a `rating` question — text stays a string.
  answer: string | number;
}
