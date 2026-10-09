import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, EMOJI, trackKey, type Emoji, type Me, type Person, type TrackMeta, type TrackSocial } from "./api";
import { errText, type ToastFn } from "./App";
import * as Icon from "./icons";

/** A song as the app knows it: from the queue, now playing or a Spotify result. */
export type SongRef = { title?: string; artist?: string; art?: string };

type Social = {
  lookup: (song: SongRef) => TrackSocial | undefined;
  vote: (song: SongRef, value: -1 | 1) => void;
  /** toggles your emoji reaction (one per song) */
  react: (song: SongRef, emoji: Emoji) => void;
  /** call after queueing songs from Sponos, so others see who added them */
  markAdded: (songs: SongRef[]) => void;
};

const Ctx = createContext<Social>({ lookup: () => undefined, vote: () => {}, react: () => {}, markAdded: () => {} });
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
        const t = all[m.key] ?? { ...m, up: 0, down: 0, mine: 0 as const, upBy: [], downBy: [], reactions: [], at: Date.now() };
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

  const react = useCallback(
    (s: SongRef, emoji: Emoji) => {
      if (!s.title) return;
      const m = meta(s);
      const t = tracks[m.key];
      const mine = t?.reactions.find((r) => r.mine)?.emoji;
      const next = mine === emoji ? null : emoji; // same emoji again takes it back
      // show it straight away; the server's answer replaces it
      setTracks((all) => {
        const cur = all[m.key] ?? { ...m, up: 0, down: 0, mine: 0 as const, upBy: [], downBy: [], reactions: [], at: Date.now() };
        let reactions = cur.reactions
          .map((r) => (r.mine ? { ...r, mine: false, by: r.by.filter((b) => b !== "You") } : r))
          .filter((r) => r.by.length);
        if (next) {
          const hit = reactions.find((r) => r.emoji === next);
          reactions = hit
            ? reactions.map((r) => (r === hit ? { ...r, mine: true, by: [...r.by, "You"] } : r))
            : [...reactions, { emoji: next, mine: true, by: ["You"] }];
        }
        return { ...all, [m.key]: { ...cur, reactions } };
      });
      api.react(m, next, person).then(apply).catch((e) => toast(errText(e), true));
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

  return useMemo(() => ({ lookup, vote, react, markAdded }), [lookup, vote, react, markAdded]);
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

/** 💩 🦄 🔥 💃 😴 🎉 under the now-playing song: chips for what people picked, and a picker. */
export function Reactions({ song }: { song: SongRef }) {
  const { lookup, react } = useSocial();
  const t = lookup(song);
  const [open, setOpen] = useState(false);
  const [bursts, setBursts] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!song.title) return null;
  const pick = (emoji: Emoji) => {
    const was = t?.reactions.find((r) => r.mine)?.emoji === emoji;
    if (!was) {
      // a little flurry floats up from the bar
      const id = Date.now();
      setBursts((b) => [...b, ...[0, 1, 2, 3, 4].map((i) => ({ id: id + i, emoji: EMOJI[emoji], x: Math.random() * 80 - 40 }))]);
      setTimeout(() => setBursts((b) => b.filter((x) => x.id < id || x.id > id + 4)), 1400);
    }
    react(song, emoji);
    setOpen(false);
  };

  return (
    <div className="reactions" ref={ref}>
      {t?.reactions.map((r) => (
        <button key={r.emoji} className={`reaction ${r.mine ? "mine" : ""}`} onClick={() => pick(r.emoji)}
          title={`${EMOJI[r.emoji]} ${names(r.by)}`}>
          {EMOJI[r.emoji]} <span>{r.by.length}</span>
        </button>
      ))}
      <button className="reaction add" onClick={() => setOpen((o) => !o)} title="React">
        <span className="add-face">☺</span>+
      </button>
      {open && (
        <div className="reaction-picker">
          {(Object.keys(EMOJI) as Emoji[]).map((e, i) => (
            <button key={e} onClick={() => pick(e)} style={{ "--i": i } as React.CSSProperties}>{EMOJI[e]}</button>
          ))}
        </div>
      )}
      {bursts.map((b, i) => (
        <span key={b.id} className="reaction-burst" style={{ "--x": `${b.x}px`, "--d": `${(i % 5) * 70}ms` } as React.CSSProperties}>{b.emoji}</span>
      ))}
    </div>
  );
}

/** the top reactions as a tiny badge in list rows */
export function ReactionBadge({ song }: { song: SongRef }) {
  const t = useSocial().lookup(song);
  if (!t?.reactions.length) return null;
  return (
    <span className="reaction-badge" title={t.reactions.map((r) => `${EMOJI[r.emoji]} ${names(r.by)}`).join("\n")}>
      {t.reactions.slice(0, 3).map((r) => EMOJI[r.emoji]).join("")}
      {t.reactions.reduce((n, r) => n + r.by.length, 0) > 1 && <small>{t.reactions.reduce((n, r) => n + r.by.length, 0)}</small>}
    </span>
  );
}
