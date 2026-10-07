import { get, put } from "@vercel/blob";

// One encrypted document per Sonos system. The key is a hash of the household
// ID and the body is AES-GCM ciphertext made by the app, so this service never
// learns which system it is or what the floorplan looks like. Only someone who
// can read the household ID from the speakers (i.e. is on that network) can
// find or decrypt it.

const KEY = /^[0-9a-f]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024;

const blobPath = (key: string) => `plans/${key}.bin`;

function keyOf(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  return KEY.test(key) ? key : null;
}

export async function GET(req: Request) {
  const key = keyOf(req);
  if (!key) return new Response("bad key", { status: 400 });
  const r = await get(blobPath(key), {
    access: "private",
    useCache: false,
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
  });
  if (!r) return new Response(null, { status: 404 });
  const headers = { etag: r.blob.etag, "cache-control": "no-store" };
  if (r.statusCode === 304) return new Response(null, { status: 304, headers });
  return new Response(r.stream, { headers: { ...headers, "content-type": "application/octet-stream" } });
}

export async function PUT(req: Request) {
  const key = keyOf(req);
  if (!key) return new Response("bad key", { status: 400 });
  const body = await req.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) return new Response("too large", { status: 413 });
  const r = await put(blobPath(key), Buffer.from(body), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/octet-stream",
  });
  return Response.json({ etag: r.etag });
}
