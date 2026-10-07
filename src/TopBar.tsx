import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, fmt, playModes, type Group, type MemberVol, type PlayerState } from "./api";
import type { Run } from "./App";
import * as Icon from "./icons";

type Props = {
  group: Group | null;
  state: PlayerState | null;
  fetchedAt: MutableRefObject<number>;
  run: Run;
  query: string;
  onQuery: (q: string) => void;
  onSettings: () => void;
  onMini: () => void;
  view: "player" | "overview";
  onToggleView: () => void;
};

/** Volume that follows the speaker, but stays local while dragging and is throttled to the speaker. */
export function useVolume(g: string | undefined, polled: number | undefined) {
  const [vol, setVol] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const onVol = (v: number) => {
    setVol(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (g) api.setVolume(g, v).finally(() => setTimeout(() => setVol(null), 1200));
    }, 120);
  };
  return [vol ?? polled ?? 0, onVol] as const;
}

/** Track position interpolated between 1s polls so progress bars move smoothly. */
export function usePosition(state: PlayerState | null, playing: boolean, fetchedAt: MutableRefObject<number>) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const dur = state?.duration ?? 0;
  const pos = Math.min(dur || Infinity, (state?.position ?? 0) + (playing ? (now - fetchedAt.current) / 1000 : 0));
  return { pos, dur };
}

export function TopBar({ group, state, fetchedAt, run, query, onQuery, onSettings, onMini, view, onToggleView }: Props) {
  const g = group?.id;
  const playing = state?.transport === "PLAYING" || state?.transport === "TRANSITIONING";
  const mode = playModes.decode(state?.playMode ?? "NORMAL");
  const [shownVol, onVol] = useVolume(g, state?.volume);
  const [scrub, setScrub] = useState<number | null>(null);
  const live = usePosition(state, playing, fetchedAt);
  const dur = live.dur;
  const pos = scrub ?? live.pos;
  const [roomsOpen, setRoomsOpen] = useState(false);

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="tb-left" data-tauri-drag-region>
        <button className="icon-btn" disabled={!g} onClick={() => g && run(() => api.setMute(g, !state?.muted))}
          title={state?.muted ? "Unmute" : "Mute"}>
          {state?.muted ? <Icon.Mute /> : <Icon.Volume />}
        </button>
        <input type="range" className="slider vol" min={0} max={100} value={shownVol} disabled={!g}
          style={{ "--p": `${shownVol}%` } as React.CSSProperties}
          onChange={(e) => onVol(Number(e.target.value))} />
        <span className="vol-num">{shownVol}</span>
        {group && group.members.length > 1 && (
          <div className="pop-anchor">
            <button className="chip" onClick={() => setRoomsOpen((o) => !o)}>{group.members.length} rooms</button>
            {roomsOpen && <MemberVolumes groupId={group.id} onClose={() => setRoomsOpen(false)} />}
          </div>
        )}
      </div>

      <div className="tb-center">
        <div className="transport">
          <button className={`icon-btn sm ${mode.shuffle ? "on" : ""}`} disabled={!g} title="Shuffle"
            onClick={() => g && run(() => api.setPlayMode(g, playModes.encode(!mode.shuffle, mode.repeat)))}>
            <Icon.Shuffle />
          </button>
          <button className="icon-btn lg" disabled={!g} onClick={() => g && run(() => api.control(g, "previous"))} title="Previous">
            <Icon.Prev />
          </button>
          <button className="play-btn" disabled={!g} onClick={() => g && run(() => api.control(g, playing ? "pause" : "play"))}
            title={playing ? "Pause" : "Play"}>
            {playing ? <Icon.Pause width={20} height={20} /> : <Icon.Play width={20} height={20} />}
          </button>
          <button className="icon-btn lg" disabled={!g} onClick={() => g && run(() => api.control(g, "next"))} title="Next">
            <Icon.Next />
          </button>
          <button className={`icon-btn sm ${mode.repeat !== "off" ? "on" : ""}`} disabled={!g}
            title={`Repeat: ${mode.repeat}`}
            onClick={() => {
              const next = mode.repeat === "off" ? "all" : mode.repeat === "all" ? "one" : "off";
              g && run(() => api.setPlayMode(g, playModes.encode(mode.shuffle, next)));
            }}>
            <Icon.Repeat />
            {mode.repeat === "one" && <span className="badge">1</span>}
          </button>
        </div>
        <div className="progress">
          <span>{fmt(pos)}</span>
          <input type="range" className="slider" min={0} max={dur || 1} value={dur ? pos : 0} disabled={!dur}
            style={{ "--p": `${dur ? (pos / dur) * 100 : 0}%` } as React.CSSProperties}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => {
              if (g && scrub != null) run(() => api.seek(g, Math.round(scrub))).then(() => setScrub(null));
            }} />
          <span>{dur ? fmt(dur) : "--:--"}</span>
        </div>
      </div>

      <div className="tb-right" data-tauri-drag-region>
        <label className="search">
          <Icon.Search />
          <input id="search" placeholder="Search or paste a Spotify link  ⌘F" value={query} onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onQuery("")} spellCheck={false} />
          {query && <button className="icon-btn xs" onClick={() => onQuery("")}><Icon.X /></button>}
        </label>
        <button className={`icon-btn ${view === "overview" ? "on" : ""}`} onClick={onToggleView}
          title={view === "overview" ? "Back to the player (⌘1)" : "Floorplan overview (⌘2)"}>
          {view === "overview" ? <Icon.Player /> : <Icon.Map />}
        </button>
        <button className="icon-btn" onClick={onMini} title="Mini player (⌘⇧M)"><Icon.Minimize /></button>
        <button className="icon-btn" onClick={onSettings} title="Settings"><Icon.Gear /></button>
      </div>
    </header>
  );
}

function MemberVolumes({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [members, setMembers] = useState<MemberVol[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api.members(groupId).then(setMembers).catch(() => {});
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    setTimeout(() => document.addEventListener("click", close));
    return () => document.removeEventListener("click", close);
  }, [groupId, onClose]);
  return (
    <div className="popover" ref={ref}>
      {members.map((m) => (
        <div key={m.uuid} className="member">
          <span title={m.ip}>{m.name}</span>
          <input type="range" className="slider" min={0} max={100} value={m.volume}
            style={{ "--p": `${m.volume}%` } as React.CSSProperties}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMembers((ms) => ms.map((x) => (x.uuid === m.uuid ? { ...x, volume: v } : x)));
              api.setMemberVolume(m.ip, v);
            }} />
          <span className="vol-num">{m.volume}</span>
        </div>
      ))}
      {!members.length && <div className="muted">Loading…</div>}
    </div>
  );
}
