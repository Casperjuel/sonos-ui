import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { ToastFn } from "./App";

/** Checks GitHub releases for a newer signed build, downloads it quietly and offers a restart. */
export function UpdatePill({ toast }: { toast: ToastFn }) {
  const [ready, setReady] = useState<string | null>(null);
  const busy = useRef(false);

  /** `manual`: from "Check for Updates…", so say what happened either way */
  const run = useCallback(
    async (manual: boolean) => {
      if (import.meta.env.DEV) return manual && toast("Updates only work in the installed app");
      if (busy.current || ready) return manual && ready && toast(`Sponos ${ready} is ready. Restart to use it.`);
      busy.current = true;
      try {
        if (manual) toast("Checking for updates…");
        const update = await check();
        if (update) {
          if (manual) toast(`Downloading Sponos ${update.version}…`);
          await update.downloadAndInstall();
          setReady(update.version);
        } else if (manual) {
          toast(`You're on the latest version (${await getVersion()})`);
        }
      } catch (e) {
        console.warn("update check failed", e);
        if (manual) toast("Couldn't check for updates. Are you online?", true);
      } finally {
        busy.current = false;
      }
    },
    [ready, toast],
  );

  useEffect(() => {
    run(false);
    const timer = setInterval(() => run(false), 6 * 3600_000);
    const un = listen<string>("tray", ({ payload }) => payload === "check-updates" && run(true));
    return () => (clearInterval(timer), void un.then((f) => f()));
  }, [run]);

  if (!ready) return null;
  return (
    <div className="update-pill">
      <span>Sponos {ready} is ready</span>
      <button className="btn primary" onClick={() => relaunch()}>Restart</button>
    </div>
  );
}
