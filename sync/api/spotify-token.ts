// Spotify catalogue access for the app without a login: a client-credentials
// token, made here so the client secret never ships inside the app. The token
// can only read Spotify's public catalogue (search, albums, artists), not
// anyone's account.

let cached: { token: string; expires: number } | null = null;

export async function GET() {
  if (!cached || Date.now() > cached.expires - 60_000) {
    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) return new Response("not configured", { status: 503 });
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!r.ok) return new Response(`spotify: HTTP ${r.status}`, { status: 502 });
    const v = (await r.json()) as { access_token: string; expires_in: number };
    cached = { token: v.access_token, expires: Date.now() + v.expires_in * 1000 };
  }
  return Response.json(
    { access_token: cached.token, expires_in: Math.floor((cached.expires - Date.now()) / 1000) },
    { headers: { "cache-control": "no-store" } },
  );
}
