-- Create table for Nexi transactions
create table if not exists public.nexi_transactions (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    
    -- Link to local booking (optional, as some transactions might come from external site)
    booking_id uuid references public.bookings(id) on delete set null,
    
    -- Nexi specific fields
    order_id text unique not null,
    transaction_id text, -- Filled when payment is completed
    amount_cents integer not null, -- Amount in cents
    currency text default 'EUR',
    status text not null default 'pending', -- pending, completed, failed, cancelled
    payment_link text,
    
    -- Customer info for reference
    customer_email text,
    description text,
    
    -- Raw data for debugging
    metadata jsonb default '{}'::jsonb
);

-- Enable RLS
alter table public.nexi_transactions enable row level security;

-- Policies
create policy "Admins can view all nexi transactions"
    on public.nexi_transactions for select
    using ( auth.role() = 'authenticated' ); -- Assuming standard auth logic, refine if needed based on admin role check

create policy "Admins can insert nexi transactions"
    on public.nexi_transactions for insert
    with check ( auth.role() = 'authenticated' );

create policy "Admins can update nexi transactions"
    on public.nexi_transactions for update
    using ( auth.role() = 'authenticated' );

-- Create updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger handle_nexi_transactions_updated_at
    before update on public.nexi_transactions
    for each row
    execute procedure public.handle_updated_at();

-- Comment
comment on table public.nexi_transactions is 'Stores payment transactions managed via Nexi XPay';
