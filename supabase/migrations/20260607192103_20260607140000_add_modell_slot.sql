ALTER TABLE portal_html DROP CONSTRAINT IF EXISTS portal_html_slot_check;

ALTER TABLE portal_html
  ADD CONSTRAINT portal_html_slot_check
  CHECK (slot IN ('analyse', 'crm', 'modell'));
