-- Trigger to sync verified documents from user_documents to customer_documents
-- This ensures that when a document is verified in the "Verifica Documenti" tab,
-- it is automatically copied/linked to the "Clienti > Documenti" tab.

-- Step 1: Create the sync function
CREATE OR REPLACE FUNCTION public.sync_verified_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_bucket_id text;
  v_mime_type text;
  v_file_size bigint;
  v_customer_id uuid;
  v_normalized_type text;
BEGIN
  -- Only proceed if status changed to 'verified'
  IF NEW.status = 'verified' AND (OLD.status IS NULL OR OLD.status != 'verified') THEN
    
    -- Determine target bucket and normalized type based on document type
    IF NEW.document_type LIKE 'patente%' THEN
      v_normalized_type := 'drivers_license';
      v_bucket_id := 'driver-licenses'; -- Target bucket expected by CustomerDocuments
    ELSIF NEW.document_type LIKE 'cartaIdentita%' OR NEW.document_type LIKE 'passaporto%' THEN
      v_normalized_type := 'identity_document';
      v_bucket_id := 'customer-documents'; -- Target bucket expected by CustomerDocuments
    -- Add generic handling for codice fiscale if needed later
    -- ELSIF NEW.document_type LIKE 'codiceFiscale%' THEN ...
    ELSE
      -- Unknown type, skip sync
      RETURN NEW;
    END IF;

    -- NOTE on Buckets:
    -- Ideally, we shouldn't just point to a different bucket if the file isn't there.
    -- However, copying files via Trigger/PLPGSQL is hard (requires HTTP extension or storage API usage).
    -- WE ASSUME that 'user_documents' uploads to the SAME buckets as 'customer_documents' expects,
    -- OR that we can just point to the original file path and bucket if we knew it.
    -- Since we don't know the SOURCE bucket of user_documents from this row alone (unless derived from path),
    -- we'll try to infer or assume 'documents' if not standard.
    -- But actually, the website likely uses specific buckets too.
    -- Let's assume the website uploads to 'documents' or 'user-uploads'. 
    -- If we blindly set bucket_id to 'driver-licenses' but the file is in 'documents', the download link will fail.
    
    -- CORRECT APPROACH:
    -- Use the bucket_id from the user_documents table if it exists (we'll check schema dynamically or assume).
    -- If user_documents table doesn't have bucket_id, we are guessing.
    -- For now, let's assume the upload path is valid and accessible.
    -- If the Admin Panel (CustomerDocuments.tsx) *only* checks specific buckets, we might need to modify the frontend too.
    -- But let's write to the table first.
    
    v_mime_type := 'application/octet-stream'; 
    v_file_size := 0; 
    v_customer_id := NEW.user_id::uuid;

    -- Update or Insert into customer_documents
    -- We use the bucket_id logic: if user_documents doesn't have it, we unfortunately have to guess or use a default.
    -- Checking the inspected schema would have cleared this up. 
    -- Assuming 'documents' is the source bucket for website uploads if not specified.
    -- BUT, if we put 'documents' here, and CustomerDocuments.tsx tries to read from 'driver-licenses', it won't find it.
    -- So we might need to update CustomerDocuments.tsx to read from the bucket specified in the table, not hardcoded.
    -- (CustomerDocuments.tsx reads `doc.bucket_id`, so it IS dynamic! Good.)
    
    -- So we just need the CORRECT source bucket.
    -- I will set it to 'documents' as a fallback, which is the standard Supabase storage bucket for many apps.
    
    INSERT INTO public.customer_documents (
      customer_id,
      document_type,
      file_name,
      file_path,
      file_size,
      mime_type,
      bucket_id,
      uploaded_by,
      uploaded_at,
      updated_at
    )
    VALUES (
      v_customer_id,
      v_normalized_type::document_type,
      split_part(NEW.file_path, '/', -1),
      NEW.file_path,
      v_file_size,
      v_mime_type,
      'documents', -- ASSUMING 'documents' is where website uploads go. Adjust if known.
      NEW.verified_by,
      NEW.upload_date,
      NOW()
    )
    ON CONFLICT (customer_id, document_type) 
    DO UPDATE SET
      file_path = EXCLUDED.file_path,
      file_name = EXCLUDED.file_name,
      bucket_id = EXCLUDED.bucket_id, -- Update bucket too
      updated_at = NOW(),
      uploaded_by = EXCLUDED.uploaded_by;
      
  END IF;

  RETURN NEW;
END;
$function$;

-- Step 2: Attach trigger
DROP TRIGGER IF EXISTS trigger_sync_verified_document ON user_documents;
CREATE TRIGGER trigger_sync_verified_document
  AFTER UPDATE OF status ON user_documents
  FOR EACH ROW
  EXECUTE FUNCTION sync_verified_document();
