import { useRef, useState } from "react";
import { api, fmt, hms, type Group, type Item, type PlayerQueue, type PlayerState, type SpItem } from "./api";
import type { Run } from "./App";
import { Art } from "./Browse";
import * as Icon from "./icons";
import { AddedBy, Score } from "./Social";

type Props = {
  group: Group | null;
  state: PlayerState | null;
  queue: Item[];
  spQueue: PlayerQueue | null;
  castingMine: boolean;
  run: Run;
};

export function Queue({ group, state, queue, spQueue, castingMine, run }: Props) {
  const g = group?.id;
  const current = state?.queueActive ? state.trackNo : 0;
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const total = queue.reduce((a, q) => a + hms(q.duration), 0);
  const connect = state?.source === "Spotify Connect";
  const scroller = useRef<HTMLDivElement>(null);
  // long queues: bring the playing song back into view
  const jumpToCurrent = () =>
    scroller.current?.querySelector(".qrow.current")?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <aside className="queue">
      <div className="queue-scroll" ref={scroller}>
        {connect && (
          <section className="connect">
            <div className="panel-head">
              <h2><Icon.Cast width={13} height={13} /> Spotify Connect</h2>
            </div>
            {spQueue && castingMine ? (
              <>
                <p className="muted small pad-x">You're casting. Play next and + add to your Spotify queue.</p>
                <ol className="queue-list">
                  {spQueue.current && <SpRow item={spQueue.current} current playing={state?.transport === "PLAYING"} />}
                  {spQueue.queue.map((t, i) => <SpRow key={t.id + i} item={t} />)}
                </ol>
              </>
            ) : (
              <div className="notice">
                Someone else is streaming here directly from Spotify, so the queue below isn't being used.
              </div>
            )}
          </section>
        )}

        <div className="panel-head">
          <h2>{connect ? "Sonos queue" : "Queue"}</h2>
          <span className="muted">{queue.length ? `${queue.length} · ${fmt(total)}` : ""}</span>
          {(current > 0 || (connect && spQueue?.current)) && (
            <button className="icon-btn xs" title="Go to the playing song" onClick={jumpToCurrent}>
              <Icon.Locate />
            </button>
          )}
          {queue.length > 0 && (
            <button className="link" onClick={() => g && confirm("Clear the whole queue?") && run(() => api.clearQueue(g), "Queue cleared")}>
              Clear
            </button>
          )}
        </div>
        {state?.source && !state.queueActive && !connect && (
          <div className="notice">
            Playing from <b>{state.source}</b>, so the queue isn't in use. Double-click a track to switch to it.
          </div>
        )}
        {/* dimmed while something else (Spotify Connect, TV, radio) owns the room */}
        <ol className={`queue-list ${state?.source && !state.queueActive ? "idle" : ""}`}>
          {queue.map((it, i) => {
            const n = i + 1; // Sonos queue positions are 1-based
            return (
              <li key={`${it.id}-${n}`}
                className={`qrow ${n === current ? "current" : ""} ${over === n ? "over" : ""} ${drag === n ? "dragging" : ""}`}
                draggable
                onDragStart={() => setDrag(n)}
                onDragOver={(e) => (e.preventDefault(), setOver(n))}
                onDragLeave={() => setOver((o) => (o === n ? null : o))}
                onDragEnd={() => (setDrag(null), setOver(null))}
                onDrop={() => {
                  if (g && drag != null && drag !== n) {
                    // dropping on a row inserts before it; moving down needs to land after it
                    run(() => api.moveIndex(g, drag, drag < n ? n + 1 : n));
                  }
                  setDrag(null);
                  setOver(null);
                }}
                onDoubleClick={() => g && run(() => api.playIndex(g, n))}>
                <div className="q-art">
                  <Art src={it.art} />
                  {n === current && state?.transport === "PLAYING" && <span className="eq"><i /><i /><i /></span>}
                </div>
                <div className="row-text">
                  <div className="title">{it.title}<Score song={it} /></div>
                  <div className="sub"><AddedBy song={it} />{it.artist}</div>
                </div>
                <span className="dur">{it.duration ? fmt(hms(it.duration)) : ""}</span>
                <button className="icon-btn xs remove" title="Remove"
                  onClick={(e) => (e.stopPropagation(), g && run(() => api.removeIndex(g, n)))}>
                  <Icon.X />
                </button>
              </li>
            );
          })}
        </ol>
        {!queue.length && (
          <p className="muted pad">{group ? "The queue is empty. Use + on a search result to add songs." : "No room selected."}</p>
        )}
      </div>
    </aside>
  );
}

function SpRow({ item, current, playing }: { item: SpItem; current?: boolean; playing?: boolean }) {
  return (
    <li className={`qrow readonly ${current ? "current" : ""}`}>
      <div className="q-art">
        <Art src={item.image} />
        {current && playing && <span className="eq"><i /><i /><i /></span>}
      </div>
      <div className="row-text">
        <div className="title">{item.name}<Score song={{ title: item.name, artist: item.subtitle }} /></div>
        <div className="sub"><AddedBy song={{ title: item.name, artist: item.subtitle }} />{item.subtitle}</div>
      </div>
      <span className="dur">{item.durationMs ? fmt(item.durationMs / 1000) : ""}</span>
      <span />
    </li>
  );
}
