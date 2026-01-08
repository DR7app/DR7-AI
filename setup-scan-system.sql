-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- Create scan_jobs table
create table if not exists scan_jobs (
    id uuid primary key default uuid_generate_v4(),
    created_at timestamptz default now(),
    status text default 'pending', -- pending, completed, expired
    created_by uuid references auth.users(id)
);

-- Create document_uploads table
create table if not exists document_uploads (
    id uuid primary key default uuid_generate_v4(),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    file_path text not null,
    original_filename text,
    mime_type text,
    size_bytes bigint,
    scan_job_id uuid references scan_jobs(id),
    status text default 'processing', -- processing, ready, error, confirmed
    extracted_data jsonb, -- OCR results
    customer_id uuid references customers_extended(id), -- Linked customer
    metadata jsonb -- Extra info like device source, confidence scores
);

-- Enable RLS
alter table scan_jobs enable row level security;
alter table document_uploads enable row level security;

-- Policies for scan_jobs
create policy "Enable read access for authenticated users"
on scan_jobs for select
to authenticated
using (true);

create policy "Enable insert for authenticated users"
on scan_jobs for insert
to authenticated
with check (true);

-- Policies for document_uploads
create policy "Enable read access for authenticated users"
on document_uploads for select
to authenticated
using (true);

create policy "Enable insert for authenticated users"
on document_uploads for insert
to authenticated
with check (true);

create policy "Enable update for authenticated users"
on document_uploads for update
to authenticated
using (true);

-- Storage bucket setup
-- Note: You might need to create the bucket manually in the dashboard if SQL creation isn't supported for your instance, 
-- but we'll try to insert into storage.buckets if possible, or assume it exists/will be created.
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

-- Storage policies
create policy "Authenticated users can upload scans"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'scans' );

create policy "Authenticated users can read scans"
on storage.objects for select
to authenticated
using ( bucket_id = 'scans' );

create policy "Authenticated users can update scans"
on storage.objects for update
to authenticated
using ( bucket_id = 'scans' );
