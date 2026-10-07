import { LIKED, type Group, type Household, type Me, type SpItem } from "./api";
import { Art } from "./Browse";
import * as Icon from "./icons";

type Props = {
  households: Household[];
  household: string | null;
  onHousehold: (id: string) => void;
  groups: Group[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  error: string | null;
  me: Me | null;
  playlists: SpItem[];
  open: SpItem | null;
  onOpen: (item: SpItem) => void;
  onLogin: () => void;
};

export function Sidebar({ households, household, onHousehold, groups, selected, onSelect, onRefresh, error, me, playlists, open, onOpen, onLogin }: Props) {
  const current = households.find((h) => h.id === household);
  return (
    <aside className="sidebar">
      <div className="panel-head">
        {households.length > 1 ? (
          // two systems on one network: let the user pick
          <select className="system-pick" value={household ?? ""} onChange={(e) => onHousehold(e.target.value)} title="Sonos system">
            {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        ) : (
          <h2 title={current ? `${current.name} · ${current.speakers} speakers` : undefined}>{current?.name ?? "Rooms"}</h2>
        )}
        <button className="icon-btn xs" onClick={onRefresh} title="Rediscover"><Icon.Refresh /></button>
      </div>
      <ul className="room-list">
        {groups.map((g) => (
          <li key={g.id}>
            <button className={`room ${g.id === selected ? "active" : ""}`} onClick={() => onSelect(g.id)}>
              <Icon.Speaker />
              <span className="room-text">
                <span className="room-name">{g.members.find((m) => m.uuid === g.coordinatorUuid)?.name ?? g.name}</span>
                {g.members.length > 1 && (
                  <span className="room-sub">
                    + {g.members.filter((m) => m.uuid !== g.coordinatorUuid).map((m) => m.name).join(", ")}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!groups.length && <p className="muted pad">{error ?? "Looking for speakers…"}</p>}

      <div className="panel-head library-head">
        <h2>Your library</h2>
        {me?.image && <img className="avatar" src={me.image} alt="" title={me.name} />}
      </div>
      {me ? (
        <ul className="lib-list">
          {[LIKED, ...playlists].map((p) => (
            <li key={p.kind + p.id}>
              <button className={`lib-item ${open?.id === p.id ? "active" : ""}`} onClick={() => onOpen(p)}>
                {p.kind === "liked" ? <div className="art liked"><Icon.Heart /></div> : <Art src={p.image} />}
                <span className="room-text">
                  <span className="room-name">{p.name}</span>
                  <span className="room-sub">{p.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pad">
          <p className="muted small">Log in to see your playlists and liked songs.</p>
          <button className="btn primary" onClick={onLogin}>Log in to Spotify</button>
        </div>
      )}
    </aside>
  );
}
