-- The organisation's old logo and colour (0017), replaced by its branding (0021: organization_branding). Nothing
-- reads them since 0021's release (2026-11-27), and 0021 copied them over, so they go.
-- Their column privileges for pulse_app go with them.
-- Reverse: migrations/down/0022_drop_profile_logo.down.sql (puts them back, filled from the branding).
ALTER TABLE organizations DROP COLUMN logo, DROP COLUMN colour;
