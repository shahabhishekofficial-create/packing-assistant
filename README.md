# Packing Assistant V2

Connected to Supabase.

## Current features
- Dynamic Excel/CSV import
- Required headers detected by name
- Duplicate outlet + item code validation
- Creates a live order in Supabase
- Shareable order URL
- Multi-phone shared state
- Atomic outlet locking
- PACKED / PARTIAL / MISSING
- Required = Packed + Missing validation
- Automatic outlet completion
- Automatic whole-order completion
- Audit events
- Device ID persisted in browser
- 3-second live synchronization
- Browser speech with separate voice_text support

## Deploy
Upload all files to the GitHub repository used for GitHub Pages.

## Important
The Supabase publishable key is safe to place in browser code. Never put the database password or Supabase secret/service-role key in this repository.
