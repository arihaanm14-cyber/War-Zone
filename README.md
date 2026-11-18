# War Zone: put it online with Render

This folder is a complete website. `server.js` sends the game (`public/index.html`) to players and runs the online parts:
the lobby, matches, chat and invites, passwords, ranked scores, Skin Lab skins and bans. It needs no extra packages.

## 1. Put the files on GitHub (Render deploys from GitHub)

1. Sign in at https://github.com and click **New** (new repository). Name it `war-zone`, keep it Public or Private, click **Create repository**.
2. On the new repository's page click **uploading an existing file**.
3. Open the `war-zone` folder from the zip and drag **everything inside it** (`public` folder, `server.js`, `package.json`, `render.yaml`, `README.md`) into the page.
   Do not drag the `war-zone` folder itself: `server.js` must sit at the top of the repository.
4. Click **Commit changes**.

## 2. Create the service on Render

1. Sign in at https://dashboard.render.com and connect your GitHub account when asked.
2. Click **New +** → **Blueprint**, pick the `war-zone` repository, then **Apply**. Render reads `render.yaml` and sets everything up (free plan).

   Or do it by hand: **New +** → **Web Service** → pick the repository, then set
   Runtime **Node**, Build Command `npm install`, Start Command `node server.js`, Instance Type **Free**,
   and add an environment variable `OWNER_KEY` with any long secret word.
3. Wait for **Live**, then open the address Render shows (like `https://war-zone-xxxx.onrender.com`).

## 3. Make yourself the owner (once)

In Render open your service → **Environment** and copy the `OWNER_KEY` value. Then visit
`https://YOUR-ADDRESS.onrender.com/?owner=YOUR_OWNER_KEY` once in your own browser.
That browser can now reset forgotten passwords (Admin Panel → Passwords). Admin codes inside the game work as before.

## Good to know

- **Free plan sleeps.** After 15 minutes with no players the server sleeps; the next visitor waits about a minute while it wakes.
- **Free plan forgets saved data on restart.** Passwords, Skin Lab skins, bans and ranked scores are kept in `data/db.json`, and
  Render's free disk is wiped whenever the service restarts or redeploys. To keep them, switch the service to a paid instance,
  add a Disk mounted at `/var/data` (see the comment in `render.yaml`) and set the environment variable `DATA_DIR=/var/data`.
- **Player progress** (keys, skins, levels, loadouts) is saved in each player's browser, as before.
- **Updating the game:** replace `public/index.html` on GitHub (open it → pencil/upload) and Render redeploys by itself.
- This is a separate server from the Claude version of the game, so players on one do not see players on the other.
