import type { Page } from "@playwright/test";
import sharp from "sharp";

export function relLum([r, g, b]: number[]) {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(c1: number[], c2: number[]) {
  const L1 = relLum(c1);
  const L2 = relLum(c2);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

export function parseCssColor(input: string | null): number[] | null {
  if (!input) return null;
  const s = input.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return [Math.round(+rgb[1]), Math.round(+rgb[2]), Math.round(+rgb[3])];
  const modern = s.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (modern) return [Math.round(+modern[1]), Math.round(+modern[2]), Math.round(+modern[3])];
  return null;
}

export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("iablee-theme", t);
    } catch {
      /* ignore */
    }
  }, theme);
  await page.evaluate((t) => {
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.style.colorScheme = t;
    try {
      localStorage.setItem("iablee-theme", t);
    } catch {
      /* ignore */
    }
  }, theme);
  await page.waitForTimeout(100);
}

export type ContrastSample = {
  text: string;
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  ratio: number;
  required: number;
  pass: boolean;
  fg: number[];
  bg: number[];
  method: "computed-bg" | "pixel";
};

/**
 * Prefer opaque computed background-color on the element (or solid ancestors).
 * If the text sits over a CSS background-image (wavy photo), sample screenshot
 * pixels — axe cannot compute those cases.
 */
export async function sampleContrast(
  page: Page,
  selector: string,
  options?: {
    forcePixel?: boolean;
    /** Sample inside the element (gradient/solid controls) instead of above/below (photo headers). */
    sampleInside?: boolean;
  },
): Promise<ContrastSample | null> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return null;
  if (!(await locator.isVisible().catch(() => false))) return null;

  const meta = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    let bgEl: Element | null = el;
    let backgroundColor = style.backgroundColor;
    let overBackgroundImage = false;
    let foundOpaqueSurface = false;

    while (bgEl) {
      const cs = getComputedStyle(bgEl);
      const bgImage = cs.backgroundImage || "";
      if (bgImage && bgImage !== "none" && bgImage.includes("url(")) {
        overBackgroundImage = true;
      }
      const bg = cs.backgroundColor;
      if (!foundOpaqueSurface && bg && !bg.includes("rgba(0, 0, 0, 0)") && bg !== "transparent") {
        const alphaMatch = bg.match(/rgba?\([^)]+,\s*([\d.]+)\)/);
        if (!alphaMatch || Number(alphaMatch[1]) >= 0.85) {
          // Ignore body/html solid tokens when a photo is also painted — pixels win.
          const tag = bgEl.tagName.toLowerCase();
          if (tag !== "body" && tag !== "html") {
            backgroundColor = bg;
            foundOpaqueSurface = true;
          } else {
            backgroundColor = bg;
          }
        }
      }
      bgEl = bgEl.parentElement;
    }

    return {
      text: (el.textContent || "").trim().slice(0, 120),
      color: style.color,
      backgroundColor,
      overBackgroundImage,
      foundOpaqueSurface,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  });

  if (!meta) return null;
  const fg = parseCssColor(meta.color);
  if (!fg) return null;

  const sizePx = parseFloat(meta.fontSize);
  const weight = parseInt(meta.fontWeight, 10) || 400;
  const large = sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
  const required = large ? 3 : 4.5;

  const computedBg = parseCssColor(meta.backgroundColor);
  // If a solid surface (button/card) sits under the text, use it even when a
  // photo exists further up the tree. Force pixel only for headers on the photo.
  const useComputed =
    !options?.forcePixel &&
    meta.foundOpaqueSurface &&
    computedBg &&
    meta.backgroundColor &&
    !meta.backgroundColor.includes("rgba(0, 0, 0, 0)") &&
    (() => {
      const a = meta.backgroundColor.match(/,\s*([\d.]+)\s*\)$/);
      return !a || Number(a[1]) >= 0.85;
    })();

  if (useComputed && computedBg) {
    const ratio = contrastRatio(fg, computedBg);
    return {
      text: meta.text,
      color: meta.color,
      backgroundColor: meta.backgroundColor,
      fontSize: meta.fontSize,
      fontWeight: meta.fontWeight,
      ratio: Number(ratio.toFixed(2)),
      required,
      pass: ratio >= required,
      fg,
      bg: computedBg,
      method: "computed-bg",
    };
  }

  const shot = await page.screenshot({ type: "png" });
  const { data, info } = await sharp(shot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const samples: number[][] = [];
  for (const px of [0.15, 0.35, 0.5, 0.65, 0.85]) {
    const x = Math.min(info.width - 1, Math.max(0, Math.round(meta.rect.x + meta.rect.w * px)));
    const pad = Math.min(4, Math.max(1, Math.round(meta.rect.h * 0.2)));
    const yTop = options?.sampleInside
      ? Math.min(info.height - 1, Math.max(0, Math.round(meta.rect.y + pad)))
      : Math.min(info.height - 1, Math.max(0, Math.round(meta.rect.y - 2)));
    const yBot = options?.sampleInside
      ? Math.min(info.height - 1, Math.max(0, Math.round(meta.rect.y + meta.rect.h - pad)))
      : Math.min(info.height - 1, Math.max(0, Math.round(meta.rect.y + meta.rect.h + 2)));
    for (const y of [yTop, yBot]) {
      const i = (y * info.width + x) * 4;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  const ratios = samples.map((bg) => contrastRatio(fg, bg));
  const minRatio = Math.min(...ratios);
  return {
    text: meta.text,
    color: meta.color,
    backgroundColor: meta.backgroundColor,
    fontSize: meta.fontSize,
    fontWeight: meta.fontWeight,
    ratio: Number(minRatio.toFixed(2)),
    required,
    pass: minRatio >= required,
    fg,
    bg: samples[0] ?? [0, 0, 0],
    method: "pixel",
  };
}
