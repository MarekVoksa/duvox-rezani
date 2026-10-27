# Putting Duvox Řezání on Cloudflare (free plan)

What you end up with: the app on its own address (e.g. `duvox-rezani.<you>.workers.dev`), with a sign-in gate in front of it. Only the email addresses you allow can open it; each person signs in with a one-time code sent to their email. Data lives in a small Cloudflare database. Every push to GitHub redeploys the app on its own. (The repo also still works as a Cloudflare Pages project via `functions/`, but the Worker is the main way.)

Takes about 20 minutes. Names in **bold** are what you click.

## 1. Account
Sign up at https://dash.cloudflare.com/sign-up (free).

## 2. The app (a Worker)
1. **Workers & Pages → Create → Import a repository**, pick **MarekVoksa/duvox-rezani**.
2. Project name: `duvox-rezani` (must match `name` in `wrangler.jsonc`). Leave the build command empty and the deploy command as `npx wrangler deploy`; the repo's `wrangler.jsonc` does the rest (it builds the app and serves it).
3. Its address is shown on the Worker's page, e.g. `duvox-rezani.<your-subdomain>.workers.dev`.

If a build fails right away with "error occurred while fetching repository", Cloudflare lost access to the GitHub repo: in the Worker's **Settings → Build**, disconnect the repository and connect it again (branch `main`, deploy command `npx wrangler deploy`; a build command of `npm run build` is fine too), then retry the build.

Until steps 3 to 5 are done the app shows "Server ještě není dokončený"; that is expected.

## 3. Database
1. **Storage & Databases → D1 SQL Database → Create**, name `duvox-rezani`.
2. Copy its **Database ID** (a long code like `1a2b3c4d-…`).

You don't bind it in the dashboard: the binding lives in `wrangler.jsonc`, so it survives every redeploy.

## 4. The sign-in gate (Cloudflare Access)
1. In the dashboard sidebar open **Zero Trust**. The first time, pick a team name (e.g. `duvox`; your sign-in page becomes `duvox.cloudflareaccess.com`) and the **Free** plan. Cloudflare may ask for a payment card even for the free plan; nothing is charged for up to 50 users.
2. **Access → Applications → Add an application → Self-hosted**.
3. Application name: `Duvox Řezání`. Public hostname: the Worker's address from step 2.3.
4. Sign-in method: **One-time PIN** (the default is fine).
5. Add a policy: name `Duvox`, action **Allow**, rule **Include → Emails ending in** `@duvox.cz` (or **Emails** and list people one by one). Save.
6. Open the application again and copy its **Application Audience (AUD) Tag**.
7. Optional: on the Worker, **Settings → Domains & Routes → Preview URLs → Disable**, so only the gated address exists.

## 5. Put the three values into the app
`wrangler.jsonc` needs the database ID (3.2), the team domain (`duvox.cloudflareaccess.com`) and the AUD tag (4.6). None of them is secret. Send them to Claude, or edit the file on GitHub yourself; every push redeploys the app within a minute or two.

The app checks every request itself as well, so the data stays private even if the gate were switched off by mistake.

## 6. Move the data over
1. On a computer, open the current app on claude.ai → **Katalog → Data → Stáhnout zálohu**.
2. Open the Worker's address, sign in with your email code.
3. **Katalog → Data → Nahrát zálohu**, pick the downloaded file.
4. From then on use only the new address, so the two copies don't drift apart.

On phones: open the address in Chrome (Android) or Safari (iPhone) and choose **Add to Home screen**; it then opens like an app.

## Later: own address
Once duvox.cz is on Cloudflare: Worker → **Settings → Domains & Routes → Add → Custom domain** → `rezani.duvox.cz`, then add that hostname to the Access application too.

## Local development
```sh
./build.sh
npx wrangler dev --local --var ALLOW_ANON:1   # http://localhost:8787, no sign-in
node tests/servertest.js http://localhost:8787/   # two browsers + backup against it
```
