-- Password reset by text message (SMS through Twilio), 2026-11-25.
-- A texted code is a password_resets row too: channel 'sms', outcome 'texted', the code kept only as a keyed
-- hash (HMAC with MFA_KEY). A right code turns the row into an ordinary single-use reset token.

-- How the reset was asked for: 'email' (a link) or 'sms' (a code).
ALTER TABLE password_resets ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
-- The texted code's HMAC, until it's used or replaced.
ALTER TABLE password_resets ADD COLUMN code_hash TEXT;
-- Wrong guesses at that code (it stops working at 5).
ALTER TABLE password_resets ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
