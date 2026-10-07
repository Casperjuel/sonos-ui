import { useEffect, useState } from "react";
import { api, fmt, type Group, type PlayerState, type QueueMode, type SearchResult, type SpItem } from "./api";
import { errText } from "./App";
import { AddedByLine, VoteButtons } from "./Social";
import * as Icon from "./icons";

type Props = {
  query: string;
  nonce: number;
  open: SpItem | null;
  setOpen: (item: SpItem | null) => void;
  state: PlayerState | null;
  group: Group | null;
  enqueue: (item: SpItem, mode: QueueMode) => void;
  enqueueMany: (items: SpItem[], mode: QueueMode) => void;
  onSettings: () => void;
  onLogin: () => void;
  loggedIn: boolean;
};

type Tab = "all" | "tracks" | "albums" | "artists" | "playlists";

export function Browse({ query, nonce, open, setOpen, state, group, enqueue, enqueueMany, onSettings, onLogin, loggedIn }: Props) {
  const [results, setResults] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  // drill-ins opened from search results go "back" to the results, library ones to now playing
  const [fromSearch, setFromSearch] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setResults(null);
    setLoading(true);
    let live = true;
    const t = setTimeout(() => {
      api.search(q)
        .then((r) => live && (setResults(r), setError(null)))
        .catch((e) => live && setError(errText(e)))
        .finally(() => live && setLoading(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, nonce]);

  if (open)
    return (
      <Detail item={open} onBack={() => setOpen(null)} backLabel={fromSearch && query ? "Back to results" : "Back"}
        enqueue={enqueue} enqueueMany={enqueueMany} onLogin={onLogin} loggedIn={loggedIn} />
    );

  if (!query.trim()) return <NowPlaying state={state} group={group} />;

  const r = results;
  const section = (key: Exclude<Tab, "all">, title: string, items: SpItem[] | undefined, grid: boolean) => {
    if (!items?.length) return null;
    const shown = tab === "all" ? items.slice(0, grid ? 6 : 5) : items;
    return (
      <section key={key}>
        {tab === "all" && (
          <div className="section-head">
            <h3>{title}</h3>
            <button className="link" onClick={() => setTab(key)}>Show all</button>
          </div>
        )}
        {grid ? (
          <div className="grid">
            {shown.map((it) => <Card key={it.id} item={it} onOpen={() => (setFromSearch(true), setOpen(it))} enqueue={enqueue} />)}
          </div>
        ) : (
          <div className="rows">
            {shown.map((it) => <TrackRow key={it.id} item={it} enqueue={enqueue} />)}
          </div>
        )}
      </section>
    );
  };

  return (
    <main className="browse">
      <nav className="tabs">
        {(["all", "tracks", "albums", "artists", "playlists"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        {loading && <span className="spinner" />}
      </nav>
      <div className="scroll">
        {error && (
          <div className="empty">
            <p>{error}</p>
            {/settings/i.test(error) && <button className="btn" onClick={onSettings}>Open settings</button>}
          </div>
        )}
        {r && !error && (
          <>
            {(tab === "all" || tab === "tracks") && section("tracks", "Songs", r.tracks, false)}
            {(tab === "all" || tab === "artists") && section("artists", "Artists", r.artists, true)}
            {(tab === "all" || tab === "albums") && section("albums", "Albums", r.albums, true)}
            {(tab === "all" || tab === "playlists") && section("playlists", "Playlists", r.playlists, true)}
          </>
        )}
      </div>
    </main>
  );
}

function Actions({ item, enqueue }: { item: SpItem; enqueue: Props["enqueue"] }) {
  return (
    <div className="actions" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn sm" title="Play now" onClick={() => enqueue(item, "now")}><Icon.Play /></button>
      <button className="icon-btn sm" title="Play next" onClick={() => enqueue(item, "next")}><Icon.PlayNext /></button>
      <button className="icon-btn sm" title="Add to end of queue" onClick={() => enqueue(item, "end")}><Icon.Plus /></button>
    </div>
  );
}

function TrackRow({ item, enqueue, index }: { item: SpItem; enqueue: Props["enqueue"]; index?: number }) {
  return (
    <div className="row" onDoubleClick={() => enqueue(item, "now")} title="Double-click to play now">
      {index != null ? <span className="idx">{index}</span> : <Art src={item.image} />}
      <div className="row-text">
        <div className="title">{item.name}</div>
        <div className="sub">{item.subtitle}</div>
      </div>
      <span className="dur">{item.durationMs ? fmt(item.durationMs / 1000) : ""}</span>
      <Actions item={item} enqueue={enqueue} />
    </div>
  );
}

function Card({ item, onOpen, enqueue }: { item: SpItem; onOpen: () => void; enqueue: Props["enqueue"] }) {
  return (
    <div className={`card ${item.kind}`} onClick={onOpen}>
      <div className="card-art">
        <Art src={item.image} />
        <Actions item={item} enqueue={enqueue} />
      </div>
      <div className="title">{item.name}</div>
      <div className="sub">{item.subtitle}</div>
    </div>
  );
}

type DetailProps = {
  item: SpItem;
  onBack: () => void;
  backLabel: string;
  enqueue: Props["enqueue"];
  enqueueMany: Props["enqueueMany"];
  onLogin: () => void;
  loggedIn: boolean;
};

function Detail({ item, onBack, backLabel, enqueue, enqueueMany, onLogin, loggedIn }: DetailProps) {
  const [tracks, setTracks] = useState<SpItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTracks(null);
    setError(null);
    api.children(item).then(setTracks).catch((e) => setError(errText(e)));
  }, [item, loggedIn]);

  // Liked songs has no Sonos container, so queue the loaded tracks one by one.
  // Everything else is queued as a whole container and Sonos expands it.
  const liked = item.kind === "liked";
  const queueAll = (mode: QueueMode) => (liked ? tracks?.length && enqueueMany(tracks, mode) : enqueue(item, mode));
  const label = item.kind === "artist" ? "top tracks" : liked ? "all" : item.kind;
  const needsLogin = !loggedIn && /log in/i.test(error ?? "");

  return (
    <main className="browse">
      <div className="scroll">
        <button className="link back" onClick={onBack}><Icon.Back /> {backLabel}</button>
        <div className={`detail-head ${item.kind}`}>
          {liked ? <div className="art liked"><Icon.Heart width={56} height={56} /></div> : <Art src={item.image} />}
          <div>
            <div className="eyebrow">{liked ? "Library" : item.kind}</div>
            <h1>{item.name}</h1>
            <div className="sub">{tracks ? `${item.subtitle} · ${tracks.length} songs` : item.subtitle}</div>
            <div className="detail-actions">
              <button className="btn primary" disabled={liked && !tracks?.length} onClick={() => queueAll("now")}><Icon.Play /> Play {label}</button>
              <button className="btn" disabled={liked && !tracks?.length} onClick={() => queueAll("next")}><Icon.PlayNext /> Play next</button>
              <button className="btn" disabled={liked && !tracks?.length} onClick={() => queueAll("end")}><Icon.Plus /> Add to queue</button>
            </div>
          </div>
        </div>
        {needsLogin && (
          <div className="notice inline-notice">
            Spotify only lists a playlist's songs to a logged-in owner or collaborator. You can still queue the whole playlist with the buttons above.
            <button className="btn" onClick={onLogin}>Log in to Spotify</button>
          </div>
        )}
        {error === "NOT_OWNER" && (
          <p className="muted pad">
            Spotify won't share this playlist's songs (it may be private). Play it or add it to the queue anyway and Sonos will load the whole thing.
          </p>
        )}
        {error && error !== "NOT_OWNER" && !needsLogin && (
          <p className="muted pad">
            Couldn't list the songs ({error}).{!liked && ` You can still queue the whole ${label}.`}
          </p>
        )}
        {!tracks && !error && <span className="spinner" />}
        <div className="rows">
          {tracks?.map((t, i) => (
            <TrackRow key={t.id + i} item={t} enqueue={enqueue} index={item.kind === "album" ? i + 1 : undefined} />
          ))}
        </div>
      </div>
    </main>
  );
}

function NowPlaying({ state, group }: { state: PlayerState | null; group: Group | null }) {
  const t = state?.track;
  return (
    <main className="browse now">
      {t?.title ? (
        // keyed on the track so a new song replays the entrance animation
        <div className="now-inner" key={t.title}>
          <div className="now-art"><Art src={t.art} /></div>
          <h1>{t.title}</h1>
          <div className="sub">{[t.artist, t.album].filter(Boolean).join(" — ")}</div>
          <div className="muted">
            {group?.name}
            {state?.source && <span className="chip">{state.source}</span>}
          </div>
          <VoteButtons song={t} />
          <AddedByLine song={t} />
        </div>
      ) : (
        <div className="empty">
          <Icon.Music width={40} height={40} />
          <p>{group ? `Nothing playing in ${group.name}` : "Pick a room"}</p>
          <p className="muted">Search Spotify above to add something.</p>
        </div>
      )}
    </main>
  );
}

export function Art({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return src && !broken ? (
    <img className="art" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
  ) : (
    <div className="art placeholder"><Icon.Music /></div>
  );
}
