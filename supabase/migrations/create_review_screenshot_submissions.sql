-- Review screenshot submissions from customers
CREATE TABLE IF NOT EXISTS review_screenshot_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  candidate_id UUID,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  screenshot_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  discount_code_noleggio TEXT,
  discount_code_lavaggio TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_screenshots_status ON review_screenshot_submissions(status);
CREATE INDEX IF NOT EXISTS idx_review_screenshots_created ON review_screenshot_submissions(created_at DESC);

-- Allow public inserts (customers upload without auth)
ALTER TABLE review_screenshot_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert screenshots" ON review_screenshot_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can view all" ON review_screenshot_submissions FOR SELECT USING (true);
CREATE POLICY "Admins can update" ON review_screenshot_submissions FOR UPDATE USING (true);
