-- Reverses 0022_drop_profile_logo.sql: the old logo and colour columns come back (as 0017 made them), filled from
-- each organisation's branding, so 0021's and 0017's reverses still run after this one.
ALTER TABLE organizations
  ADD COLUMN logo   TEXT CHECK (logo IS NULL OR (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' AND length(logo) <= 200000)),
  ADD COLUMN colour TEXT CHECK (colour IS NULL OR colour ~ '^#[0-9a-f]{6}$');
GRANT UPDATE (logo, colour) ON organizations TO pulse_app;
UPDATE organizations o
SET logo = CASE WHEN length(b.logo) <= 200000 THEN b.logo END,
    colour = NULLIF(b.accent, '#3e5c76')
FROM organization_branding b
WHERE b.organization_id = o.id;
