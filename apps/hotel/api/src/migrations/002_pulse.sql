-- pulse's schema: the shared, deployment-wide feedback questionnaire
-- (plan.md §644). Legacy Wintouch had several selectable quizzes with
-- per-unit selection and grouped section headers; units.quiz_is_active
-- (001_init.sql) already simplified that down to one on/off switch per unit,
-- so the questions themselves are one flat, ordered list shared by every
-- unit too — there is nothing left to select between.

CREATE TABLE IF NOT EXISTS pulse_questions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text       text NOT NULL,
  -- 'rating': a 1-5 star scale (legacy QuizQuestionTypeKeyEnum::VALUE).
  -- 'text': a free-form guest comment (::TEXT).
  type       text NOT NULL CHECK (type IN ('rating', 'text')),
  -- Soft-disable rather than delete: pulse_responses references a question,
  -- and deleting one would either cascade away history or need an
  -- ON DELETE SET NULL nothing else uses. No admin editor exists yet to ever
  -- set this false (a separate README item) — it only matters once one does.
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seeded once: the guest form needs *something* to ask before an admin
-- editor exists to write these rows instead. Guarded on an empty table so a
-- re-run (every boot, per migrate.ts) doesn't duplicate them.
INSERT INTO pulse_questions (text, type, sort_order)
SELECT * FROM (VALUES
  ('How would you rate your overall stay?', 'rating', 1),
  ('How would you rate the cleanliness of your room?', 'rating', 2),
  ('How would you rate the helpfulness of our staff?', 'rating', 3),
  ('Any comments or suggestions for improvement?', 'text', 4)
) AS seed(text, type, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM pulse_questions);

CREATE TABLE IF NOT EXISTS pulse_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  question_id    uuid NOT NULL REFERENCES pulse_questions(id) ON DELETE CASCADE,
  answer         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, question_id)
);

CREATE INDEX IF NOT EXISTS pulse_responses_reservation_idx
  ON pulse_responses (reservation_id);
