#!/bin/bash

# Script to replace hardcoded dark mode colors with theme variables
# This script is safe and non-destructive - it only changes color classes

cd /Users/opheliegiraud/antigravity-dr7/DR7-empire-admin/src

# Function to update a file
update_file() {
  local file="$1"
  
  # Replace background colors
  sed -i '' 's/bg-black/bg-theme-bg-primary/g' "$file"
  sed -i '' 's/bg-gray-900/bg-theme-bg-secondary/g' "$file"
  sed -i '' 's/bg-gray-800/bg-theme-bg-tertiary/g' "$file"
  
  # Replace text colors
  sed -i '' 's/text-white/text-theme-text-primary/g' "$file"
  sed -i '' 's/text-gray-300/text-theme-text-secondary/g' "$file"
  sed -i '' 's/text-gray-400/text-theme-text-muted/g' "$file"
  
  # Replace border colors
  sed -i '' 's/border-gray-700/border-theme-border/g' "$file"
  sed -i '' 's/border-gray-600/border-theme-border-light/g' "$file"
  
  # Replace hover states
  sed -i '' 's/hover:bg-gray-800/hover:bg-theme-bg-hover/g' "$file"
  sed -i '' 's/hover:bg-gray-700/hover:bg-theme-bg-hover/g' "$file"
  sed -i '' 's/hover:text-white/hover:text-theme-text-primary/g' "$file"
  
  # Replace focus states
  sed -i '' 's/focus:border-white/focus:border-dr7-gold/g' "$file"
  
  echo "Updated: $file"
}

# Update all component files
find pages/admin/components -name "*.tsx" -type f | while read file; do
  update_file "$file"
done

# Update shared components
find components -name "*.tsx" -type f | while read file; do
  update_file "$file"
done

echo "All component files updated with theme variables!"
