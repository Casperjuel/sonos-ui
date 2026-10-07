/**
 * Cursor-following light on glass surfaces. One pointermove listener writes
 * the pointer position (relative to whichever glass panel is under it) into
 * --mx / --my; the CSS draws a soft radial highlight there. rAF-throttled,
 * and a no-op outside the glass theme.
 */
const SURFACES = ".sidebar, .queue, .browse, .mini, .card, .popover, .modal, .search, .play-btn, .pin";

export function initSheen() {
  let frame = 0;
  let last: HTMLElement | null = null;
  window.addEventListener(
    "pointermove",
    (e) => {
      if (frame || document.documentElement.dataset.theme !== "glass") return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = (e.target as Element | null)?.closest?.(SURFACES) as HTMLElement | null;
        if (last && last !== el) last.classList.remove("lit");
        last = el;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
        el.classList.add("lit");
      });
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => last?.classList.remove("lit"));
}
