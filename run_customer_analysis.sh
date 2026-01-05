#!/bin/bash
# Script to run the customer duplicate identification analysis
# This connects to Supabase and runs the identification script

echo "🔍 Analyzing duplicate customers in customers_extended table..."
echo ""

# Get Supabase connection details from environment
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-}"

if [ -z "$SUPABASE_URL" ]; then
  echo "❌ Error: SUPABASE_URL environment variable not set"
  exit 1
fi

# Extract project reference from URL
PROJECT_REF=$(echo $SUPABASE_URL | sed -E 's/https:\/\/([^.]+).*/\1/')

# Run the identification script using Supabase CLI or direct psql
if command -v supabase &> /dev/null; then
  echo "Using Supabase CLI..."
  supabase db execute --file identify_duplicate_customers.sql --project-ref $PROJECT_REF
else
  echo "❌ Supabase CLI not found. Please install it or run the SQL script manually."
  echo "Script location: identify_duplicate_customers.sql"
  exit 1
fi

echo ""
echo "✅ Analysis complete!"
