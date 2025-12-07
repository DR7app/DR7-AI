-- Simple RLS policy for user_documents
-- This allows specific admin emails to access all documents

-- Enable RLS on user_documents if not already enabled
ALTER TABLE user_documents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Admin users can view all documents" ON user_documents;
DROP POLICY IF EXISTS "Admin users can update all documents" ON user_documents;
DROP POLICY IF EXISTS "Users can view their own documents" ON user_documents;
DROP POLICY IF EXISTS "Users can insert their own documents" ON user_documents;
DROP POLICY IF EXISTS "Service role can do everything" ON user_documents;

-- Policy 1: Allow specific admin email(s) to view all documents
-- REPLACE 'your-admin@email.com' with your actual admin email
CREATE POLICY "Admin users can view all documents"
ON user_documents
FOR SELECT
USING (
  auth.jwt()->>'email' IN ('admin@dr7empire.com', 'ophelie@bonaparks.com')
  OR auth.uid() = user_id
);

-- Policy 2: Allow admin email(s) to update all documents
CREATE POLICY "Admin users can update all documents"
ON user_documents
FOR UPDATE
USING (
  auth.jwt()->>'email' IN ('admin@dr7empire.com', 'ophelie@bonaparks.com')
  OR auth.uid() = user_id
);

-- Policy 3: Regular users can view their own documents
CREATE POLICY "Users can view their own documents"
ON user_documents
FOR SELECT
USING (auth.uid() = user_id);

-- Policy 4: Regular users can insert their own documents
CREATE POLICY "Users can insert their own documents"
ON user_documents
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy 5: Allow service role (for admin panel backend operations)
CREATE POLICY "Service role can do everything"
ON user_documents
USING (auth.jwt()->>'role' = 'service_role');

-- Verify the policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'user_documents';
