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
  /** bumps when someone else on this system changed the floorplan */
  syncTick: number;
  run: Run;
  toast: ToastFn;
  /** rediscover topology after grouping changes */
  onRegrouped: () => Promise<void>;
  onOpenRoom: (groupId: string) => void;
};

/** zoom limits; 1 = the plan fitted to the window */
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
type View = { k: number; x: number; y: number };
const FIT: View = { k: 1, x: 0, y: 0 };

export function Overview({ syncTick, run, toast, onRegrouped, onOpenRoom }: Props) {
  const [data, setData] = useState<GroupOverview[]>([]);
  const [fp, setFp] = useState<Floorplan | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  /** speakers can only be moved while organizing, so panning never moves one by accident */
  const [organize, setOrganize] = useState(false);
  /** click-to-place: a speaker picked from the side list, waiting for a click on the plan */
  const [placing, setPlacing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ uuid: string; x: number; y: number; target: string | null } | null>(null);
  const dragStart = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [aspect, setAspect] = useState(16 / 10);
  /** the fitted plan size and the space around it */
  const [geo, setGeo] = useState({ W: 0, H: 0, w: 0, h: 0 });
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [view, setView] = useState<View>(FIT);
  /** buttons, keys and double-clicks glide; gestures follow the fingers */
  const [gliding, setGliding] = useState(false);
  const [panning, setPanning] = useState(false);
  /** the webview has no confirm(): a second click confirms */
  const [askRemove, setAskRemove] = useState(false);

  // ---- data
  const refresh = useCallback(() => api.overview().then(setData).catch(() => {}), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);
  const firstLoad = useRef(true);
  useEffect(() => {
    api.getFloorplan().then((f) => {
      setFp(f);
      // nothing placed yet: start in organize mode
      if (firstLoad.current) setOrganize(!Object.keys(f.pins).length);
      firstLoad.current = false;
    });
  }, [syncTick]);

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

  // ---- fit the plan's aspect ratio inside the available space
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const { width: W, height: H } = el.getBoundingClientRect();
      const pad = 40;
      const w = Math.max(0, Math.min(W - pad, (H - pad) * aspect));
      setGeo({ W, H, w, h: w / aspect });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // ---- camera
  /** keep at least a quarter of the plan on screen */
  const clampView = (v: View): View => {
    const { W, H, w, h } = geoRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k));
    const ox = (W - w) / 2, oy = (H - h) / 2;
    const cx = (lo: number, hi: number, x: number) => Math.min(hi, Math.max(lo, x));
    return {
      k,
      x: cx(W * 0.25 - ox - w * k, W * 0.75 - ox, v.x),
      y: cx(H * 0.25 - oy - h * k, H * 0.75 - oy, v.y),
    };
  };
  /** zoom to `k` keeping the point (px, py) in the viewport still */
  const zoomAt = (v: View, k: number, px: number, py: number): View => {
    const { W, H, w, h } = geoRef.current;
    const ox = (W - w) / 2, oy = (H - h) / 2;
    const k2 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
    const sx = (px - ox - v.x) / v.k, sy = (py - oy - v.y) / v.k;
    return clampView({ k: k2, x: px - ox - sx * k2, y: py - oy - sy * k2 });
  };
  const glide = (next: (v: View) => View) => {
    setGliding(true);
    setView((v) => next(v));
    window.setTimeout(() => setGliding(false), 320);
  };
  const zoomBy = (f: number) => glide((v) => zoomAt(v, v.k * f, geoRef.current.W / 2, geoRef.current.H / 2));
  const fitPlan = () => glide(() => FIT);

  // trackpad: pinch zooms (ctrlKey), two fingers pan; mouse: ⌘ + wheel zooms
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".speaker-card")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.003));
        setView((v) => zoomAt(v, v.k * f, px, py));
      } else {
        setView((v) => clampView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // keys: + / − / 0, and Esc leaves placing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      if (e.key === "+" || e.key === "=") zoomBy(1.5);
      else if (e.key === "-") zoomBy(1 / 1.5);
      else if (e.key === "0") fitPlan();
      else if (e.key === "Escape") setPlacing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // drag the background (or a speaker, when not organizing) to pan; a click without moving selects
  const pan = useRef<{ px: number; py: number; x: number; y: number; moved: boolean; pin: string | null } | null>(null);
  const onWrapDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".speaker-card, .plan-ui, .plan-empty button")) return;
    const pin = (e.target as HTMLElement).closest<HTMLElement>("[data-uuid]")?.dataset.uuid ?? null;
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false, pin };
  };
  const onWrapMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.px, dy = e.clientY - p.py;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    if (!p.moved) setPanning(true);
    p.moved = true;
    setView((v) => clampView({ ...v, x: p.x + dx, y: p.y + dy }));
  };
  const onWrapUp = (e: React.PointerEvent) => {
    const p = pan.current;
    pan.current = null;
    setPanning(false);
    if (!p || p.moved) return;
    if (placing && stageRef.current) return placeAt(placing, e.clientX, e.clientY, stageRef.current);
    setSelected((cur) => (p.pin ? (cur === p.pin ? null : p.pin) : null));
  };
  const onWrapDouble = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".speaker-card, .plan-ui, [data-uuid]")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    glide((v) => (v.k >= MAX_ZOOM - 0.01 ? FIT : zoomAt(v, v.k * 2, px, py)));
  };

  const posOf = (uuid: string) => (drag?.uuid === uuid ? drag : fp?.pins[uuid]);
  const k = view.k;
  const tx = (geo.W - geo.w) / 2 + view.x;
  const ty = (geo.H - geo.h) / 2 + view.y;
  /** plan fraction → position in the (unscaled) speaker layer */
  const at = (p: { x: number; y: number }) => ({ left: p.x * geo.w * k, top: p.y * geo.h * k });

  // ---- moving speakers (organize mode)
  const nearest = (uuid: string, x: number, y: number) => {
    let best: { uuid: string; d: number } | null = null;
    for (const s of placed) {
      if (s.uuid === uuid) continue;
      const p = fp!.pins[s.uuid];
      const d = Math.hypot((p.x - x) * geo.w * k, (p.y - y) * geo.h * k);
      if (d < SNAP && (!best || d < best.d)) best = { uuid: s.uuid, d };
    }
    return best?.uuid ?? null;
  };

  const onPinDown = (e: React.PointerEvent, s: Speaker) => {
    if (!organize) return; // let it bubble: the plan pans
    e.stopPropagation();
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
    const x = clamp(st.x + dx / (geo.w * k)), y = clamp(st.y + dy / (geo.h * k));
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

  // ---- adding speakers from the side list
  const placeAt = (uuid: string, clientX: number, clientY: number, stageEl: HTMLElement) => {
    const r = stageEl.getBoundingClientRect(); // already zoomed and panned
    const base = fp ?? { pins: {} };
    save({ ...base, pins: { ...base.pins, [uuid]: { x: clamp((clientX - r.left) / r.width), y: clamp((clientY - r.top) / r.height) } } });
    setSelected(uuid);
    setPlacing(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const uuid = e.dataTransfer.getData("text/plain");
    if (uuid && byId.has(uuid) && stageRef.current) placeAt(uuid, e.clientX, e.clientY, stageRef.current);
  };

  // ---- floorplan upload (downscaled so the saved JSON stays small)
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const image = await downscale(file, 2400);
      save({ pins: fp?.pins ?? {}, image });
      fitPlan();
      toast("Floorplan saved");
    } catch (e) {
      toast(`Couldn't read that image: ${errText(e)}`, true);
    }
  };

  const sel = selected ? byId.get(selected) : null;
  const selPos = sel ? posOf(sel.uuid) : null;

  return (
    <div className="overview">
      <div
        ref={wrapRef}
        className={`plan-wrap ${gliding ? "gliding" : ""} ${panning ? "panning" : ""} ${organize ? "organizing" : ""} ${placing ? "placing" : ""}`}
        onPointerDown={onWrapDown}
        onPointerMove={onWrapMove}
        onPointerUp={onWrapUp}
        onPointerCancel={() => ((pan.current = null), setPanning(false))}
        onDoubleClick={onWrapDouble}
        onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "move"))}
        onDrop={onDrop}
      >
        {/* the plan itself zooms… */}
        <div
          ref={stageRef}
          className={`plan-stage ${fp?.image ? "" : "blank"}`}
          style={{ width: geo.w, height: geo.h, transform: `translate(${tx}px, ${ty}px) scale(${k})` }}
        >
          {fp?.image && (
            <img className="plan-img" src={fp.image} alt="Floorplan" draggable={false}
              onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
          )}
          {/* group links: members connect to their coordinator; they flow while playing */}
          <svg className="plan-links" width={geo.w} height={geo.h}>
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
                      x1={c.x * geo.w} y1={c.y * geo.h} x2={p.x * geo.w} y2={p.y * geo.h} stroke={color} />
                  );
                });
            })}
          </svg>
        </div>

        {!fp?.image && (
          <div className="plan-empty">
            <Icon.Map width={40} height={40} />
            <p>Upload a floorplan, then drag your speakers onto it.</p>
            <button className="btn primary" onClick={() => fileRef.current?.click()}>Upload floorplan</button>
            <p className="muted small">You can also place speakers on this blank grid.</p>
          </div>
        )}

        {/* …the speakers only move with it, so they stay the same size */}
        <div className="plan-pins" style={{ transform: `translate(${tx}px, ${ty}px)` }}>
          {placed.map((s) => {
            const p = posOf(s.uuid)!;
            const playing = s.state?.transport === "PLAYING";
            const dim = hoverGroup && hoverGroup !== s.group.id;
            return (
              <div key={s.uuid} data-uuid={s.uuid}
                className={`pin ${organize ? "editable" : ""} ${playing ? "playing" : ""} ${selected === s.uuid ? "selected" : ""} ${drag?.uuid === s.uuid ? "dragging" : ""} ${drag?.target === s.uuid ? "drop-target" : ""} ${dim ? "faded" : ""}`}
                style={{ ...at(p), "--c": s.color, "--v": s.volume } as React.CSSProperties}
                onPointerDown={(e) => onPinDown(e, s)}
                onPointerMove={(e) => onPinMove(e, s)}
                onPointerUp={(e) => organize && (e.stopPropagation(), onPinUp(s))}
                title={`${s.name} · volume ${s.volume}`}>
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
                left: Math.max(8 - tx, Math.min(at(selPos).left + 36, geo.W - tx - 290)),
                top: Math.max(8 - ty, Math.min(at(selPos).top - 40, geo.H - ty - 330)),
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

        {/* controls float above the plan */}
        <div className="plan-ui plan-toolbar">
          <button className={`organize-btn ${organize ? "on" : ""}`} onClick={() => (setOrganize((o) => !o), setPlacing(null), setDrag(null))}>
            {organize ? <><Icon.Check width={15} height={15} /> Done</> : <><Icon.Move width={15} height={15} /> Organize speakers</>}
          </button>
          {organize && (
            <span className="organize-hint">
              {placing ? <>Click where <b>{byId.get(placing)?.name}</b> stands · Esc to cancel</> : "Drag speakers to move them. Drop one on another to group them."}
            </span>
          )}
        </div>
        <div className="plan-ui plan-zoom">
          <button className="icon-btn sm" onClick={() => zoomBy(1 / 1.5)} disabled={k <= MIN_ZOOM} title="Zoom out (−)"><Icon.ZoomOut /></button>
          <button className="zoom-level" onClick={fitPlan} title="Fit to window (0)">{Math.round(k * 100)}%</button>
          <button className="icon-btn sm" onClick={() => zoomBy(1.5)} disabled={k >= MAX_ZOOM} title="Zoom in (+)"><Icon.ZoomIn /></button>
        </div>
      </div>

      <aside className="overview-side">
        <div className="panel-head">
          <h2>Groups</h2>
        </div>
        <div className="group-cards">
          {data.map((o, gi) => (
            <GroupCard key={o.group.id} o={o} color={COLORS[gi % COLORS.length]} run={run}
              onHover={(h) => setHoverGroup(h ? o.group.id : null)} onOpen={() => onOpenRoom(o.group.id)} />
          ))}
          {!data.length && <p className="muted pad">Looking for speakers…</p>}
        </div>
        {organize && (
          <div className="organize-side">
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
            <div className="panel-head"><h2>Floorplan image</h2></div>
            <div className="plan-file pad-x">
              <button className="btn small" onClick={() => fileRef.current?.click()}>{fp?.image ? "Replace" : "Upload"}</button>
              {fp?.image && (
                <button className={`btn small ${askRemove ? "danger" : ""}`}
                  onClick={() => (askRemove ? (save({ ...fp, image: undefined }), setAskRemove(false)) : setAskRemove(true))}
                  onMouseLeave={() => setAskRemove(false)}>
                  {askRemove ? "Remove image? Speakers stay" : "Remove"}
                </button>
              )}
            </div>
          </div>
        )}
        <p className="muted small pad">
          {organize ? "Tip: drop a speaker onto another one to group them." : "Pinch or ⌘-scroll to zoom, drag to move around. Click a speaker for its controls."}
        </p>
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
