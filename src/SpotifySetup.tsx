import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type Me, type Settings } from "./api";
import { errText } from "./App";
import * as Icon from "./icons";

const REDIRECT = "http://127.0.0.1:8888/callback";
const DASHBOARD = "https://developer.spotify.com/dashboard/create";

type Step = "intro" | "create" | "keys" | "connect" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "create", label: "Create app" },
  { id: "keys", label: "Paste keys" },
  { id: "connect", label: "Connect" },
];

type Props = {
  me: Me | null;
  /** logs in with whatever client ID is saved; throws on failure */
  connect: () => Promise<Me | null>;
  onClose: () => void;
};

/**
 * Guided setup for your own Spotify app. Spotify only lets 5 accounts log in
 * to an app in development mode, so everyone gets their own app: then they're
 * its owner and can use every feature.
 */
export function SpotifySetup({ me, connect, onClose }: Props) {
  const [step, setStep] = useState<Step>(me ? "done" : "intro");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [who, setWho] = useState<Me | null>(me);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setId(s.spotifyClientId);
      setSecret(s.spotifyClientSecret);
      // set up before: just log in again
      if (s.spotifyClientId) setStep((cur) => (cur === "intro" ? "connect" : cur));
    });
  }, []);

  useEffect(() => setError(null), [step]);

  const copy = () => {
    navigator.clipboard.writeText(REDIRECT);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /** save the pair, then log in through the browser */
  const save = async (clientId: string, clientSecret: string) => {
    if (!settings) return;
    const next = { ...settings, spotifyClientId: clientId, spotifyClientSecret: clientSecret };
    await api.saveSettings(next);
    setSettings(next);
  };

  const checkKeys = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.checkSpotifyApp(id.trim(), secret.trim());
      await save(id.trim(), secret.trim());
      setStep("connect");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await connect();
      if (m) {
        setWho(m);
        setStep("done");
      }
    } catch (e) {
      const msg = errText(e);
      setError(
        /redirect/i.test(msg)
          ? `Spotify didn't accept the redirect URI. In your app's settings, add exactly ${REDIRECT} under Redirect URIs and save.`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  /** people on the owner's list of 5 can use the built-in app */
  const useBuiltIn = async () => {
    setBusy(true);
    try {
      await save("", settings?.spotifyClientSecret ?? "");
      setStep("connect");
    } finally {
      setBusy(false);
    }
  };

  const index = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal setup">
        <button className="icon-btn sm setup-close" onClick={onClose} title="Close"><Icon.X /></button>

        {index >= 0 && (
          <ol className="setup-steps">
            {STEPS.map((s, i) => (
              <li key={s.id} className={i < index ? "done" : i === index ? "now" : ""}>
                <span>{i < index ? "✓" : i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
        )}

        {step === "intro" && (
          <section>
            <div className="setup-hero"><Icon.Music width={28} height={28} /></div>
            <h2>Connect Spotify</h2>
            <p>
              Search and queueing already work. Connect your Spotify account to also get <b>your playlists</b>,{" "}
              <b>liked songs</b>, and your <b>face on songs you add</b>.
            </p>
            <p className="muted">
              Spotify lets only 5 people log in to an app like this one, so you'll make your own (free, about 3 minutes).
              You need Spotify Premium.
            </p>
            <div className="setup-actions">
              <button className="btn primary" onClick={() => setStep("create")}>Set it up</button>
              <button className="btn" onClick={onClose}>Not now</button>
            </div>
            <button className="link small" disabled={busy} onClick={useBuiltIn}>
              Already added to the built-in app by its owner? Log in directly
            </button>
          </section>
        )}

        {step === "create" && (
          <section>
            <h2>Create your Spotify app</h2>
            <p className="muted">Log in to Spotify's developer site with your normal Spotify account.</p>
            <button className="btn primary wide" onClick={() => openUrl(DASHBOARD)}>
              Open Spotify developer dashboard ↗
            </button>
            <ol className="checklist">
              <li><b>App name</b>: Sponos (anything works). <b>Description</b>: anything.</li>
              <li>
                <b>Redirect URI</b>: paste this and click <b>Add</b>
                <div className="copy-row">
                  <code>{REDIRECT}</code>
                  <button className="btn small" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
                </div>
              </li>
              <li>Under "Which API/SDKs are you planning to use?", tick <b>Web API</b>.</li>
              <li>Accept the terms and click <b>Save</b>.</li>
            </ol>
            <div className="setup-actions">
              <button className="btn" onClick={() => setStep("intro")}>Back</button>
              <button className="btn primary" onClick={() => setStep("keys")}>I've created it</button>
            </div>
          </section>
        )}

        {step === "keys" && (
          <section>
            <h2>Paste your app's keys</h2>
            <p className="muted">
              In your new app, open <b>Settings</b>. Copy the <b>Client ID</b>, then click <b>View client secret</b> and copy that too.
            </p>
            <label>
              Client ID
              <input autoFocus value={id} placeholder="32 letters and numbers" spellCheck={false}
                onChange={(e) => setId(e.target.value.trim())} />
            </label>
            <label>
              Client secret
              <input type="password" value={secret} placeholder="32 letters and numbers" spellCheck={false}
                onChange={(e) => setSecret(e.target.value.trim())} />
            </label>
            <p className="muted small">The keys stay on this Mac. The secret lets search use your own app.</p>
            {error && <div className="setup-error">{error}</div>}
            <div className="setup-actions">
              <button className="btn" onClick={() => setStep("create")}>Back</button>
              <button className="btn primary" disabled={busy || !id} onClick={checkKeys}>
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          </section>
        )}

        {step === "connect" && (
          <section>
            <h2>Connect your account</h2>
            <p className="muted">
              Your browser opens Spotify. Click <b>Agree</b>, then come back here.
            </p>
            {error && <div className="setup-error">{error}</div>}
            {settings?.spotifyClientId && (
              <button className="link small" onClick={() => setStep("create")}>Set up with a different Spotify app</button>
            )}
            <div className="setup-actions">
              <button className="btn" onClick={() => setStep(settings?.spotifyClientId ? "keys" : "intro")}>Back</button>
              <button className="btn primary" disabled={busy} onClick={login}>
                {busy ? "Waiting for Spotify…" : "Log in to Spotify"}
              </button>
            </div>
          </section>
        )}

        {step === "done" && (
          <section className="setup-done">
            {who?.image ? <img className="avatar xl" src={who.image} alt="" /> : <div className="setup-hero">✓</div>}
            <h2>You're all set{who ? `, ${who.name.split(" ")[0]}` : ""}</h2>
            <p className="muted">Your playlists and liked songs are in the sidebar. Songs you add show your face to others in the queue.</p>
            <div className="setup-actions">
              <button className="btn primary" onClick={onClose}>Done</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
