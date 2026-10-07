import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Checks GitHub releases for a newer signed build, downloads it quietly and offers a restart. */
export function UpdatePill() {
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return; // dev builds aren't installed apps
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const update = await check();
        if (update) {
          await update.downloadAndInstall();
          setReady(update.version);
          clearInterval(timer);
        }
      } catch (e) {
        console.warn("update check failed", e);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(run, 6 * 3600_000);
    run();
    return () => clearInterval(timer);
  }, []);

  if (!ready) return null;
  return (
    <div className="update-pill">
      <span>Sponos {ready} is ready</span>
      <button className="btn primary" onClick={() => relaunch()}>Restart</button>
    </div>
  );
}
