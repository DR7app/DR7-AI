-- Fix RLS policies for admin to access user_documents table
-- This allows admin users to view and manage all user documents

-- Enable RLS on user_documents if not already enabled
ALTER TABLE user_documents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Admin users can view all documents" ON user_documents;
DROP POLICY IF EXISTS "Admin users can update all documents" ON user_documents;
DROP POLICY IF EXISTS "Users can view their own documents" ON user_documents;
DROP POLICY IF EXISTS "Users can insert their own documents" ON user_documents;

-- Policy 1: Admin users can SELECT (view) all documents
CREATE POLICY "Admin users can view all documents"
ON user_documents
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- Policy 2: Admin users can UPDATE (approve/reject) all documents
CREATE POLICY "Admin users can update all documents"
ON user_documents
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
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

-- Verify the policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'user_documents';
