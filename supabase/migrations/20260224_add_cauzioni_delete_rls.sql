-- Add DELETE policy for authenticated users on cauzioni table
-- The original migration only added SELECT, INSERT, UPDATE policies
-- Without this, deleting cauzioni during vehicle cleanup fails silently

CREATE POLICY "Authenticated users can delete cauzioni"
    ON cauzioni FOR DELETE
    TO authenticated
    USING (true);
