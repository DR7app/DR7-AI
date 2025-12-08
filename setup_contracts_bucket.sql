-- Create the storage bucket for contracts
insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', true)
on conflict (id) do nothing;

-- Set up security policies for the contracts bucket

-- Policy to allow authenticated users to upload files
create policy "Authenticated users can upload contracts"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'contracts' );

-- Policy to allow authenticated users to update their own files (optional)
create policy "Authenticated users can update contracts"
on storage.objects for update
to authenticated
using ( bucket_id = 'contracts' );

-- Policy to allow public access to view contracts (since we use getPublicUrl)
-- Alternatively, restrict to authenticated users if using createSignedUrl
create policy "Public can view contracts"
on storage.objects for select
to public
using ( bucket_id = 'contracts' );
