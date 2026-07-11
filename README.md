# Contract Generator

An open-source AI contract generator: draft-ready agreements in minutes instead of days of back-and-forth.

**Live:** [cosmik-contract-generator.netlify.app](https://cosmik-contract-generator.netlify.app)

**Not legal advice:** drafts are AI-generated from the fields you provide and are not reviewed by a lawyer. Have a qualified professional review any draft before you send or sign it.

## The headache

Founders without an HR team draft joining letters and exit agreements by copy-pasting old templates and hoping the numbers, dates, and clauses still line up. Every rewrite risks a stale clause carried over from an unrelated hire, or a missing one nobody notices until it matters.

## The machinery

1. Visitor fills in only the fields that apply for a Joining Letter or Exit Agreement, no fixed form, fields are grouped into sections (Core details, Compensation, Separation, and so on) that vary by contract type.
2. `generate-contract-background.js` validates `jobId`, checks the daily and per-IP rate limits, then makes one Claude call with a type-specific system prompt instructing it to only include clauses for fields actually provided, never invent details, and never use em dashes.
3. If a jurisdiction is given, the system prompt grounds statutory references (gratuity, provident fund, notice period, TDS) in that jurisdiction's norms; without one, it keeps the language generic and flags where local law should be confirmed.
4. Netlify auto-responds 202 for `-background` suffixed functions, so the client polls `check-contract.js` every 2 seconds until the Blob reports `done` or `error`. The job's Blob is deleted once read, results aren't kept around after the client has them.
5. The frontend renders the draft and can export it to a watermarked PDF (`jsPDF`, loaded with an SRI hash), with the not-legal-advice disclaimer repeated in the PDF footer on every page.

### Guardrails

- **Daily + per-IP rate limits**: a Blob-backed counter caps generations per day and per IP.
- **`jobId` validated**: only `^[a-zA-Z0-9-]{1,64}$` is accepted before it's used as a Blobs storage key.
- **At least one field required**: an empty submission returns a clean error instead of an empty draft.

## Environment variables (all three required)

| Variable | What it is |
|---|---|
| `ANTHROPIC_API_KEY` | Per-project Anthropic API key |
| `NETLIFY_SITE_ID` | This site's ID, from Project details |
| `NETLIFY_BLOBS_TOKEN` | Netlify Personal Access Token |

Optional overrides: `DAILY_CAP` (default 20), `DAILY_CAP_PER_IP` (default 6).

## Run it locally

1. Clone this repo.
2. `npm install`
3. `netlify dev` (with the three env vars set in a `.env` file or the Netlify CLI)

## Smoke test

`npm test` (or `node scripts/smoke-test.mjs`) drafts a real joining letter against the live site and checks the result actually contains the provided name, has real substance, contains no em dash (the system prompt's house-style rule, checked mechanically rather than just asked for), and isn't wrapped in markdown fences or HTML. It also checks that submitting with no fields returns a clean error rather than an empty draft.

Part of the [cosmik.work](https://cosmik.work) Business OS suite. Netlify Functions + Blobs for background processing.

Built by [Soumik Chatterjee](https://cosmik.work).
