import type { MutableRefObject } from "react";
import { api, fmt, type Group, type PlayerState } from "./api";
import type { Run } from "./App";
import { Art } from "./Browse";
import { usePosition, useVolume } from "./TopBar";
import * as Icon from "./icons";

export type NextUp = { title: string; artist?: string } | null;

type Props = {
  groups: Group[];
  group: Group | null;
  onSelect: (id: string) => void;
  state: PlayerState | null;
  nextUp: NextUp;
  fetchedAt: MutableRefObject<number>;
  run: Run;
  pinned: boolean;
  onPin: () => void;
  onExpand: () => void;
};

export function Mini({ groups, group, onSelect, state, nextUp, fetchedAt, run, pinned, onPin, onExpand }: Props) {
  const g = group?.id;
  const playing = state?.transport === "PLAYING" || state?.transport === "TRANSITIONING";
  const [vol, onVol] = useVolume(g, state?.volume);
  const { pos, dur } = usePosition(state, playing, fetchedAt);
  const t = state?.track;

  return (
    <div className="mini">
      <div className="mini-bar" data-tauri-drag-region>
        <select className="mini-room" value={g ?? ""} onChange={(e) => onSelect(e.target.value)} title="Room">
          {groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          {!groups.length && <option value="">No speakers</option>}
        </select>
        <button className={`icon-btn xs ${pinned ? "on" : ""}`} onClick={onPin} title={pinned ? "Unpin (stop floating on top)" : "Keep on top"}>
          <Icon.Pin />
        </button>
        <button className="icon-btn xs" onClick={onExpand} title="Full player (⌘⇧M)"><Icon.Expand /></button>
      </div>

      <div className="mini-main">
        <div className="mini-art" onDoubleClick={onExpand}><Art src={t?.art} /></div>
        <div className="mini-info">
          <div className="title" title={t?.title}>{t?.title || (group ? "Nothing playing" : "No room")}</div>
          <div className="sub">{t?.artist ?? state?.source ?? ""}</div>
          <div className="mini-next" title={nextUp ? `${nextUp.title}${nextUp.artist ? " — " + nextUp.artist : ""}` : ""}>
            {nextUp ? <><span>Next</span> {nextUp.title}{nextUp.artist && <em> · {nextUp.artist}</em>}</> : state?.source ? <em>{state.source}</em> : null}
          </div>
          <div className="mini-controls">
            <button className="icon-btn" disabled={!g} onClick={() => g && run(() => api.control(g, "previous"))}><Icon.Prev /></button>
            <button className="play-btn sm" disabled={!g} onClick={() => g && run(() => api.control(g, playing ? "pause" : "play"))}>
              {playing ? <Icon.Pause width={16} height={16} /> : <Icon.Play width={16} height={16} />}
            </button>
            <button className="icon-btn" disabled={!g} onClick={() => g && run(() => api.control(g, "next"))}><Icon.Next /></button>
            <div className="mini-vol">
              <Icon.Volume width={14} height={14} />
              <input type="range" className="slider" min={0} max={100} value={vol} disabled={!g}
                style={{ "--p": `${vol}%` } as React.CSSProperties}
                onChange={(e) => onVol(Number(e.target.value))} title={`Volume ${vol}`} />
            </div>
          </div>
        </div>
      </div>

      <div className="mini-progress" title={dur ? `${fmt(pos)} / ${fmt(dur)}` : ""}>
        <i style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} />
      </div>
    </div>
  );
}
