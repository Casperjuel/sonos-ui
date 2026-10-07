import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as Icon from "./icons";

const REPO = "https://github.com/casperjuel/sponos";

const FEATURES: { icon: keyof typeof Icon; title: string; text: string }[] = [
  { icon: "Search", title: "Spotify built in", text: "Search and queue songs, albums and playlists." },
  { icon: "ThumbUp", title: "Shared queue", text: "Vote songs up or down and see who added what." },
  { icon: "Map", title: "Floorplan", text: "Every room at a glance: groups, volume, what's playing." },
  { icon: "Minimize", title: "Mini player", text: "A small always-on-top player, plus menu bar controls." },
  { icon: "Speaker", title: "Office and home", text: "Switches between Sonos systems on its own." },
  { icon: "Refresh", title: "Always up to date", text: "New versions install themselves." },
];

export function About({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");
  const [build, setBuild] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion);
    invoke<string | null>("build_info").then(setBuild);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about">
        <button className="icon-btn sm setup-close" onClick={onClose} title="Close"><Icon.X /></button>
        <header className="about-head">
          <img src="/icon.png" alt="" className="about-icon" />
          <div>
            <h2>Sponos</h2>
            <p className="muted">
              Version {version}
              {build && <> · build <code>{build}</code></>}
            </p>
          </div>
        </header>
        <p className="about-tagline">A nicer way to play music on Sonos, with Spotify built in.</p>

        <ul className="about-features">
          {FEATURES.map((f) => {
            const I = Icon[f.icon];
            return (
              <li key={f.title}>
                <span className="about-feature-icon"><I width={16} height={16} /></span>
                <b>{f.title}</b>
                <small>{f.text}</small>
              </li>
            );
          })}
        </ul>

        <p className="muted small about-privacy">
          Floorplans, votes and room names are shared with everyone on the same Sonos system, end-to-end encrypted.
          Only devices that can reach your speakers can read them.
        </p>

        <div className="about-actions">
          <button className="btn" onClick={() => (emit("tray", "check-updates"), onClose())}>Check for updates</button>
          <button className="btn" onClick={() => openUrl(REPO)}>GitHub ↗</button>
          <button className="btn" onClick={() => openUrl(`${REPO}/issues/new`)}>Report a problem ↗</button>
        </div>

        <footer className="about-foot muted small">
          Made by Casper Juel · Built with Tauri, Rust and React · Not affiliated with Sonos or Spotify
        </footer>
      </div>
    </div>
  );
}
