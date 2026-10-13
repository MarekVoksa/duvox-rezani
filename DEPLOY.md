# Putting Duvox Řezání on Cloudflare (free plan)

What you end up with: the app on its own address (e.g. `duvox-rezani.pages.dev`), with a sign-in gate in front of it. Only the email addresses you allow can open it; each person signs in with a one-time code sent to their email. Data lives in a small Cloudflare database. Every push to GitHub redeploys the app on its own.

Takes about 20 minutes. Names in **bold** are what you click.

## 1. Account
Sign up at https://dash.cloudflare.com/sign-up (free).

## 2. Database
1. **Storage & Databases → D1 SQL Database → Create**.
2. Name: `duvox-rezani`, location: Europe (or automatic). **Create**.

Nothing else to do here; the app creates its table itself.

## 3. The app
1. **Workers & Pages → Create → Pages → Import an existing Git repository**.
2. Connect GitHub if asked, pick **MarekVoksa/duvox-rezani**, **Begin setup**.
3. Project name: `duvox-rezani` (this becomes `duvox-rezani.pages.dev`).
4. Framework preset: **None**. Build command: `sh build.sh`. Build output directory: `dist`.
5. **Save and Deploy**. When it finishes, opening the address shows "Server ještě není dokončený". That is expected: steps 4 and 5 finish it.
6. In the project: **Settings → Bindings → Add → D1 database**. Variable name: `DB`, database: `duvox-rezani`. **Save**.

## 4. The sign-in gate (Cloudflare Access)
1. In the dashboard sidebar open **Zero Trust**. The first time, pick a team name (e.g. `duvox`; your sign-in page becomes `duvox.cloudflareaccess.com`) and the **Free** plan. Cloudflare may ask for a payment card even for the free plan; nothing is charged for up to 50 users.
2. **Access → Applications → Add an application → Self-hosted**.
3. Application name: `Duvox Řezání`. Add two public hostnames:
   - `duvox-rezani.pages.dev`
   - `*.duvox-rezani.pages.dev` (the preview copies of each version)
4. Sign-in method: **One-time PIN** (the default is fine).
5. Add a policy: name `Duvox`, action **Allow**, rule **Include → Emails ending in** `@duvox.cz` (or **Emails** and list people one by one). Save the application.
6. Open the application again and copy its **Application Audience (AUD) Tag** (in Overview / Basic information).

## 5. Tell the app about the gate
The app checks every request itself as well, so the data stays private even if the gate were switched off by mistake.

1. Pages project → **Settings → Variables and Secrets → Add** (for **Production**):
   - `TEAM_DOMAIN` = `duvox.cloudflareaccess.com` (your team name from step 4.1)
   - `POLICY_AUD` = the AUD tag from step 4.6
2. **Deployments** → on the latest one **⋯ → Retry deployment** (variables apply to new deployments only).

## 6. Move the data over
1. On a computer, open the current app on claude.ai → **Katalog → Data → Stáhnout zálohu**.
2. Open `https://duvox-rezani.pages.dev`, sign in with your email code.
3. **Katalog → Data → Nahrát zálohu**, pick the downloaded file.
4. From then on use only the new address, so the two copies don't drift apart.

On phones: open the address in Chrome (Android) or Safari (iPhone) and choose **Add to Home screen**; it then opens like an app.

## Later: own address
Once duvox.cz is on Cloudflare: Pages project → **Custom domains → Set up a domain** → `rezani.duvox.cz`, then add that hostname to the Access application too.

## Local development
```sh
./build.sh
npx wrangler pages dev dist --d1 DB --binding ALLOW_ANON=1   # http://localhost:8788, no sign-in
node tests/servertest.js                                      # two browsers + backup against it
```
