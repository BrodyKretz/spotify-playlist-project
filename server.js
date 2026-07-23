const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const TOKENS_FILE = path.join(__dirname, ".tokens.json");

// Scopes: read your saved songs + read/create playlists on your account.
const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

function readTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return null;
  return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
}

function writeTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function authHeader() {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  writeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}

async function refreshAccessToken(refresh_token) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const existing = readTokens();
  writeTokens({
    access_token: data.access_token,
    // Spotify may or may not return a new refresh token; keep the old one if not.
    refresh_token: data.refresh_token || existing.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}

// Returns a currently-valid access token, refreshing silently if needed.
// Returns null when the user has never logged in.
async function getValidAccessToken() {
  const tokens = readTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  await refreshAccessToken(tokens.refresh_token);
  return readTokens().access_token;
}

async function spotifyGet(endpoint, token) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify API ${endpoint} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// CSRF state values we've issued for the login flow.
const pendingStates = new Set();

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (url.pathname === "/") {
      return sendFile(res, path.join(__dirname, "public", "index.html"), "text/html");
    }

    if (url.pathname === "/login") {
      if (!CLIENT_ID || !CLIENT_SECRET) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env");
      }
      const state = crypto.randomBytes(16).toString("hex");
      pendingStates.add(state);
      const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
      authorizeUrl.search = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
        state,
      }).toString();
      res.writeHead(302, { Location: authorizeUrl.toString() });
      return res.end();
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!state || !pendingStates.has(state)) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end("Invalid state. Try logging in again.");
      }
      pendingStates.delete(state);
      await exchangeCodeForTokens(code);
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    if (url.pathname === "/logout") {
      if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    if (url.pathname === "/api/me") {
      const token = await getValidAccessToken();
      if (!token) return sendJson(res, 200, { loggedIn: false });
      const me = await spotifyGet("/me", token);
      return sendJson(res, 200, {
        loggedIn: true,
        displayName: me.display_name,
        id: me.id,
        product: me.product,
      });
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Spotify Playlist Project running at http://127.0.0.1:${PORT}\n`);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log("  ⚠  No credentials found. Copy .env.example to .env and fill it in.\n");
  }
});
