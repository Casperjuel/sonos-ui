import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

// Song votes and "added by" for one Sonos system. Unlike the floorplan, many
// people write at once, so the server applies each change with a conditional
// write and retries on conflicts.
//
// The server sees only hashes and ±1: track and device ids are hashed with the
// household ID by the app, and songs and people (Spotify name + avatar) are
// AES-GCM ciphertext.
//
// { tracks: { <trackId>: { meta, at, votes: { <deviceId>: 1 | -1 }, added?: { by: <deviceId>, at } } },
//   people: { <deviceId>: <person> } }

type Track = { meta: string; at: number; votes: Record<string, 1 | -1>; added?: { by: string; at: number } };
type Doc = { tracks: Record<string, Track>; people: Record<string, string> };
type Ref = { track: string; meta: string };
type Change = { device: string; person?: string | null; added?: Ref[]; vote?: Ref & { vote: -1 | 0 | 1 } };

const KEY = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{32}$/;
const MAX_TRACKS = 500;
const blobPath = (key: string) => `votes/${key}.json`;
/** reads can return a weak ETag (W/"…"), but conditional writes only match the strong form */
const strong = (etag: string) => etag.replace(/^W\//, "");

function keyOf(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  return KEY.test(key) ? key : null;
}

const validRef = (r: Ref) => r && ID.test(r.track) && typeof r.meta === "string" && r.meta.length <= 4096;

function valid(c: Change | null): c is Change {
  if (!c || !ID.test(c.device)) return false;
  if (c.person != null && (typeof c.person !== "string" || c.person.length > 2048)) return false;
  if (c.added && (!Array.isArray(c.added) || c.added.length > 500 || !c.added.every(validRef))) return false;
  if (c.vote && (!validRef(c.vote) || ![-1, 0, 1].includes(c.vote.vote))) return false;
  return !!(c.vote || c.added?.length || c.person);
}

async function read(key: string, ifNoneMatch?: string) {
  const r = await get(blobPath(key), { access: "private", useCache: false, ifNoneMatch });
  if (!r) return { doc: { tracks: {}, people: {} } as Doc, etag: null, unchanged: false };
  if (r.statusCode === 304) return { doc: null, etag: r.blob.etag, unchanged: true };
  return { doc: (await new Response(r.stream).json()) as Doc, etag: r.blob.etag, unchanged: false };
}

function apply(d: Doc, c: Change) {
  const now = Date.now();
  const touch = (r: Ref) => {
    const t = (d.tracks[r.track] ??= { meta: r.meta, at: now, votes: {} });
    t.meta = r.meta;
    t.at = now;
    return t;
  };
  for (const r of c.added ?? []) touch(r).added = { by: c.device, at: now };
  if (c.vote) {
    const t = touch(c.vote);
    if (c.vote.vote === 0) delete t.votes[c.device];
    else t.votes[c.device] = c.vote.vote;
    if (!Object.keys(t.votes).length && !t.added) delete d.tracks[c.vote.track];
  }
  if (c.person) d.people[c.device] = c.person;

  // keep the newest songs only
  const ids = Object.keys(d.tracks);
  if (ids.length > MAX_TRACKS) {
    ids.sort((a, b) => d.tracks[b].at - d.tracks[a].at).slice(MAX_TRACKS).forEach((id) => delete d.tracks[id]);
  }
}

export async function GET(req: Request) {
  const key = keyOf(req);
  if (!key) return new Response("bad key", { status: 400 });
  const { doc, etag, unchanged } = await read(key, req.headers.get("if-none-match") ?? undefined);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (etag) headers.etag = etag;
  if (unchanged) return new Response(null, { status: 304, headers });
  return Response.json(doc, { headers });
}

export async function POST(req: Request) {
  const key = keyOf(req);
  if (!key) return new Response("bad key", { status: 400 });
  const c = (await req.json().catch(() => null)) as Change | null;
  if (!valid(c)) return new Response("bad change", { status: 400 });

  for (let attempt = 0; attempt < 10; attempt++) {
    const { doc, etag } = await read(key);
    apply(doc!, c);
    try {
      const r = await put(blobPath(key), JSON.stringify(doc), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        // the first change creates the doc; afterwards only overwrite what we read
        ...(etag ? { allowOverwrite: true, ifMatch: strong(etag) } : { allowOverwrite: false }),
      });
      return Response.json(doc, { headers: { etag: r.etag, "cache-control": "no-store" } });
    } catch (e) {
      // someone else wrote in between, or created the doc first: read again
      const msg = String(e);
      console.warn(`votes write attempt ${attempt + 1} failed (etag ${etag}):`, msg);
      const raced = e instanceof BlobPreconditionFailedError || msg.includes("conflict") || (!etag && msg.includes("exist"));
      if (!raced) throw e;
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 120 * (attempt + 1)));
    }
  }
  return new Response("busy, try again", { status: 409 });
}
