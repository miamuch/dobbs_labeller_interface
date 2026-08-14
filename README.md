# Dobbs Labeling Interface

Static labeling app for the 950-row `sub1000_new_tjst_fit_bert_workflow` Dobbs exemplar batch.

## Files

- `index.html`, `styles.css`, `app.js`, `config.js`: browser app.
- `data/items.json`: static annotation items generated from the CSV.
- `supabase/001_labeling_schema.sql`: Supabase tables and RPC functions.

## Access Codes

Only hashed versions of the access codes are stored in Supabase. Keep plaintext
codes out of GitHub and share them with annotators through a private channel.

## Save Model

- Each field change is saved to Supabase through `dobbs_save_label`.
- A browser-local backup is also written after each field change.
- `Export My CSV` downloads the current annotator's locally cached labels.
- `Export All CSV` is visible only to the admin code and downloads all saved labels from Supabase.

## Deployment

This folder is plain static HTML/CSS/JS. It can be hosted on GitHub Pages, Netlify, Cloudflare Pages, or Codex Sites. No server-side secret is included in the frontend; `config.js` uses the Supabase publishable key.
