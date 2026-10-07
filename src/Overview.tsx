import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type Floorplan, type Group, type GroupOverview, type Member, type PlayerState } from "./api";
import { errText, type Run, type ToastFn } from "./App";
import { Art } from "./Browse";
import { useVolume } from "./TopBar";
import * as Icon from "./icons";

const COLORS = ["#0a84ff", "#ff9f0a", "#30d158", "#bf5af2", "#ff375f", "#64d2ff", "#ffd60a", "#ff6482"];
/** dropping a speaker within this many px of another groups them */
const SNAP = 40;

type Speaker = Member & {
  group: Group;
  state: PlayerState | null;
  volume: number;
  color: string;
  isCoordinator: boolean;
};

type Props = {
  run: Run;
  toast: ToastFn;
  /** rediscover topology after grouping changes */
  onRegrouped: () => Promise<void>;
  onOpenRoom: (groupId: string) => void;
};

export function Overview({ run, toast, onRegrouped, onOpenRoom }: Props) {
  const [data, setData] = useState<GroupOverview[]>([]);
  const [fp, setFp] = useState<Floorplan | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  /** click-to-place: a speaker picked from the side list, waiting for a click on the plan */
  const [placing, setPlacing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ uuid: string; x: number; y: number; target: string | null } | null>(null);
  const dragStart = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [aspect, setAspect] = useState(16 / 10);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  // ---- data
  const refresh = useCallback(() => api.overview().then(setData).catch(() => {}), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    api.getFloorplan().then(setFp);
  }, []);

  const save = (next: Floorplan) => {
    setFp(next);
    api.saveFloorplan(next).catch((e) => toast(errText(e), true));
  };

  const speakers: Speaker[] = data.flatMap((o, gi) =>
    o.group.members.map((m) => ({
      ...m,
      group: o.group,
      state: o.state,
      volume: o.volumes[m.uuid] ?? 0,
      color: COLORS[gi % COLORS.length],
      isCoordinator: m.uuid === o.group.coordinatorUuid,
    })),
  );
  const byId = new Map(speakers.map((s) => [s.uuid, s]));
  const placed = speakers.filter((s) => fp?.pins[s.uuid]);
  const unplaced = speakers.filter((s) => !fp?.pins[s.uuid]);

  // ---- fit the stage to the plan's aspect ratio inside the available space
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.min(width, height * aspect);
      setStage({ w, h: w / aspect });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const posOf = (uuid: string) => (drag?.uuid === uuid ? drag : fp?.pins[uuid]);

  // ---- dragging pins
  const nearest = (uuid: string, x: number, y: number) => {
    let best: { uuid: string; d: number } | null = null;
    for (const s of placed) {
      if (s.uuid === uuid) continue;
      const p = fp!.pins[s.uuid];
      const d = Math.hypot((p.x - x) * stage.w, (p.y - y) * stage.h);
      if (d < SNAP && (!best || d < best.d)) best = { uuid: s.uuid, d };
    }
    return best?.uuid ?? null;
  };

  const onPinDown = (e: React.PointerEvent, s: Speaker) => {
    const p = fp?.pins[s.uuid];
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, x: p.x, y: p.y, moved: false };
    setDrag({ uuid: s.uuid, x: p.x, y: p.y, target: null });
  };

  const onPinMove = (e: React.PointerEvent, s: Speaker) => {
    const st = dragStart.current;
    if (!st || drag?.uuid !== s.uuid) return;
    const dx = e.clientX - st.px, dy = e.clientY - st.py;
    if (!st.moved && Math.hypot(dx, dy) < 4) return;
    st.moved = true;
    const x = clamp(st.x + dx / stage.w), y = clamp(st.y + dy / stage.h);
    setDrag({ uuid: s.uuid, x, y, target: nearest(s.uuid, x, y) });
  };

  const onPinUp = async (s: Speaker) => {
    const st = dragStart.current;
    const d = drag;
    dragStart.current = null;
    setDrag(null);
    if (!st || !d) return;
    if (!st.moved) return setSelected((cur) => (cur === s.uuid ? null : s.uuid));
    const target = d.target ? byId.get(d.target) : null;
    if (target && target.group.id !== s.group.id) {
      // dropped onto another speaker: join its group, pin springs back
      await groupInto(s, target.group);
      return;
    }
    save({ ...fp!, pins: { ...fp!.pins, [s.uuid]: { x: d.x, y: d.y } } });
  };

  const groupInto = async (s: Speaker, g: Group) => {
    try {
      await api.joinGroup(s.ip, g.coordinatorUuid);
      toast(`${s.name} joined ${g.name}`);
      await onRegrouped();
      refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const ungroup = async (s: Speaker) => {
    try {
      await api.leaveGroup(s.ip);
      toast(`${s.name} is playing on its own`);
      await onRegrouped();
      refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  // ---- dropping unplaced speakers from the side list
  const placeAt = (uuid: string, clientX: number, clientY: number, stageEl: HTMLElement) => {
    const r = stageEl.getBoundingClientRect();
    const base = fp ?? { pins: {} };
    save({ ...base, pins: { ...base.pins, [uuid]: { x: clamp((clientX - r.left) / r.width), y: clamp((clientY - r.top) / r.height) } } });
    setSelected(uuid);
    setPlacing(null);
  };

  const onStageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const uuid = e.dataTransfer.getData("text/plain");
    if (uuid && byId.has(uuid)) placeAt(uuid, e.clientX, e.clientY, e.currentTarget as HTMLElement);
  };

  const stageRef = useRef<HTMLDivElement>(null);
  const onStageClick = (e: React.MouseEvent) => {
    if (placing && stageRef.current) return placeAt(placing, e.clientX, e.clientY, stageRef.current);
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("plan-img")) setSelected(null);
  };

  useEffect(() => {
    if (!placing) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [placing]);

  // ---- floorplan upload (downscaled so the saved JSON stays small)
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const image = await downscale(file, 2400);
      save({ pins: fp?.pins ?? {}, image });
      toast("Floorplan saved");
    } catch (e) {
      toast(`Couldn't read that image: ${errText(e)}`, true);
    }
  };

  const sel = selected ? byId.get(selected) : null;
  const selPos = sel ? posOf(sel.uuid) : null;

  return (
    <div className="overview">
      <div className="plan-wrap" ref={wrapRef}>
        <div
          ref={stageRef}
          className={`plan-stage ${fp?.image ? "" : "blank"} ${placing ? "placing" : ""}`}
          style={{ width: stage.w, height: stage.h }}
          onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "move"))}
          onDrop={onStageDrop}
          onClick={onStageClick}
        >
          {fp?.image && (
            <img className="plan-img" src={fp.image} alt="Floorplan" draggable={false}
              onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
          )}
          {placing && (
            <div className="placing-hint">Click where <b>{byId.get(placing)?.name}</b> stands · Esc to cancel</div>
          )}
          {!fp?.image && (
            <div className="plan-empty">
              <Icon.Map width={40} height={40} />
              <p>Upload a floorplan, then drag your speakers onto it.</p>
              <button className="btn primary" onClick={() => fileRef.current?.click()}>Upload floorplan</button>
              <p className="muted small">You can also place speakers on this blank grid.</p>
            </div>
          )}

          {/* group links: members connect to their coordinator; they flow while playing */}
          <svg className="plan-links" width={stage.w} height={stage.h}>
            {data.map((o) => {
              const c = posOf(o.group.coordinatorUuid);
              if (!c || o.group.members.length < 2) return null;
              const color = byId.get(o.group.coordinatorUuid)?.color;
              const playing = o.state?.transport === "PLAYING";
              return o.group.members
                .filter((m) => m.uuid !== o.group.coordinatorUuid)
                .map((m) => {
                  const p = posOf(m.uuid);
                  if (!p) return null;
                  return (
                    <line key={m.uuid} className={`plan-link ${playing ? "flow" : ""} ${hoverGroup && hoverGroup !== o.group.id ? "faded" : ""}`}
                      x1={c.x * stage.w} y1={c.y * stage.h} x2={p.x * stage.w} y2={p.y * stage.h} stroke={color} />
                  );
                });
            })}
          </svg>

          {placed.map((s) => {
            const p = posOf(s.uuid)!;
            const playing = s.state?.transport === "PLAYING";
            const dim = hoverGroup && hoverGroup !== s.group.id;
            return (
              <div key={s.uuid}
                className={`pin ${playing ? "playing" : ""} ${selected === s.uuid ? "selected" : ""} ${drag?.uuid === s.uuid ? "dragging" : ""} ${drag?.target === s.uuid ? "drop-target" : ""} ${dim ? "faded" : ""}`}
                style={{ left: p.x * stage.w, top: p.y * stage.h, "--c": s.color, "--v": s.volume } as React.CSSProperties}
                onPointerDown={(e) => onPinDown(e, s)}
                onPointerMove={(e) => onPinMove(e, s)}
                onPointerUp={() => onPinUp(s)}
                title={`${s.name} — volume ${s.volume}`}>
                <div className="pin-ring">
                  <div className="pin-disc">
                    {s.state?.track?.art ? <Art src={s.state.track.art} /> : <Icon.Speaker />}
                  </div>
                </div>
                {playing && <span className="pin-eq"><i /><i /><i /></span>}
                <div className="pin-label">
                  {s.isCoordinator && s.group.members.length > 1 && <span className="crown" title="Group coordinator">●</span>}
                  {s.name}
                </div>
              </div>
            );
          })}

          {sel && selPos && !drag && (
            <SpeakerCard
              s={sel}
              groups={data.map((o) => o.group)}
              style={{
                left: Math.min(selPos.x * stage.w + 36, stage.w - 290),
                top: Math.max(8, Math.min(selPos.y * stage.h - 40, stage.h - 330)),
              }}
              run={run}
              onJoin={(g) => groupInto(sel, g)}
              onUngroup={() => ungroup(sel)}
              onOpen={() => onOpenRoom(sel.group.id)}
              onRemove={() => {
                const pins = { ...fp!.pins };
                delete pins[sel.uuid];
                save({ ...fp!, pins });
                setSelected(null);
              }}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </div>

      <aside className="overview-side">
        <div className="panel-head">
          <h2>Groups</h2>
          <button className="link" onClick={() => fileRef.current?.click()}>{fp?.image ? "Replace plan" : "Upload plan"}</button>
          {fp?.image && <button className="link" onClick={() => confirm("Remove the floorplan image? Speaker positions are kept.") && save({ ...fp, image: undefined })}>Remove</button>}
        </div>
        <div className="group-cards">
          {data.map((o, gi) => (
            <GroupCard key={o.group.id} o={o} color={COLORS[gi % COLORS.length]} run={run}
              onHover={(h) => setHoverGroup(h ? o.group.id : null)} onOpen={() => onOpenRoom(o.group.id)} />
          ))}
          {!data.length && <p className="muted pad">Looking for speakers…</p>}
        </div>
        {unplaced.length > 0 && (
          <>
            <div className="panel-head"><h2>Not on the plan</h2></div>
            <p className="muted small pad-x">Drag onto the plan, or click one and then click its spot.</p>
            <div className="unplaced">
              {unplaced.map((s) => (
                <button key={s.uuid} className={`chip-speaker ${placing === s.uuid ? "active" : ""}`} draggable
                  style={{ "--c": s.color } as React.CSSProperties}
                  onClick={() => setPlacing((p) => (p === s.uuid ? null : s.uuid))}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", s.uuid);
                    e.dataTransfer.effectAllowed = "move";
                  }}>
                  <Icon.Speaker width={14} height={14} /> {s.name}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="muted small pad">Tip: drop a speaker onto another one to group them.</p>
      </aside>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function GroupCard({ o, color, run, onHover, onOpen }: {
  o: GroupOverview; color: string; run: Run; onHover: (h: boolean) => void; onOpen: () => void;
}) {
  const g = o.group;
  const st = o.state;
  const playing = st?.transport === "PLAYING";
  const [vol, onVol] = useVolume(g.id, st?.volume);
  return (
    <div className={`group-card ${playing ? "playing" : ""}`} style={{ "--c": color } as React.CSSProperties}
      onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="gc-top" onDoubleClick={onOpen} title="Double-click to open in the player">
        <div className="gc-art"><Art src={st?.track?.art} /></div>
        <div className="row-text">
          <div className="title">{st?.track?.title || "Nothing playing"}</div>
          <div className="sub">{st?.track?.artist ?? st?.source ?? ""}</div>
        </div>
        <button className="icon-btn sm" onClick={() => run(() => api.control(g.id, playing ? "pause" : "play"))} title={playing ? "Pause" : "Play"}>
          {playing ? <Icon.Pause /> : <Icon.Play />}
        </button>
      </div>
      <div className="gc-members">
        {g.members.map((m) => (
          <span key={m.uuid} className={m.uuid === g.coordinatorUuid ? "coord" : ""}>{m.name}</span>
        ))}
      </div>
      <div className="gc-vol">
        <Icon.Volume width={14} height={14} />
        <input type="range" className="slider" min={0} max={100} value={vol}
          style={{ "--p": `${vol}%` } as React.CSSProperties} onChange={(e) => onVol(Number(e.target.value))} />
        <span className="vol-num">{vol}</span>
      </div>
    </div>
  );
}

function SpeakerCard({ s, groups, style, run, onJoin, onUngroup, onOpen, onRemove, onClose }: {
  s: Speaker; groups: Group[]; style: React.CSSProperties; run: Run;
  onJoin: (g: Group) => void; onUngroup: () => void; onOpen: () => void; onRemove: () => void; onClose: () => void;
}) {
  const [vol, setVol] = useState(s.volume);
  const timer = useRef<number | undefined>(undefined);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setVol(s.volume);
  }, [s.volume]);
  const onVol = (v: number) => {
    editing.current = true;
    setVol(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.setMemberVolume(s.ip, v).finally(() => setTimeout(() => (editing.current = false), 1500));
    }, 100);
  };
  const t = s.state?.track;
  const playing = s.state?.transport === "PLAYING";
  const others = groups.filter((g) => g.id !== s.group.id);

  return (
    <div className="speaker-card popover" style={{ ...style, "--c": s.color } as React.CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="sc-head">
        <span className="sc-dot" />
        <b>{s.name}</b>
        <button className="icon-btn xs" onClick={onClose}><Icon.X /></button>
      </div>
      <div className="muted small">
        {s.group.members.length > 1
          ? `${s.isCoordinator ? "Leads" : "In"} a group of ${s.group.members.length}`
          : "Playing on its own"} · {s.ip}
      </div>
      <div className="sc-now">
        <div className="sc-art"><Art src={t?.art} /></div>
        <div className="row-text">
          <div className="title">{t?.title || "Nothing playing"}</div>
          <div className="sub">{t?.artist ?? s.state?.source ?? ""}</div>
        </div>
      </div>
      <div className="sc-transport">
        <button className="icon-btn" onClick={() => run(() => api.control(s.group.id, "previous"))}><Icon.Prev /></button>
        <button className="play-btn sm" onClick={() => run(() => api.control(s.group.id, playing ? "pause" : "play"))}>
          {playing ? <Icon.Pause width={16} height={16} /> : <Icon.Play width={16} height={16} />}
        </button>
        <button className="icon-btn" onClick={() => run(() => api.control(s.group.id, "next"))}><Icon.Next /></button>
      </div>
      <label className="sc-vol">
        <span>This speaker</span>
        <input type="range" className="slider" min={0} max={100} value={vol}
          style={{ "--p": `${vol}%` } as React.CSSProperties} onChange={(e) => onVol(Number(e.target.value))} />
        <span className="vol-num">{vol}</span>
      </label>
      <div className="sc-actions">
        {others.length > 0 && (
          <select value="" onChange={(e) => {
            const g = others.find((x) => x.id === e.target.value);
            if (g) onJoin(g);
          }}>
            <option value="" disabled>Group with…</option>
            {others.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {s.group.members.length > 1 && <button className="btn" onClick={onUngroup}>Ungroup</button>}
      </div>
      <div className="sc-foot">
        <button className="link" onClick={onOpen}>Open in player</button>
        <button className="link" onClick={onRemove}>Remove from plan</button>
      </div>
    </div>
  );
}

const clamp = (v: number) => Math.max(0.02, Math.min(0.98, v));

/** Read an image file and shrink it so the longest side is ≤ max px. */
async function downscale(file: File, max: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/webp", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
