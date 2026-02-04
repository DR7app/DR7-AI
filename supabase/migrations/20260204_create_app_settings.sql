-- Create app_settings table for storing application configuration (birthday messages, etc.)
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read app_settings"
    ON app_settings FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to insert
CREATE POLICY "Authenticated users can insert app_settings"
    ON app_settings FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update app_settings"
    ON app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Allow anon users to read (for public settings if needed)
CREATE POLICY "Anon can read app_settings"
    ON app_settings FOR SELECT TO anon USING (true);

-- Allow anon users to insert and update (since frontend uses anon key)
CREATE POLICY "Anon can insert app_settings"
    ON app_settings FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can update app_settings"
    ON app_settings FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role full access to app_settings"
    ON app_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
