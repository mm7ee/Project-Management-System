-- Set when an administrator resets a password: the user must choose a new one at next sign-in.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
