import { invoke } from "@tauri-apps/api/core";

export type Member = { uuid: string; ip: string; name: string };
export type Group = {
  id: string;
  coordinatorUuid: string;
  coordinatorIp: string;
  name: string;
  members: Member[];
};
export type Item = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  art?: string;
  duration?: string;
  uri?: string;
};
export type PlayerState = {
  transport: "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED" | "TRANSITIONING" | "NO_MEDIA_PRESENT" | string;
  playMode: string;
  volume: number;
  muted: boolean;
  trackNo: number;
  queueActive: boolean;
  position: number;
  duration: number;
  track?: Item;
  source?: string;
};
export type SpKind = "track" | "album" | "artist" | "playlist" | "liked";
export type SpItem = {
  kind: SpKind;
  id: string;
  name: string;
  subtitle: string;
  image?: string;
  durationMs?: number;
};
export type SearchResult = { tracks: SpItem[]; albums: SpItem[]; artists: SpItem[]; playlists: SpItem[] };
export type Settings = {
  spotifyClientId: string;
  spotifyClientSecret: string;
  market: string;
  seedIps: string[];
  spotifySid?: number | null;
  spotifySn?: number | null;
};
export type SpotifyLink = { sid: number; sn: number; desc: string; detected: boolean };
export type MemberVol = Member & { volume: number };
export type QueueMode = "now" | "next" | "end";
export type Me = { name: string; image?: string };
export type PlayerQueue = { current?: SpItem; queue: SpItem[] };
export const LIKED: SpItem = { kind: "liked", id: "liked", name: "Liked Songs", subtitle: "Your library" };

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  discover: () => invoke<Discovery>("discover"),
  setHousehold: (id: string) => invoke<Discovery>("set_household", { id }),
  renameHousehold: (id: string, name: string) => invoke<void>("rename_household", { id, name }),
  state: (group: string) => invoke<PlayerState>("get_state", { group }),
  queue: (group: string) => invoke<Item[]>("get_queue", { group }),
  members: (group: string) => invoke<MemberVol[]>("get_members", { group }),
  setMemberVolume: (ip: string, volume: number) => invoke<void>("set_member_volume", { ip, volume }),
  control: (group: string, action: "play" | "pause" | "next" | "previous") =>
    invoke<void>("control", { group, action }),
  seek: (group: string, seconds: number) => invoke<void>("seek", { group, seconds }),
  setVolume: (group: string, volume: number) => invoke<void>("set_volume", { group, volume }),
  setMute: (group: string, muted: boolean) => invoke<void>("set_mute", { group, muted }),
  setPlayMode: (group: string, mode: string) => invoke<void>("set_play_mode", { group, mode }),
  playIndex: (group: string, n: number) => invoke<void>("play_index", { group, n }),
  removeIndex: (group: string, n: number) => invoke<void>("remove_index", { group, n }),
  moveIndex: (group: string, from: number, before: number) => invoke<void>("move_index", { group, from, before }),
  clearQueue: (group: string) => invoke<void>("clear_queue", { group }),
  spotifyLink: (group: string) => invoke<SpotifyLink>("spotify_link", { group }),
  search: (q: string) => invoke<SearchResult>("spotify_search", { q }),
  children: (item: SpItem) => invoke<SpItem[]>("spotify_children", { kind: item.kind, id: item.id, name: item.name }),
  login: () => invoke<Me | null>("spotify_login"),
  logout: () => invoke<void>("spotify_logout"),
  me: () => invoke<Me | null>("spotify_me"),
  playlists: () => invoke<SpItem[]>("spotify_playlists"),
  playerQueue: () => invoke<PlayerQueue | null>("spotify_player_queue"),
  queueTracks: (group: string, items: SpItem[], mode: QueueMode) =>
    invoke<Queued>("queue_tracks", { group, items: items.map((i) => ({ kind: i.kind, id: i.id, title: i.name })), mode }),
  queueSpotify: (group: string, item: Pick<SpItem, "kind" | "id" | "name">, mode: QueueMode) =>
    invoke<Queued>("queue_spotify", { group, kind: item.kind, id: item.id, title: item.name, mode }),
  overview: () => invoke<GroupOverview[]>("overview"),
  joinGroup: (memberIp: string, coordinatorUuid: string) => invoke<void>("join_group", { memberIp, coordinatorUuid }),
  leaveGroup: (memberIp: string) => invoke<void>("leave_group", { memberIp }),
  getFloorplan: async (): Promise<Floorplan> => {
    const raw = await invoke<string | null>("get_floorplan");
    try {
      return { pins: {}, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { pins: {} };
    }
  },
  saveFloorplan: (fp: Floorplan) => invoke<void>("save_floorplan", { json: JSON.stringify(fp) }),
  /** the logged-in user's Spotify Connect queue */
  addToSpotifyQueue: (id: string) => invoke<void>("spotify_add_to_player_queue", { id }),
};

/** a Sonos system ("household"), e.g. Office or Home */
export type Household = { id: string; name: string; speakers: number };
export type Discovery = { households: Household[]; active: string; groups: Group[] };

export type GroupOverview ={ group: Group; state: PlayerState | null; volumes: Record<string, number> };
/** pin positions are fractions (0–1) of the plan's width/height, keyed by speaker UUID */
export type Floorplan = { image?: string; pins: Record<string, { x: number; y: number }> };

/** where Sonos put it: "top" means the queue wasn't playing, so it can't go after the current song */
export type Queued = { added: number; placed: "afterCurrent" | "top" | "end" };

/** loose title match — Sonos and Spotify disagree on "- Remastered" suffixes etc. */
export const sameTitle = (a?: string, b?: string) => {
  const n = (s?: string) => (s ?? "").toLowerCase().replace(/\s*[-(\[].*$/, "").trim();
  return !!a && !!b && n(a) === n(b);
};

// Sonos encodes shuffle + repeat as one enum
export const playModes = {
  decode(m: string) {
    return {
      shuffle: m.startsWith("SHUFFLE"),
      repeat: m === "REPEAT_ALL" || m === "SHUFFLE" ? "all" : m.endsWith("REPEAT_ONE") ? "one" : "off",
    } as { shuffle: boolean; repeat: "off" | "all" | "one" };
  },
  encode(shuffle: boolean, repeat: "off" | "all" | "one") {
    if (shuffle) return repeat === "all" ? "SHUFFLE" : repeat === "one" ? "SHUFFLE_REPEAT_ONE" : "SHUFFLE_NOREPEAT";
    return repeat === "all" ? "REPEAT_ALL" : repeat === "one" ? "REPEAT_ONE" : "NORMAL";
  },
};

export const fmt = (s: number) => {
  if (!s || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s / 60) % 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

export const hms = (s?: string) =>
  (s ?? "").split(":").reduce((a, p) => a * 60 + (Number(p) || 0), 0);
