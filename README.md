# Dobbs Labeling Interface

Static stance-labeling app for the 950-row `sub1000_new_tjst_fit_bert_workflow` Dobbs exemplar batch.

## Files

- `index.html`, `styles.css`, `app.js`, `config.js`: browser app.
- `data/items.json`: static annotation items generated from the CSV.
- `scripts/stratify_item_order.py`: deterministic ordering script for partial-completion coverage.
- `supabase/001_labeling_schema.sql`: Supabase tables and RPC functions.

## Access Codes

Only hashed versions of the access codes are stored in Supabase. Keep plaintext
codes out of GitHub and share them with annotators through a private channel.

## Save Model

- Each field change is saved to Supabase through `dobbs_save_label`.
- A browser-local backup is also written after each field change.
- `Export My CSV` downloads the current annotator's locally cached labels.
- `Export All CSV` is visible only to the admin code and downloads all saved labels from Supabase.

## Labeling Task

Annotators should label only the human-perceived stance of the tweet:

- `human_stance`
- `human_stance_confidence`
- `stance_evidence_span`
- `exclude_from_bert` when a row should not be used downstream
- optional notes/reason fields

The RA-facing UI intentionally does not show TJST priors, topic labels, model predictions, or narrative-detection fields.

Rows are displayed in a deterministic stratified order. The ordering rotates across weeks first, then hidden prior/topic groups inside each week, so partial completion covers the project timeline and hidden strata more evenly. These balancing fields are not shown to annotators.

## Deployment

This folder is plain static HTML/CSS/JS. It can be hosted on GitHub Pages, Netlify, Cloudflare Pages, or Codex Sites. No server-side secret is included in the frontend; `config.js` uses the Supabase publishable key.
