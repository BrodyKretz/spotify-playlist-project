# Spotify Playlist Project

A local web app to organize your Spotify liked songs into smarter playlists.

## One-time setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in with your personal Spotify account.
2. Click **Create app**. Name it anything (e.g. "Playlist Project"). For the **Redirect URI**, enter exactly:

   ```
   http://127.0.0.1:3000/callback
   ```

   > Spotify no longer allows `localhost` in redirect URIs — it must be the loopback IP `127.0.0.1`.

3. In the app's settings, copy the **Client ID** and **Client Secret**.
4. Open the `.env` file in this folder and paste them in:

   ```
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

## Running it

```bash
npm start
```

Then open **http://127.0.0.1:3000** and click **Log in with Spotify**.

After the first login, your session persists — every time you start the server and open the page, it logs you back into your personal account automatically. (Click **Log out** to switch accounts.)

## Notes

- Requires Node 18+ (uses built-in `fetch`). No npm dependencies.
- `.env` and `.tokens.json` hold your credentials and login session. They are gitignored and never committed — safe to make this repo public.
