#!/usr/bin/env bash
set -euo pipefail

echo "Checking every first-party JavaScript file..."
while IFS= read -r -d '' file; do
  node --check "$file"
done < <(find . -type f -name '*.js' -not -path './.git/*' -print0)

echo "Checking every Supabase Edge Function..."
for file in supabase/functions/*/index.ts; do
  [ -f "$file" ] || continue
  deno check --quiet "$file"
done

echo "Source validation passed."
