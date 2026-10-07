import { Effect, EffectState, getCurrentWindow } from "@tauri-apps/api/window";

export type ThemeId = "classic" | "glass";

export const THEMES: { id: ThemeId; name: string; description: string }[] = [
  { id: "classic", name: "Classic", description: "Flat and dark, like the Sonos desktop app" },
  { id: "glass", name: "Glass", description: "Frosted 3D glass that takes its colour from the cover" },
];

/** Tunables for the glass theme, all 0–100. */
export type GlassPrefs = {
  /** how see-through the panels are */
  transparency: number;
  /** frosting strength */
  blur: number;
  /** how strongly the cover art paints the backdrop; low lets the desktop show through */
  cover: number;
  /** micro-animations on/off */
  motion: boolean;
};

export const DEFAULT_GLASS: GlassPrefs = { transparency: 55, blur: 60, cover: 80, motion: true };

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : { ...fallback, ...JSON.parse(v) };
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
};

export function savedTheme(): ThemeId {
  try {
    const t = localStorage.getItem("theme");
    return THEMES.some((x) => x.id === t) ? (t as ThemeId) : "classic";
  } catch {
    return "classic";
  }
}

export const savedGlass = (): GlassPrefs => read("glass", DEFAULT_GLASS);

/** Sets the CSS theme and the native window material behind it. */
export async function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  write("theme", id);
  const win = getCurrentWindow();
  try {
    if (id === "glass") await win.setEffects({ effects: [Effect.HudWindow], state: EffectState.Active });
    else await win.clearEffects();
  } catch (e) {
    console.warn("window effects unavailable", e); // the CSS backdrop still carries the look
  }
}

/** Map the 0–100 sliders onto the CSS variables the glass stylesheet reads. */
export function applyGlass(p: GlassPrefs) {
  const s = document.documentElement.style;
  const t = p.transparency / 100;
  s.setProperty("--glass-a", String(0.26 - t * 0.24)); // panel fill alpha: .26 → .02
  s.setProperty("--glass-blur", `${Math.round(6 + (p.blur / 100) * 54)}px`); // 6 → 60px
  s.setProperty("--cover-a", String(0.15 + (p.cover / 100) * 0.85)); // backdrop art opacity
  s.setProperty("--tint-a", String(0.15 + (p.cover / 100) * 0.4));
  document.documentElement.dataset.motion = p.motion ? "on" : "off";
  write("glass", p);
}

// ------------------------------------------------------------------ accent from cover

/**
 * Pull a vivid accent colour out of the cover art. Downscales to 24×24 and
 * picks the pixel cluster with the best saturation × brightness. Covers served
 * without CORS (Sonos' own /getaa) taint the canvas and are skipped.
 */
export async function accentFrom(src: string): Promise<[number, number, number] | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  try {
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    // bucket into a coarse hue histogram weighted by vividness
    const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;
      const val = max / 255;
      const w = sat * sat * val; // favour saturated, not-too-dark pixels
      if (w < 0.05) continue;
      const hue = Math.round(rgbHue(r, g, b) / 20);
      const bk = buckets.get(hue) ?? { w: 0, r: 0, g: 0, b: 0 };
      bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
      buckets.set(hue, bk);
    }
    const best = [...buckets.values()].sort((a, b) => b.w - a.w)[0];
    if (!best) return null;
    return lift([best.r / best.w, best.g / best.w, best.b / best.w]);
  } catch {
    return null;
  }
}

function rgbHue(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** brighten dark picks so the accent reads on glass */
function lift([r, g, b]: number[]): [number, number, number] {
  const max = Math.max(r, g, b);
  const k = max < 170 ? 170 / Math.max(max, 1) : 1;
  return [r, g, b].map((v) => Math.min(255, Math.round(v * k))) as [number, number, number];
}

export function setAccent(rgb: [number, number, number] | null) {
  const s = document.documentElement.style;
  if (rgb) s.setProperty("--accent-rgb", rgb.join(", "));
  else s.removeProperty("--accent-rgb");
}
