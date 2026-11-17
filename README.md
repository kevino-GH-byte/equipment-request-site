# Equipment request site

A small Netlify site for off-site shoot equipment requests.

1. The requester fills in the shoot dates, cinematographers, and equipment (searchable list of items and kits from CheqRoom).
2. A Netlify Function checks the request and builds a PDF. The confirmation page lets the requester download it or open it to print. Nothing is emailed.
3. The requester posts the PDF in Slack with their dates. Your equipment manager enters the reservation in CheqRoom from the PDF.

There is no database to run. The equipment list is uploaded on a passcode-protected page in the site itself and stored with the site (Netlify Blobs, built in).

## What's in the box

| Path | What it does |
| --- | --- |
| `public/index.html` | The form (one file, no framework) |
| `netlify/functions/submit.js` | Receives the form, builds the PDF and returns it to the browser |
| `netlify/functions/inventory.js` | Serves the current equipment list to the form |
| `public/admin.html` | The update page (passcode, upload, review changes, publish, go back) |
| `netlify/functions/admin-inventory.js` | Checks the passcode and saves the uploaded list |
| `netlify/lib/inventory-source.js` | Loads the uploaded list, falling back to the bundled sample |
| `netlify/lib/inventory-build.js` | Turns a CheqRoom sheet into items and kits |
| `netlify/lib/pdf.js`, `validate.js` | PDF layout and server-side checks |
| `data/inventory.csv` | **Sample data.** Shown until the first upload. You don't need to replace it. |

## Setup

### 1. Set the update passcode

In Netlify, add the environment variable `ADMIN_PASSCODE` (a long phrase, shared only with the coordinator and equipment manager), then redeploy once. Whoever knows it can update the list, and nobody else can. To change who has access, change the passcode and redeploy. Five wrong guesses lock the page for 15 minutes.

### 2. How columns are read

Columns are matched by header name, ignoring case and spacing: `Name` (or `Item`, `Asset`), `Category`, `Brand`, `Model`, `Code`, `Status`, and `Kit Name` (or `Kit`). Only a name, or a brand and model, is required.

- Identical items (same name, category, brand, and model) are grouped into one line with a unit count. That count is the most a requester can ask for.
- Rows whose status contains retired, lost, archived, stolen, sold, or disposed are skipped.
- CheqRoom sub-categories written as `Lens/Zoom>24-70mm` show as the category "Lens" with "Zoom / 24-70mm" under the item.
- **Kits:** items that share a `Kit Name` become one kit. Kits show first in the list with a Kit label, are searchable by kit name and by what's inside, and can only be requested whole. The PDF lists what each kit contains. CheqRoom's help pages describe kits being assigned through a Kit Name column on import. Check that your export includes that column.

### 3. Deploy

Connect the repo to Netlify (build settings come from `netlify.toml`), or from this folder run:

```
npm install
npx netlify deploy --prod --build
```

Drag-and-drop deploys aren't a good fit because the functions need to be bundled.

### 4. Environment variables

Set these in Netlify under Site configuration, Environment variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `ADMIN_PASSCODE` | Yes | Unlocks the update page. Without it the page refuses all requests. |
| `ALLOWED_EMAIL_DOMAIN` | No | Defaults to `goldenhippo.com` |

## Updating the equipment list (for the coordinator)

1. Export items from CheqRoom (CSV or Excel).
2. Open the request form and click **Update equipment list** in the footer (or go to `/admin.html`).
3. Enter the passcode and choose the file.
4. Review the summary: counts, warnings, and what was added, removed, or changed in quantity.
5. Click **Publish this list**. The form uses it within about 20 seconds.

The upload replaces the whole list, so export every item each time. **Go back to the previous list** undoes the last publish (clicking it twice swaps back). If the file can't be used (wrong columns, empty), nothing changes and the page says why.

No Netlify access or redeploy is needed to update the list.

## Try it locally

```
npm install
npm run build        # builds the bundled list from data/inventory.csv
npm run test:pdf     # writes sample-request.pdf so you can check the layout
npm run dev          # full site with functions (needs the Netlify CLI and a .env file with the variables above)

# Run the functions without Netlify, storing the list in a folder:
LIST_STORE_DIR=./.list-store ADMIN_PASSCODE=test node <your test server>
```

## Things to know

- The upload and passcode flow was tested locally against a file-based store. Saving to Netlify Blobs itself hasn't been run against a real Netlify site, so do one test upload after the first deploy.
- The passcode is a single shared one. It is sent with each request over HTTPS and kept in the browser tab only until it closes.

- Anyone with the form link can submit a request. The main cinematographer's address must be `@goldenhippo.com` and a hidden field catches basic bots, but the form has no login. If that matters, put the site behind Netlify's password protection or your SSO.
- The "in inventory" number is how many units you own, not availability on the requested dates. Your equipment manager still checks availability in CheqRoom.
- Items inside a kit also appear on their own, because CheqRoom allows booking them separately. A request can include both a kit and one of its parts. The equipment manager sorts that out.
- Nothing is emailed or stored. The PDF exists only on the confirmation page, so a requester who closes it without saving has to submit again. Requests aren't logged anywhere.
- The PDF uses a standard font, so characters outside Latin-1 (emoji, non-Latin scripts) print as `?`.
