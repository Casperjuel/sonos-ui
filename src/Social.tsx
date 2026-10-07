import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, trackKey, type Me, type Person, type TrackMeta, type TrackSocial } from "./api";
import { errText, type ToastFn } from "./App";
import * as Icon from "./icons";

/** A song as the app knows it: from the queue, now playing or a Spotify result. */
export type SongRef = { title?: string; artist?: string; art?: string };

type Social = {
  lookup: (song: SongRef) => TrackSocial | undefined;
  vote: (song: SongRef, value: -1 | 1) => void;
  /** call after queueing songs from Sponos, so others see who added them */
  markAdded: (songs: SongRef[]) => void;
};

const Ctx = createContext<Social>({ lookup: () => undefined, vote: () => {}, markAdded: () => {} });
export const SocialProvider = Ctx.Provider;
export const useSocial = () => useContext(Ctx);

const meta = (s: SongRef): TrackMeta => ({ key: trackKey(s.title, s.artist), title: s.title ?? "", artist: s.artist, art: s.art });

/** Votes and "added by" for the active Sonos system, shared through the sync service. */
export function useSocialState(household: string | null, me: Me | null, toast: ToastFn): Social {
  const [tracks, setTracks] = useState<Record<string, TrackSocial>>({});
  const person = useMemo<Person | null>(() => (me ? { name: me.name, image: me.image } : null), [me]);

  const apply = useCallback((list: TrackSocial[]) => setTracks(Object.fromEntries(list.map((t) => [t.key, t]))), []);

  useEffect(() => {
    setTracks({});
    if (!household) return;
    const load = () => api.social().then(apply).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    window.addEventListener("focus", load);
    return () => (clearInterval(t), window.removeEventListener("focus", load));
  }, [household, apply]);

  const lookup = useCallback((s: SongRef) => (s.title ? tracks[trackKey(s.title, s.artist)] : undefined), [tracks]);

  const vote = useCallback(
    (s: SongRef, value: -1 | 1) => {
      if (!s.title) return;
      const m = meta(s);
      const cur = tracks[m.key];
      const next = cur?.mine === value ? 0 : value; // same button again takes the vote back
      // show it straight away; the server's answer replaces it
      setTracks((all) => {
        const t = all[m.key] ?? { ...m, up: 0, down: 0, mine: 0 as const, upBy: [], downBy: [], at: Date.now() };
        const without = { up: t.up - (t.mine === 1 ? 1 : 0), down: t.down - (t.mine === -1 ? 1 : 0) };
        return {
          ...all,
          [m.key]: { ...t, mine: next, up: without.up + (next === 1 ? 1 : 0), down: without.down + (next === -1 ? 1 : 0) },
        };
      });
      api.vote(m, next, person).then(apply).catch((e) => toast(errText(e), true));
    },
    [tracks, apply, toast, person],
  );

  const markAdded = useCallback(
    (songs: SongRef[]) => {
      if (!person || !songs.length) return; // only Spotify-logged-in people get a face
      api.markAdded(songs.filter((s) => s.title).map(meta), person).then(apply).catch(() => {});
    },
    [apply, person],
  );

  return useMemo(() => ({ lookup, vote, markAdded }), [lookup, vote, markAdded]);
}

const names = (list: string[]) => (list.length ? list.join(", ") : "");

/** 👍 / 👎 with counts; hover shows who. */
export function VoteButtons({ song, compact }: { song: SongRef; compact?: boolean }) {
  const { lookup, vote } = useSocial();
  const t = lookup(song);
  const btn = (value: -1 | 1) => {
    const count = value === 1 ? t?.up : t?.down;
    const who = value === 1 ? t?.upBy : t?.downBy;
    const label = value === 1 ? "Upvote" : "Downvote";
    return (
      <button
        className={`vote ${value === 1 ? "up" : "down"} ${t?.mine === value ? "mine" : ""}`}
        title={who?.length ? `${label}d by ${names(who)}` : label}
        onClick={(e) => (e.stopPropagation(), vote(song, value))}
      >
        {value === 1 ? <Icon.ThumbUp /> : <Icon.ThumbDown />}
        {!!count && <span>{count}</span>}
      </button>
    );
  };
  if (!song.title) return null;
  return (
    <div className={`votes ${compact ? "compact" : ""}`}>
      {btn(1)}
      {btn(-1)}
    </div>
  );
}

/** Score badge for list rows: only shows when someone voted. */
export function Score({ song }: { song: SongRef }) {
  const t = useSocial().lookup(song);
  if (!t || (!t.up && !t.down)) return null;
  const score = t.up - t.down;
  const who = [t.upBy.length && `👍 ${names(t.upBy)}`, t.downBy.length && `👎 ${names(t.downBy)}`].filter(Boolean).join("\n");
  return <span className={`score ${score > 0 ? "pos" : score < 0 ? "neg" : ""}`} title={who}>{score > 0 ? `+${score}` : score}</span>;
}

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Small avatar of whoever added the song from Sponos while logged in to Spotify. */
export function AddedBy({ song }: { song: SongRef }) {
  const a = useSocial().lookup(song)?.addedBy;
  if (!a) return null;
  const title = `Added by ${a.me ? "you" : a.name} · ${ago(a.at)}`;
  return a.image ? (
    <img className="added-by" src={a.image} alt="" title={title} />
  ) : (
    <span className="added-by initial" title={title}>{a.name.slice(0, 1).toUpperCase()}</span>
  );
}

/** "Added by Ann · 5 min ago" under the now-playing song. */
export function AddedByLine({ song }: { song: SongRef }) {
  const a = useSocial().lookup(song)?.addedBy;
  if (!a) return null;
  return (
    <div className="added-by-line">
      <AddedBy song={song} />
      <span>Added by {a.me ? "you" : a.name} · {ago(a.at)}</span>
    </div>
  );
}
