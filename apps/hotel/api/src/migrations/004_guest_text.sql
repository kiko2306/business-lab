-- Guest-text template store (plan.md §649.1, closing the §629 decision #6
-- README item). The legacy `hu_translations` table held both real guest-facing
-- content (email subjects/bodies, page intro/thank-you text, legal
-- declarations) and a long tail of plain UI field labels (NAME, ADDRESS,
-- COUNTRY, ...). Only the former survives here — the field labels are
-- ordinary guest-app UI chrome, not something a hotel meaningfully
-- customizes the wording of, and belong with whatever static i18n check-in
-- and pulse's own guest UI eventually gets, not in an admin-editable table.
--
-- Two locales, matching the dashboard's own TranslatePipe convention (§626)
-- rather than the legacy's full language table — nothing else in this rebuild
-- goes beyond en/pt-pt.

CREATE TABLE IF NOT EXISTS guest_text_templates (
  key        text NOT NULL,
  locale     text NOT NULL CHECK (locale IN ('en', 'pt-pt')),
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, locale)
);

-- Seeded once, same guard as pulse_questions (002_pulse.sql): placeholder
-- copy an admin overwrites through the editor, translated from the legacy
-- Portuguese-only defaults (`hu_translations`, language_id 131) since no
-- English originals exist to carry over.
INSERT INTO guest_text_templates (key, locale, value)
SELECT * FROM (VALUES
  ('CHECKIN_MAIL_SUBJECT', 'en', 'Online Check-in'),
  ('CHECKIN_MAIL_SUBJECT', 'pt-pt', 'Checkin Online'),
  ('CHECKIN_MAIL_TEXT', 'en', '<p>Hello $guest,<br>For your convenience, please complete your online check-in, filling in the details your reservation needs ahead of time — it simplifies and shortens your wait at reception.</p>'),
  ('CHECKIN_MAIL_TEXT', 'pt-pt', '<p>Olá $guest<br>Para sua comodidade, efetue o pré check-in online, preenchendo antecipadamente os dados que são necessários á sua reserva, simplificando e reduzindo o tempo de espera na receção.</p>'),
  ('CHECKIN_MAIL_BUTTON', 'en', 'Check in online'),
  ('CHECKIN_MAIL_BUTTON', 'pt-pt', 'Checkin Online'),
  ('CHECKIN_PAGE_TEXT', 'en', '<p>Hello $guest</p><p>Please complete your online check-in below.</p>'),
  ('CHECKIN_PAGE_TEXT', 'pt-pt', '<p>Olá $guest</p><p>Preenchimento do check-in online.</p>'),
  ('CHECKIN_PAGE_SUBMISSION_TEXT', 'en', '<p>Thank you for completing your check-in.</p>'),
  ('CHECKIN_PAGE_SUBMISSION_TEXT', 'pt-pt', '<p>Obrigado por ter efetuado o check-in.</p>'),
  ('QUIZ_MAIL_SUBJECT', 'en', 'Guest satisfaction survey'),
  ('QUIZ_MAIL_SUBJECT', 'pt-pt', 'Questionário de satisfação.'),
  ('QUIZ_MAIL_TEXT', 'en', '<p style="text-align:center;">Dear guest ($guest),<br>Your comfort and satisfaction matter to us.<br>We would appreciate a brief opinion in our guest satisfaction survey.</p>'),
  ('QUIZ_MAIL_TEXT', 'pt-pt', '<p style="text-align:center;">Exmo. Hóspede ($guest),<br>A sua comodidade e satisfação é muito importante.<br>Agradecemos-lhe uma breve opinião ao nosso inquérito de satisfação ao cliente.</p>'),
  ('QUIZ_MAIL_BUTTON', 'en', 'Fill in the survey'),
  ('QUIZ_MAIL_BUTTON', 'pt-pt', 'Preencher Questionario'),
  ('QUIZ_PAGE_TEXT', 'en', '<p>Dear $guest. Your comfort and satisfaction matter to us.<br>We would appreciate a brief opinion in our guest satisfaction survey.</p>'),
  ('QUIZ_PAGE_TEXT', 'pt-pt', '<p>Caro $guest. A sua comodidade e satisfação é muito importante.<br>Agradecemos-lhe uma breve opinião ao nosso inquérito de satisfação ao cliente.</p>'),
  ('QUIZ_PAGE_SUBMISSION_TEXT', 'en', '<p style="text-align:center;">Thank you for completing the survey.</p>'),
  ('QUIZ_PAGE_SUBMISSION_TEXT', 'pt-pt', '<p style="text-align:center;">Obrigado por ter respondido ao questionário.</p>'),
  ('BIRTHDAY_MAIL_SUBJECT', 'en', 'Happy birthday!'),
  ('BIRTHDAY_MAIL_SUBJECT', 'pt-pt', 'Parabéns.'),
  ('BIRTHDAY_MAIL_TEXT', 'en', '<p>We hope you have a wonderful birthday.</p>'),
  ('BIRTHDAY_MAIL_TEXT', 'pt-pt', '<p>Esperamos que tenha um ótimo aniversario</p>'),
  ('PROMO_MAIL_SUBJECT', 'en', 'Promotion title'),
  ('PROMO_MAIL_SUBJECT', 'pt-pt', 'Título da promoção.'),
  ('PROMO_MAIL_TEXT', 'en', '<p>Active promotion text.</p><p>Images can be added here.</p>'),
  ('PROMO_MAIL_TEXT', 'pt-pt', '<p>Texto da promoção ativa.</p><p>É possível adicionar imagens.</p>'),
  ('DATA_PROTECTION_TITLE', 'en', 'Data protection'),
  ('DATA_PROTECTION_TITLE', 'pt-pt', 'Protecção de dados'),
  ('DATA_PROTECTION_TEXT', 'en', '<p>Data protection notice text (please fill in).</p>'),
  ('DATA_PROTECTION_TEXT', 'pt-pt', '<p>Texto para Proteção de dados (Importante preencher).</p>'),
  ('PRIVACY_POLICY_TITLE', 'en', 'Privacy policy'),
  ('PRIVACY_POLICY_TITLE', 'pt-pt', 'Política de privacidade.'),
  ('PRIVACY_POLICY_TEXT', 'en', '<p>Privacy policy text (please fill in).</p>'),
  ('PRIVACY_POLICY_TEXT', 'pt-pt', '<p>Texto para Política de privacidade (Importante preencher).</p>'),
  ('DECLARE_TRUE_DATA', 'en', 'I declare that all the information provided above is true.<br>The personal data collected is used to provide this service and handled in accordance with data protection regulations.'),
  ('DECLARE_TRUE_DATA', 'pt-pt', 'Declaro que todas as informações acima mencionadas são verdadeiras.<br>Os dados pessoais recolhidos têm em vista o melhor funcionamento do serviço e em conformidade com o regulamento de Proteção de dados.'),
  ('DECLARE_TERMS_READ', 'en', 'I declare that I have read and accept the:'),
  ('DECLARE_TERMS_READ', 'pt-pt', 'Declaro que li e aceito a:')
) AS seed(key, locale, value)
WHERE NOT EXISTS (SELECT 1 FROM guest_text_templates);
