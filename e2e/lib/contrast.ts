import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
  const parsed = parseCssColorWithAlpha(input);
  return parsed ? parsed.rgb : null;
}

export function parseCssColorWithAlpha(
  input: string | null,
): { rgb: number[]; a: number } | null {
  if (!input) return null;
  const s = input.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const rgb = [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb, a };
  }
  const rgbComma = s.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (rgbComma) {
    return {
      rgb: [Math.round(+rgbComma[1]), Math.round(+rgbComma[2]), Math.round(+rgbComma[3])],
      a: rgbComma[4] !== undefined ? +rgbComma[4] : 1,
    };
  }
  const modern = s.match(
    /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i,
  );
  if (modern) {
    let a = 1;
    if (modern[4] !== undefined) {
      a = modern[4].endsWith("%") ? parseFloat(modern[4]) / 100 : +modern[4];
    }
    return {
      rgb: [Math.round(+modern[1]), Math.round(+modern[2]), Math.round(+modern[3])],
      a,
    };
  }
  return null;
}

/** Composite src over dst (both sRGB 0–255). */
export function compositeOver(fg: number[], fgA: number, bg: number[]): number[] {
  const a = Math.min(1, Math.max(0, fgA));
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}

export function requiredContrastForText(fontSizePx: number, fontWeight: number): number {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return large ? 3 : 4.5;
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
    // Nudge next-themes subscribers after storage write.
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: "iablee-theme", newValue: t }));
    } catch {
      /* ignore */
    }
  }, theme);
  await page.waitForTimeout(150);
  // Confirm dark class stuck (next-themes can briefly clear it on route change).
  await page.evaluate((t) => {
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
  }, theme);
}

export async function waitForVisualReady(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.waitForLoadState("networkidle", { timeout: 3_000 });
  } catch {
    /* soft — SPA pages often never idle */
  }
  await page.evaluate(async () => {
    const imgs = Array.from(document.images).slice(0, 40);
    await Promise.all(
      imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          setTimeout(() => resolve(), 1_200);
        });
      }),
    );
    const body = getComputedStyle(document.body).backgroundImage;
    if (body && body.includes("url(") && document.fonts?.ready) {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise<void>((r) => setTimeout(r, 800)),
        ]);
      } catch {
        /* ignore */
      }
    }
  });
  await page.waitForTimeout(80);
}

/**
 * Assert page-title / page-subtitle layout: no horizontal clipping, title above subtitle.
 * Used permanently so the inline-block "opaque wash" regression cannot return.
 */
export async function assertPageTitleLayout(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const titles = Array.from(
      document.querySelectorAll<HTMLElement>("main h1.page-title, main h2.page-title, main h3.page-title"),
    ).filter((el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
    });
    if (titles.length === 0) {
      return { ok: false as const, reason: "no visible .page-title" };
    }
    for (const title of titles) {
      // Allow 1px subpixel slack
      if (title.scrollWidth > title.clientWidth + 1) {
        return {
          ok: false as const,
          reason: `clipped title "${(title.textContent || "").trim()}" scrollWidth=${title.scrollWidth} clientWidth=${title.clientWidth}`,
        };
      }
      const parent = title.parentElement;
      const subtitle = parent?.querySelector<HTMLElement>(":scope > .page-subtitle");
      if (subtitle) {
        if (subtitle.scrollWidth > subtitle.clientWidth + 1) {
          return {
            ok: false as const,
            reason: `clipped subtitle "${(subtitle.textContent || "").trim()}" scrollWidth=${subtitle.scrollWidth} clientWidth=${subtitle.clientWidth}`,
          };
        }
        const tBox = title.getBoundingClientRect();
        const sBox = subtitle.getBoundingClientRect();
        if (tBox.bottom > sBox.top + 1) {
          return {
            ok: false as const,
            reason: `title not above subtitle (title.bottom=${tBox.bottom} subtitle.top=${sBox.top}) text="${(title.textContent || "").trim()}"`,
          };
        }
      }
    }
    return { ok: true as const };
  });
  if (!result.ok) {
    throw new Error(`page-title layout failed on ${label}: ${result.reason}`);
  }
}

/** Hide Next.js / Sonner overlays for screenshots only (not app code). */
export async function hideDevOverlaysForScreenshot(page: Page) {
  await page
    .evaluate(() => {
      document
        .querySelectorAll(
          "nextjs-portal, [data-next-badge], [data-nextjs-toast], #__next-build-watcher, [data-nextjs-dialog-overlay]",
        )
        .forEach((el) => el.remove());
      window.getSelection?.()?.removeAllRanges?.();
      (document.activeElement as HTMLElement | null)?.blur?.();
    })
    .catch(() => undefined);
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

export type AuditCheck = {
  route: string;
  state: string;
  locale: string;
  theme: string;
  viewport: string;
  selector: string;
  text: string;
  fg: number[] | null;
  bg: number[] | null;
  ratio: number | null;
  required: number;
  pass: boolean;
  method: string;
  rule?: string;
  info?: boolean;
  failureSummary?: string;
  /** Actual browser URL at capture time (e.g. post-Subscribe bounce). */
  finalUrl?: string;
};

export type ViewportName = "desktop" | "mobile";

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
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

    const parseAlpha = (color: string): number => {
      if (!color || color === "transparent") return 0;
      // rgba(r, g, b, a) — require 3 commas so blue is never treated as alpha
      const comma = color.match(
        /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i,
      );
      if (comma) return Math.min(1, Math.max(0, +comma[1]));
      const modern = color.match(/\/\s*([\d.]+%?)\s*\)/);
      if (modern) {
        const a = modern[1].endsWith("%")
          ? parseFloat(modern[1]) / 100
          : +modern[1];
        return Math.min(1, Math.max(0, a));
      }
      return 1;
    };

    let bgEl: Element | null = el;
    let backgroundColor = style.backgroundColor;
    let mustPixelOverImage = false;
    let foundOpaqueSurface = false;
    let surfaceAlpha = parseAlpha(style.backgroundColor);

    while (bgEl) {
      const cs = getComputedStyle(bgEl);
      const bgImage = cs.backgroundImage || "";
      // Gradient or photo forces pixel if no opaque fill sits above it (CTA on header card).
      if (!foundOpaqueSurface && bgImage && bgImage !== "none") {
        mustPixelOverImage = true;
      }
      const bg = cs.backgroundColor;
      if (!foundOpaqueSurface && bg && bg !== "transparent") {
        const a = parseAlpha(bg);
        // Only fully opaque (α === 1) surfaces may short-circuit to computed RGB.
        if (a >= 1) {
          const tag = bgEl.tagName.toLowerCase();
          backgroundColor = bg;
          surfaceAlpha = a;
          if (tag !== "body" && tag !== "html") {
            foundOpaqueSurface = true;
          }
        }
      }
      bgEl = bgEl.parentElement;
    }

    return {
      text: (el.textContent || "").trim().slice(0, 120),
      color: style.color,
      backgroundColor,
      mustPixelOverImage,
      foundOpaqueSurface,
      surfaceAlpha,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  });

  if (!meta) return null;
  const fgParsed = parseCssColorWithAlpha(meta.color);
  if (!fgParsed) return null;

  const sizePx = parseFloat(meta.fontSize);
  const weight = parseInt(meta.fontWeight, 10) || 400;
  const required = requiredContrastForText(sizePx, weight);

  const bgParsed = parseCssColorWithAlpha(meta.backgroundColor);
  // Never treat α<1 as opaque; force pixel when photo shows through (no opaque surface).
  const useComputed =
    !options?.forcePixel &&
    !meta.mustPixelOverImage &&
    meta.foundOpaqueSurface &&
    meta.surfaceAlpha >= 1 &&
    bgParsed &&
    bgParsed.a >= 1;

  if (useComputed && bgParsed) {
    const fg = compositeOver(fgParsed.rgb, fgParsed.a, bgParsed.rgb);
    const ratio = contrastRatio(fg, bgParsed.rgb);
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
      bg: bgParsed.rgb,
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
  const pairs = samples.map((sampleBg) => {
    const fg = compositeOver(fgParsed.rgb, fgParsed.a, sampleBg);
    return { fg, bg: sampleBg, ratio: contrastRatio(fg, sampleBg) };
  });
  pairs.sort((a, b) => a.ratio - b.ratio);
  const worst = pairs[0] ?? { fg: fgParsed.rgb, bg: [0, 0, 0], ratio: 1 };
  return {
    text: meta.text,
    color: meta.color,
    backgroundColor: meta.backgroundColor,
    fontSize: meta.fontSize,
    fontWeight: meta.fontWeight,
    ratio: Number(worst.ratio.toFixed(2)),
    required,
    pass: worst.ratio >= required,
    fg: worst.fg,
    bg: worst.bg,
    method: "pixel",
  };
}

type TextNodeMeta = {
  id: number;
  selector: string;
  text: string;
  color: string;
  colorAlpha: number;
  fontSize: number;
  fontWeight: number;
  disabled: boolean;
  decorative: boolean;
  kind: "text" | "placeholder" | "value";
  docX: number;
  docY: number;
  w: number;
  h: number;
  solidBg?: [number, number, number] | null;
};

/**
 * Enumerate every visible text-bearing node, hide text with an injected style,
 * screenshot the true background (photo/gradients/glass), and score the worst
 * (min) contrast sample inside each bbox, paired with that sample's bg.
 */
export async function auditAllVisibleText(page: Page): Promise<
  Array<{
    selector: string;
    text: string;
    fg: number[];
    bg: number[];
    ratio: number;
    required: number;
    pass: boolean;
    method: "pixel-fulltext";
    info?: boolean;
    disabled?: boolean;
  }>
> {
  await page.evaluate(() => {
    document.querySelectorAll("[data-contrast-audit-id]").forEach((el) => {
      el.removeAttribute("data-contrast-audit-id");
    });
  });

  // Freeze transitions/animations for the whole sample window. Buttons use
  // `transition-all` and sidebar labels `transition-all duration-300`; after a
  // prior transparent-text inject/restore, getComputedStyle().color is often
  // mid-fade (α≈0.45–0.70). solidBg then composites washed pairs (e.g. white@0.7
  // on #0658D6 → 3.80) while opaque settled paint is 6.22+. Evidence:
  // /tmp/iablee-contrast3-shots/diagnosis/diagnosis.md
  const freezeHandle = await page.addStyleTag({
    content: `
      html body, html body *, html body *::before, html body *::after {
        transition: none !important;
        animation: none !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  const metas = (await page.evaluate(() => {
    type Kind = "text" | "placeholder" | "value";
    type Meta = {
      id: number;
      selector: string;
      text: string;
      color: string;
      colorAlpha: number;
      fontSize: number;
      fontWeight: number;
      disabled: boolean;
      decorative: boolean;
      kind: Kind;
      docX: number;
      docY: number;
      w: number;
      h: number;
      solidBg?: [number, number, number] | null;
    };
    const out: Meta[] = [];
    let nextId = 1;

    const isVisuallyHidden = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) {
        return true;
      }
      if (el.getAttribute("aria-hidden") === "true") return true;
      if (el.closest("[aria-hidden='true'], [inert]")) return true;
      if (el.classList.contains("sr-only") || el.classList.contains("srOnly")) return true;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return true;
      // Skip text buried under a modal/dialog (not the accessible foreground UI).
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
        const dialog = el.closest('[role="dialog"], [data-radix-dialog-content]');
        const topDialog = topEl.closest('[role="dialog"], [data-radix-dialog-content]');
        if (!dialog && topDialog) return true;
        if (dialog && topDialog && dialog !== topDialog) return true;
      }
      return false;
    };

    const isDisabled = (el: Element) => {
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLButtonElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) {
        return el.disabled;
      }
      if (el.getAttribute("aria-disabled") === "true") return true;
      if (el.closest("[disabled], [aria-disabled='true']")) return true;
      return false;
    };

    const parseAlpha = (color: string): number => {
      if (!color || color === "transparent") return 0;
      // rgba(r, g, b, a) — require 3 commas so the blue channel is never treated as alpha
      const comma = color.match(
        /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i,
      );
      if (comma) return Math.min(1, Math.max(0, +comma[1]));
      // modern rgb(r g b / a) or rgb(r g b / a%)
      const modern = color.match(/\/\s*([\d.]+%?)\s*\)/);
      if (modern) {
        const a = modern[1].endsWith("%")
          ? parseFloat(modern[1]) / 100
          : +modern[1];
        return Math.min(1, Math.max(0, a));
      }
      return 1;
    };

    const pushEl = (el: Element, text: string, kind: Kind) => {
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (!trimmed) return;
      const cs = getComputedStyle(el);
      if (isVisuallyHidden(el)) return;
      if (parseAlpha(cs.color) < 0.05 && kind === "text") return;

      const id = nextId++;
      el.setAttribute("data-contrast-audit-id", String(id));
      const rect = el.getBoundingClientRect();
      const fontWeight = parseInt(cs.fontWeight, 10) || 400;

      // Walk ancestors: only fully opaque (α === 1) surfaces may skip pixel sampling.
      // Gradients / url() images on the element (or above it before an opaque fill) force pixel
      // so we never score white header card behind a blue gradient CTA label.
      let solidBg: [number, number, number] | null = null;
      let mustPixelOverImage = false;
      let walk: Element | null = el;
      while (walk) {
        const wcs = getComputedStyle(walk);
        const bgImage = wcs.backgroundImage || "";
        if (!solidBg && bgImage && bgImage !== "none") {
          // linear-gradient / url — real painted surface under the glyphs
          mustPixelOverImage = true;
        }
        if (!solidBg) {
          const raw = wcs.backgroundColor;
          const alpha = parseAlpha(raw);
          if (alpha >= 1 && raw && raw !== "transparent") {
            const m = raw.match(/rgba?\(([^)]+)\)/);
            if (m) {
              const nums = m[1]
                .split(/[,\s/]+/)
                .map((p) => parseFloat(p))
                .filter((n) => !Number.isNaN(n));
              if (nums.length >= 3) {
                const tag = walk.tagName.toLowerCase();
                if (tag !== "body" && tag !== "html") {
                  solidBg = [Math.round(nums[0]), Math.round(nums[1]), Math.round(nums[2])];
                }
              }
            }
          }
        }
        walk = walk.parentElement;
      }
      // Keep an opaque fill found on the control itself (buttons over body photo).
      if (mustPixelOverImage) {
        const selfBg = getComputedStyle(el).backgroundColor;
        const selfA = parseAlpha(selfBg);
        const keepSelf = selfA >= 1 && selfBg && selfBg !== "transparent";
        if (!keepSelf) solidBg = null;
      }

      out.push({
        id,
        selector: `[data-contrast-audit-id="${id}"]`,
        text: trimmed.slice(0, 160),
        color: cs.color,
        colorAlpha: parseAlpha(cs.color),
        fontSize: parseFloat(cs.fontSize) || 14,
        fontWeight,
        disabled: isDisabled(el),
        decorative: el.getAttribute("aria-hidden") === "true",
        kind,
        docX: rect.x + window.scrollX,
        docY: rect.y + window.scrollY,
        w: rect.width,
        h: rect.height,
        solidBg,
      });
    };

    const walk = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode as Element | null;
      while (node) {
        const el = node;
        let hasDirectText = false;
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE && (child.textContent || "").trim()) {
            hasDirectText = true;
            break;
          }
        }
        if (hasDirectText) {
          const parts: string[] = [];
          for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
              const t = (child.textContent || "").trim();
              if (t) parts.push(t);
            }
          }
          pushEl(el, parts.join(" "), "text");
        }

        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const ph = el.getAttribute("placeholder");
          if (ph && ph.trim()) {
            const phColor =
              getComputedStyle(el, "::placeholder").color || getComputedStyle(el).color;
            const id = nextId++;
            el.setAttribute("data-contrast-audit-id", String(id));
            const rect = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            // Prefer the input's own opaque fill — avoids sampling overlapping search icons.
            let solidBg: [number, number, number] | null = null;
            const raw = cs.backgroundColor;
            const alpha = parseAlpha(raw);
            if (alpha >= 1 && raw && raw !== "transparent") {
              const m = raw.match(/rgba?\(([^)]+)\)/);
              if (m) {
                const nums = m[1]
                  .split(/[,\s/]+/)
                  .map((p) => parseFloat(p))
                  .filter((n) => !Number.isNaN(n));
                if (nums.length >= 3) {
                  solidBg = [Math.round(nums[0]), Math.round(nums[1]), Math.round(nums[2])];
                }
              }
            }
            if (!isVisuallyHidden(el) && rect.width >= 1 && rect.height >= 1) {
              out.push({
                id,
                selector: `[data-contrast-audit-id="${id}"]`,
                text: `[placeholder] ${ph.trim()}`.slice(0, 160),
                color: phColor,
                colorAlpha: parseAlpha(phColor),
                fontSize: parseFloat(cs.fontSize) || 14,
                fontWeight: parseInt(cs.fontWeight, 10) || 400,
                disabled: isDisabled(el),
                decorative: false,
                kind: "placeholder",
                docX: rect.x + window.scrollX,
                docY: rect.y + window.scrollY,
                w: rect.width,
                h: rect.height,
                solidBg,
              });
            }
          }
          if (el.value && el.value.trim() && el.type !== "password" && el.type !== "hidden") {
            pushEl(el, `[value] ${el.value}`, "value");
          }
        }

        node = walker.nextNode() as Element | null;
      }
    };

    walk(document.body);
    return out;
  })) as TextNodeMeta[];

  // Inject transparent-text style so the screenshot shows true backgrounds.
  // Higher specificity than `.btn-primary-gradient { -webkit-text-fill-color: … !important }`
  // so gradient CTA labels do not leave white ink in the “background” screenshot.
  // Keep transition/animation none here too so hide snaps (no mid-frame residual ink).
  const styleHandle = await page.addStyleTag({
    content: `
      html body [data-contrast-audit-id],
      html body [data-contrast-audit-id] *,
      html body .btn-primary-gradient[data-contrast-audit-id],
      html body button[data-contrast-audit-id],
      html body a[data-contrast-audit-id] {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
        caret-color: transparent !important;
        transition: none !important;
        animation: none !important;
      }
      html body [data-contrast-audit-id]::placeholder,
      html body [data-contrast-audit-id] ::placeholder,
      html body [data-contrast-audit-id]::-webkit-input-placeholder {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        opacity: 0 !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(40);

  // Viewport screenshot only — fullPage + open dialogs can hang Chromium.
  // Metas use viewport coordinates (getBoundingClientRect); filter to on-screen.
  const shot = await page.screenshot({ type: "png", fullPage: false, timeout: 15_000 });
  const { data, info } = await sharp(shot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });

  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const viewport = await page.viewportSize();
  const sx = viewport ? info.width / viewport.width : dpr;
  const sy = viewport ? info.height / viewport.height : dpr;

  const results: Array<{
    selector: string;
    text: string;
    fg: number[];
    bg: number[];
    ratio: number;
    required: number;
    pass: boolean;
    method: "pixel-fulltext";
    info?: boolean;
    disabled?: boolean;
  }> = [];

  const vpH = viewport?.height ?? info.height;
  const vpW = viewport?.width ?? info.width;
  // Re-read viewport-relative rects after scroll position at screenshot time
  const viewportMetas = await page.evaluate(() => {
    const out: Array<{ id: number; x: number; y: number; w: number; h: number }> = [];
    document.querySelectorAll("[data-contrast-audit-id]").forEach((el) => {
      const id = Number(el.getAttribute("data-contrast-audit-id"));
      const rect = el.getBoundingClientRect();
      out.push({ id, x: rect.x, y: rect.y, w: rect.width, h: rect.height });
    });
    return out;
  });
  const byId = new Map(viewportMetas.map((m) => [m.id, m]));

  for (const meta of metas) {
    const parsed = parseCssColorWithAlpha(meta.color);
    if (!parsed) continue;
    const live = byId.get(meta.id);
    if (!live) continue;
    // Skip off-screen (viewport sampling)
    if (live.y + live.h < 0 || live.y > vpH || live.x + live.w < 0 || live.x > vpW) continue;
    if (live.w < 1 || live.h < 1) continue;

    // Start at 0.3 to avoid leading icon chrome inside padded inputs.
    const gridX = [0.3, 0.45, 0.5, 0.65, 0.8];
    const gridY = [0.3, 0.5, 0.7];
    const samples: number[][] = [];
    for (const gx of gridX) {
      for (const gy of gridY) {
        const px = Math.min(
          info.width - 1,
          Math.max(0, Math.round((live.x + live.w * gx) * sx)),
        );
        const py = Math.min(
          info.height - 1,
          Math.max(0, Math.round((live.y + live.h * gy) * sy)),
        );
        const i = (py * info.width + px) * 4;
        samples.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
    if (samples.length === 0 && !meta.solidBg) continue;

    let worst: number;
    let bg: number[];
    let fg: number[];
    if (meta.solidBg) {
      bg = meta.solidBg;
      // Opaque control/surface fills: use the computed ink directly. Soft-compositing
      // opaque white labels over the fill invents washed light-blue pairs that axe
      // never sees (and that are not how browsers paint opaque `color`).
      fg =
        parsed.a >= 0.95
          ? parsed.rgb
          : compositeOver(parsed.rgb, parsed.a, bg);
      worst = contrastRatio(fg, bg);
    } else {
      const pairs = samples.map((sampleBg) => {
        const sampleFg = compositeOver(parsed.rgb, parsed.a, sampleBg);
        return { fg: sampleFg, bg: sampleBg, ratio: contrastRatio(sampleFg, sampleBg) };
      });
      pairs.sort((a, b) => a.ratio - b.ratio);
      // Worst sample (min ratio), paired with its bg
      const worstPair = pairs[0] ?? pairs[pairs.length - 1];
      worst = worstPair.ratio;
      bg = worstPair.bg;
      fg = worstPair.fg;
    }
    const required = requiredContrastForText(meta.fontSize, meta.fontWeight);
    const exempt = meta.disabled || meta.decorative;
    results.push({
      selector: meta.selector,
      text: meta.text,
      fg,
      bg,
      ratio: Number(worst.toFixed(2)),
      required,
      pass: exempt ? true : worst >= required,
      method: "pixel-fulltext",
      info: exempt || undefined,
      disabled: meta.disabled || undefined,
    });
  }

  // Restore audit markers and injected transparent-text stylesheet.
  await page.evaluate(() => {
    document.querySelectorAll("[data-contrast-audit-id]").forEach((el) => {
      el.removeAttribute("data-contrast-audit-id");
    });
  });
  await styleHandle.evaluate((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }).catch(() => undefined);
  await freezeHandle.evaluate((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }).catch(() => undefined);
  // Allow layout to settle with transitions re-enabled before the next state.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  return results;
}

export async function runAxeContrastChecks(page: Page): Promise<
  Array<{
    selector: string;
    text: string;
    pass: boolean;
    required: number;
    ratio: number | null;
    fg: number[] | null;
    bg: number[] | null;
    method: "axe-color-contrast" | "axe-color-contrast-enhanced";
    failureSummary?: string;
    info?: boolean;
  }>
> {
  const out: Array<{
    selector: string;
    text: string;
    pass: boolean;
    required: number;
    ratio: number | null;
    fg: number[] | null;
    bg: number[] | null;
    method: "axe-color-contrast" | "axe-color-contrast-enhanced";
    failureSummary?: string;
    info?: boolean;
  }> = [];

  try {
    const aa = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    let violationNodes = 0;
    for (const v of aa.violations) {
      if (v.id !== "color-contrast") continue;
      for (const n of v.nodes) {
        violationNodes += 1;
        const data = n.any?.[0]?.data as
          | { fgColor?: string; bgColor?: string; contrastRatio?: number; fontSize?: string; fontWeight?: string }
          | undefined;
        const fg = parseCssColor(data?.fgColor ?? null);
        const bg = parseCssColor(data?.bgColor ?? null);
        const ratio = data?.contrastRatio ?? (fg && bg ? contrastRatio(fg, bg) : null);
        const sizePx = data?.fontSize ? parseFloat(data.fontSize) : 14;
        const weight = data?.fontWeight ? parseInt(String(data.fontWeight), 10) || 400 : 400;
        out.push({
          selector: (n.target || []).join(" "),
          text: (n.html || "").replace(/<[^>]+>/g, " ").trim().slice(0, 160),
          pass: false,
          required: requiredContrastForText(sizePx, weight),
          ratio: ratio !== null ? Number(Number(ratio).toFixed(2)) : null,
          fg,
          bg,
          method: "axe-color-contrast",
          failureSummary: n.failureSummary || undefined,
        });
      }
    }
    // Always record that axe AA ran for this state (reconciliation / gap detection).
    // Clean summaries are info so after-phase fail=0 still holds; each violation above is a failure.
    const passNodes =
      aa.passes.find((p) => p.id === "color-contrast")?.nodes?.length ?? 0;
    out.push({
      selector: "axe:color-contrast-summary",
      text: `axe AA ran: ${violationNodes} violation node(s), ${passNodes} pass node(s)`,
      pass: violationNodes === 0,
      required: 4.5,
      ratio: null,
      fg: null,
      bg: null,
      method: "axe-color-contrast",
      info: violationNodes === 0,
      failureSummary:
        violationNodes > 0 ? `${violationNodes} color-contrast violation node(s)` : undefined,
    });
  } catch (error) {
    out.push({
      selector: "axe",
      text: `axe error: ${String(error)}`,
      pass: false,
      required: 4.5,
      ratio: null,
      fg: null,
      bg: null,
      method: "axe-color-contrast",
      failureSummary: String(error),
    });
  }

  try {
    const aaa = await new AxeBuilder({ page }).withRules(["color-contrast-enhanced"]).analyze();
    for (const v of aaa.violations) {
      for (const n of v.nodes) {
        const data = n.any?.[0]?.data as { contrastRatio?: number; fgColor?: string; bgColor?: string } | undefined;
        out.push({
          selector: (n.target || []).join(" "),
          text: (n.html || "").replace(/<[^>]+>/g, " ").trim().slice(0, 160),
          pass: true,
          required: 7,
          ratio: data?.contrastRatio != null ? Number(Number(data.contrastRatio).toFixed(2)) : null,
          fg: parseCssColor(data?.fgColor ?? null),
          bg: parseCssColor(data?.bgColor ?? null),
          method: "axe-color-contrast-enhanced",
          failureSummary: n.failureSummary || undefined,
          info: true,
        });
      }
    }
  } catch {
    /* enhanced is informational only */
  }

  return out;
}

/** Scoped focus targets — avoid OAuth image buttons / noisy chrome. */
export const FOCUS_SELECTORS = {
  form: 'form input:not([type="hidden"]):not([disabled]), form textarea:not([disabled]), form button[type="submit"]:not([disabled]), form select:not([disabled])',
  dialog:
    '[role="dialog"] input:not([type="hidden"]):not([disabled]), [role="dialog"] textarea:not([disabled]), [role="dialog"] button:not([disabled]), [role="dialog"] select:not([disabled]), [role="dialog"] [role="combobox"]',
  nav: '.bg-sidebar a[href], .bg-sidebar button:not([disabled]), aside a[href], nav a[href]',
  primary:
    'main button.btn-primary-gradient:not([disabled]), main [data-slot="button"].bg-primary:not([disabled]), form button[type="submit"]:not([disabled]), main a[href] button:not([disabled])',
  settings:
    'main input:not([type="hidden"]):not([disabled]), main textarea:not([disabled]), main button:not([disabled]), main select:not([disabled]), form input:not([type="hidden"]):not([disabled]), form button:not([disabled])',
  default:
    'input:not([type="hidden"]):not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
} as const;

/**
 * Focus-ring vs adjacent background — WCAG 1.4.11 non-text contrast (3:1).
 * Measures the ACTUAL rendered outline / focus box-shadow under keyboard :focus-visible.
 * Decorative always-on shadows (blur, low spread) are ignored; dual-tone indicators
 * pass when at least one indicator colour clears 3:1 against each adjacent sample.
 */
export async function auditFocusRings(
  page: Page,
  focusableSelector: string = FOCUS_SELECTORS.default,
): Promise<
  Array<{
    selector: string;
    text: string;
    fg: number[];
    bg: number[];
    ratio: number;
    required: number;
    pass: boolean;
    method: "focus-ring";
  }>
> {
  const results: Array<{
    selector: string;
    text: string;
    fg: number[];
    bg: number[];
    ratio: number;
    required: number;
    pass: boolean;
    method: "focus-ring";
  }> = [];

  // Snap dual-tone rings (avoid shadow-lg → halo interpolation mid-frames).
  const freeze = await page.addStyleTag({
    content: `
      html body, html body *, html body *::before, html body *::after {
        transition: none !important;
        animation: none !important;
      }
    `,
  });

  const count = await page.locator(focusableSelector).count();
  const limit = Math.min(count, 14);
  try {
  for (let i = 0; i < limit; i += 1) {
    const el = page.locator(focusableSelector).nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    try {
      // Force :focus-visible (Chromium FocusOptions) — Tab modality alone is flaky under freeze.
      await el.evaluate((node) => {
        const prev = document.activeElement as HTMLElement | null;
        if (prev && prev !== node && typeof prev.blur === "function") prev.blur();
        try {
          (node as HTMLElement).focus({ focusVisible: true } as FocusOptions);
        } catch {
          (node as HTMLElement).focus();
        }
      });
    } catch {
      continue;
    }
    await page.waitForTimeout(40);

    const focused = await el.evaluate((node) => {
      const active = document.activeElement === node;
      const focusVisible = active && node.matches(":focus-visible");
      return { active, focusVisible };
    });
    if (!focused.focusVisible) {
      // Fallback: Tab from a temporary sentinel so :focus-visible matches keyboard modality.
      await el.evaluate(() => {
        const sentinel = document.createElement("button");
        sentinel.type = "button";
        sentinel.setAttribute("data-focus-sentinel", "1");
        sentinel.style.cssText =
          "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;z-index:2147483647";
        document.body.appendChild(sentinel);
        sentinel.focus();
      });
      await page.keyboard.press("Tab");
      await page.waitForTimeout(40);
      // If Tab landed elsewhere, force focusVisible again on the target.
      const ok = await el.evaluate((node) => {
        if (document.activeElement !== node) {
          try {
            (node as HTMLElement).focus({ focusVisible: true } as FocusOptions);
          } catch {
            (node as HTMLElement).focus();
          }
        }
        document.querySelectorAll("[data-focus-sentinel]").forEach((s) => s.remove());
        return document.activeElement === node && node.matches(":focus-visible");
      });
      if (!ok) {
        await page.evaluate(() => {
          document.querySelectorAll("[data-focus-sentinel]").forEach((s) => s.remove());
        });
      }
    }

    const meta = await el.evaluate((node) => {
      const cs = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const outlineW = parseFloat(cs.outlineWidth) || 0;
      const outlineStyle = cs.outlineStyle;
      const boxShadow = cs.boxShadow;
      const focusVisible = document.activeElement === node && node.matches(":focus-visible");
      const indicatorColors: string[] = [];

      // Prefer the real outline when present (never substitute CSS variables).
      if (outlineW >= 0.5 && outlineStyle !== "none") {
        indicatorColors.push(cs.outlineColor);
      }

      // Focus rings often use opaque zero-blur / high-spread shadows. Ignore
      // decorative drop shadows (blur with ~0 spread, or alpha < 0.35).
      if (boxShadow && boxShadow !== "none") {
        const layers = boxShadow.split(/,(?![^(]*\))/);
        for (const layer of layers) {
          const colorMatch = layer.match(/rgba?\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\)|#[0-9a-fA-F]+/);
          if (!colorMatch) continue;
          const nums = colorMatch[0].match(/[\d.]+/g)?.map(Number) || [];
          const alpha = nums.length >= 4 ? nums[3] : 1;
          if (alpha < 0.35) continue;
          const lengths = layer
            .replace(colorMatch[0], "")
            .match(/-?[\d.]+px/g)
            ?.map((v) => Math.abs(parseFloat(v))) || [];
          // box-shadow: offsetX offsetY blur spread — need spread >= 2 or blur==0 with opaque colour
          const blur = lengths[2] ?? 0;
          const spread = lengths[3] ?? 0;
          const looksLikeFocusRing = spread >= 2 || (blur === 0 && alpha >= 0.9);
          if (!looksLikeFocusRing) continue;
          indicatorColors.push(colorMatch[0]);
        }
      }

      return {
        indicatorColors,
        outlineW,
        outlineStyle,
        boxShadow,
        focusVisible,
        text: (
          (node as HTMLElement).innerText ||
          (node as HTMLInputElement).placeholder ||
          node.tagName
        ).slice(0, 80),
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        isImageOnly:
          node instanceof HTMLElement &&
          node.querySelector("img") != null &&
          !(node.textContent || "").trim(),
      };
    });

    // Image-only controls (e.g. Apple Sign In asset) — focus ring may be decorative; skip.
    if (meta.isImageOnly) continue;

    const rings = meta.indicatorColors
      .map((c) => parseCssColor(c))
      .filter((c): c is number[] => Array.isArray(c) && c.length >= 3);
    if (rings.length === 0) {
      results.push({
        selector: `${focusableSelector}:nth(${i})`,
        text: `focus:${meta.text}`,
        fg: [0, 0, 0],
        bg: [255, 255, 255],
        ratio: 1,
        required: 3,
        pass: false,
        method: "focus-ring",
      });
      continue;
    }

    const shot = await page.screenshot({ type: "png" });
    const { data, info } = await sharp(shot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    // Scale CSS rects to screenshot pixels (same DPR mapping as fulltext/ui-border).
    const viewport = await page.viewportSize();
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    const sx = viewport ? info.width / viewport.width : dpr;
    const sy = viewport ? info.height / viewport.height : dpr;
    const rx = meta.rect.x * sx;
    const ry = meta.rect.y * sy;
    const rw = meta.rect.w * sx;
    const rh = meta.rect.h * sy;
    // Sample into dialog/page padding — avoid label glyphs above inputs and
    // sibling CTAs to the sides of footer buttons.
    const cx = Math.min(info.width - 1, Math.max(0, Math.round(rx + rw / 2)));
    const midY = Math.min(info.height - 1, Math.max(0, Math.round(ry + rh / 2)));
    const samplePoints: Array<[number, number]> = [
      [cx, Math.round(ry - 28 * sy)],
      [cx, Math.round(ry + rh + 16 * sy)],
      [Math.round(rx + rw + 16 * sx), midY],
      [Math.round(rx - 16 * sx), midY],
      [Math.round(rx + rw / 4), Math.round(ry + rh + 16 * sy)],
    ];
    const adjacentBgs: number[][] = [];
    for (const [xx, yy] of samplePoints) {
      const px = Math.min(info.width - 1, Math.max(0, xx));
      const py = Math.min(info.height - 1, Math.max(0, yy));
      const iPx = (py * info.width + px) * 4;
      adjacentBgs.push([data[iPx], data[iPx + 1], data[iPx + 2]]);
    }

    // Keep BOTH light and dark adjacent chrome. Drop only near-black ink
    // samples that look like label glyphs (not dark UI chrome).
    const lum = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const maxLum = Math.max(...adjacentBgs.map(lum));
    const minLum = Math.min(...adjacentBgs.map(lum));
    // Glyph ink is near-black; dark chrome (sidebar/navy) sits well above that.
    const inkCeiling = 28;
    let surfaceBgs = adjacentBgs.filter((bg) => lum(bg) > inkCeiling);
    if (surfaceBgs.length === 0) surfaceBgs = adjacentBgs;
    // If we still have a wide spread, keep light AND dark clusters (not light-only).
    if (maxLum - minLum > 80 && surfaceBgs.length > 2) {
      const light = surfaceBgs.filter((bg) => lum(bg) >= Math.max(100, maxLum - 80));
      const dark = surfaceBgs.filter((bg) => lum(bg) <= Math.min(120, minLum + 80) && lum(bg) > inkCeiling);
      const mixed = [...light, ...dark];
      if (mixed.length > 0) surfaceBgs = mixed;
    }

    // Dual-tone: for each adjacent bg, pass if ANY indicator colour clears 3:1.
    // Report the worst of those per-bg best ratios (and the colours that produced it).
    let worst = { bg: surfaceBgs[0] || [255, 255, 255], ratio: Infinity, fg: rings[0] };
    for (const bg of surfaceBgs) {
      let bestForBg = { ratio: 0, fg: rings[0] };
      for (const ring of rings) {
        const r = contrastRatio(ring, bg);
        if (r < 1.2) continue; // landed on the ring ink itself
        if (r > bestForBg.ratio) bestForBg = { ratio: r, fg: ring };
      }
      if (bestForBg.ratio === 0) continue;
      if (bestForBg.ratio < worst.ratio) {
        worst = { bg, ratio: bestForBg.ratio, fg: bestForBg.fg };
      }
    }
    if (!Number.isFinite(worst.ratio)) {
      worst = {
        bg: [255, 255, 255],
        ratio: Math.max(...rings.map((ring) => contrastRatio(ring, [255, 255, 255]))),
        fg: rings[0],
      };
    }
    results.push({
      selector: `${focusableSelector}[${i}]`,
      text: `focus:${meta.text}`,
      fg: worst.fg,
      bg: worst.bg,
      ratio: Number(worst.ratio.toFixed(2)),
      required: 3,
      pass: worst.ratio >= 3,
      method: "focus-ring",
    });
  }
  } finally {
    await freeze.dispose().catch(() => undefined);
  }

  return results;
}

/**
 * Input/UI component border vs adjacent background (WCAG 1.4.11, 3:1).
 * Per-element scrollIntoView({block:'center'}) before sampling so below-fold
 * controls are measured against real adjacent pixels (not viewport-edge clamps).
 * Samples every eligible control (no hard cap); failures to measure are recorded
 * fail-closed as pass:false. Callers may scrollTo(0,0) before invoking so focus
 * tabbing does not leave OAuth under the photo — then each control re-centres.
 */
export async function auditUiBorders(page: Page): Promise<
  Array<{
    selector: string;
    text: string;
    fg: number[];
    bg: number[];
    ratio: number;
    required: number;
    pass: boolean;
    method: "ui-border";
  }>
> {
  type BorderCand = { sel: string; idx: number; selector: string };
  type BorderMeta = {
    selector: string;
    borderColor: string;
    fillColor: string;
    text: string;
    dark: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  };

  // Enumerate by selector+index (no DOM mutation — React re-renders strip data-* markers).
  const cands = await page.evaluate((): BorderCand[] => {
    const sels = [
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "[role='checkbox']",
      "[data-slot='input']",
      "button",
    ];
    const out: BorderCand[] = [];
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach((el, idx) => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        if (cs.visibility === "hidden" || cs.display === "none") return;
        if (
          (el as HTMLInputElement).disabled ||
          el.getAttribute("aria-disabled") === "true"
        ) {
          return;
        }
        const bw =
          parseFloat(cs.borderTopWidth) +
          parseFloat(cs.borderRightWidth) +
          parseFloat(cs.borderBottomWidth) +
          parseFloat(cs.borderLeftWidth);
        if (bw < 0.5) return;
        out.push({ sel, idx, selector: `${sel}[${idx}]` });
      });
    }
    return out;
  });

  if (cands.length === 0) return [];

  const lum = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const results: Array<{
    selector: string;
    text: string;
    fg: number[];
    bg: number[];
    ratio: number;
    required: number;
    pass: boolean;
    method: "ui-border";
  }> = [];

  const readMeta = async (cand: BorderCand): Promise<BorderMeta | null> =>
    page.evaluate(({ sel, idx, selector }) => {
      const el = document.querySelectorAll(sel)[idx] as Element | undefined;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      if (cs.visibility === "hidden" || cs.display === "none") return null;
      const dark = document.documentElement.classList.contains("dark");
      let fillColor = cs.backgroundColor;
      let walk: Element | null = el;
      const alphaOf = (c: string) => {
        if (!c || c === "transparent") return 0;
        const comma = c.match(
          /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i,
        );
        if (comma) return Math.min(1, Math.max(0, +comma[1]));
        const modern = c.match(/\/\s*([\d.]+%?)\s*\)/);
        if (modern) {
          const a = modern[1].endsWith("%")
            ? parseFloat(modern[1]) / 100
            : +modern[1];
          return Math.min(1, Math.max(0, a));
        }
        return 1;
      };
      while (walk && alphaOf(fillColor) < 0.9) {
        walk = walk.parentElement;
        if (!walk) break;
        fillColor = getComputedStyle(walk).backgroundColor;
      }
      return {
        selector,
        borderColor: cs.borderTopColor || cs.borderColor,
        fillColor,
        text: `border:${el.tagName.toLowerCase()}`,
        dark,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
      };
    }, cand);

  for (const cand of cands) {
    await page.evaluate(({ sel, idx }) => {
      const el = document.querySelectorAll(sel)[idx] as HTMLElement | undefined;
      el?.scrollIntoView?.({ block: "center", inline: "nearest" });
    }, cand);
    await page.waitForTimeout(40);

    let meta = await readMeta(cand);
    if (!meta) {
      // One retry after layout settle (portal/list re-index); omit if still gone.
      await page.waitForTimeout(80);
      meta = await readMeta(cand);
    }
    if (!meta) continue;

    const border = parseCssColor(meta.borderColor);
    if (!border) continue;

    const shot = await page.screenshot({ type: "png", fullPage: false });
    const { data, info } = await sharp(shot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const viewport = await page.viewportSize();
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    const sx = viewport ? info.width / viewport.width : dpr;
    const sy = viewport ? info.height / viewport.height : dpr;
    const x = meta.x * sx;
    const y = meta.y * sy;
    const w = meta.w * sx;
    const h = meta.h * sy;
    const pad = 4 * Math.max(sx, sy);
    const cx = Math.round(x + w / 2);
    const midY = Math.round(y + h / 2);
    const pts: Array<[number, number]> = [
      [cx, Math.round(y - pad)],
      [cx, Math.round(y + h + pad)],
      [Math.round(x + w + pad), midY],
      [Math.round(x - pad), midY],
    ];
    const samples: number[][] = [];
    for (const [xx, yy] of pts) {
      const px = Math.min(info.width - 1, Math.max(0, xx));
      const py = Math.min(info.height - 1, Math.max(0, yy));
      const i = (py * info.width + px) * 4;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
    const fill = parseCssColor(meta.fillColor);
    const maxL = Math.max(...samples.map(lum));
    let surfaces: number[][];
    if (!meta.dark && maxL >= 120) {
      surfaces = samples.filter((s) => lum(s) >= Math.max(90, maxL - 70));
    } else {
      surfaces = samples;
    }
    const candidates = [...surfaces, ...(fill ? [fill] : [])].filter(Boolean);
    let worst = { bg: candidates[0] || [255, 255, 255], ratio: Infinity };
    for (const bg of candidates) {
      const r = contrastRatio(border, bg);
      if (r < 1.15) continue;
      if (r < worst.ratio) worst = { bg, ratio: r };
    }
    if (!Number.isFinite(worst.ratio)) {
      worst = { bg: [255, 255, 255], ratio: contrastRatio(border, [255, 255, 255]) };
    }
    results.push({
      selector: meta.selector,
      text: meta.text,
      fg: border,
      bg: worst.bg,
      ratio: Number(worst.ratio.toFixed(2)),
      required: 3,
      pass: worst.ratio >= 3,
      method: "ui-border",
    });
  }

  return results;
}

export async function auditPageState(
  page: Page,
  ctx: {
    route: string;
    state: string;
    locale: string;
    theme: string;
    viewport: string;
  },
  options?: { focus?: boolean; focusSelector?: string; borders?: boolean },
): Promise<AuditCheck[]> {
  await waitForVisualReady(page);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  // Finish finite enter animations BEFORE freeze — freezing mid-fade can hide
  // washed pairs (e.g. badge-active ~3.9:1) that axe would catch once settled,
  // or (worse) leave parents at partial opacity while we claim AA pass.
  await page.evaluate(async () => {
    const anims = (document.getAnimations?.() ?? []).filter((a) => {
      const iters = a.effect?.getTiming?.().iterations;
      return iters !== Infinity;
    });
    await Promise.race([
      Promise.all(anims.map((a) => a.finished.catch(() => undefined))),
      new Promise<void>((r) => setTimeout(r, 700)),
    ]);
  });
  // Freeze motion before axe + pixel sampling (run #7 transition-freeze).
  // Prevents axe from scoring Sonner mid-fade (e.g. success green @ α<1 → ~2.3:1).
  const pageFreeze = await page.addStyleTag({
    content: `
      html body, html body *, html body *::before, html body *::after {
        transition: none !important;
        animation: none !important;
      }
      [data-sonner-toast] { opacity: 1 !important; }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const checks: AuditCheck[] = [];

  const axe = await runAxeContrastChecks(page);
  for (const a of axe) {
    checks.push({
      ...ctx,
      selector: a.selector,
      text: a.text,
      fg: a.fg,
      bg: a.bg,
      ratio: a.ratio,
      required: a.required,
      pass: a.pass,
      method: a.method,
      rule: a.method,
      info: a.info,
      failureSummary: a.failureSummary,
    });
  }

  const texts = await auditAllVisibleText(page);
  for (const t of texts) {
    checks.push({
      ...ctx,
      selector: t.selector,
      text: t.text,
      fg: t.fg,
      bg: t.bg,
      ratio: t.ratio,
      required: t.required,
      pass: t.pass,
      method: t.method,
      info: t.info,
    });
  }

  // Second scroll pass for below-the-fold text (desktop pages)
  const scrolled = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
    return window.scrollY !== before;
  });
  if (scrolled) {
    await page.waitForTimeout(80);
    const more = await auditAllVisibleText(page);
    for (const t of more) {
      checks.push({
        ...ctx,
        selector: t.selector,
        text: t.text,
        fg: t.fg,
        bg: t.bg,
        ratio: t.ratio,
        required: t.required,
        pass: t.pass,
        method: t.method,
        info: t.info,
      });
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  }

  if (options?.focus === true) {
    const rings = await auditFocusRings(
      page,
      options.focusSelector || FOCUS_SELECTORS.default,
    );
    for (const r of rings) {
      checks.push({
        ...ctx,
        selector: r.selector,
        text: r.text,
        fg: r.fg,
        bg: r.bg,
        ratio: r.ratio,
        required: r.required,
        pass: r.pass,
        method: r.method,
      });
    }
  }

  if (options?.borders === true) {
    // Focus-ring tabbing can scroll OAuth/controls under the photo. Reset to
    // top first so the initial OAuth strip sits on the opaque card pad; then
    // auditUiBorders scrollIntoView(center)s each control before sampling
    // (so below-fold borders are not clamped to viewport edges).
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    await page.waitForTimeout(50);
    // Measure borders in the live focused/selected state (do not blur first).
    const borders = await auditUiBorders(page);
    for (const b of borders) {
      checks.push({
        ...ctx,
        selector: b.selector,
        text: b.text,
        fg: b.fg,
        bg: b.bg,
        ratio: b.ratio,
        required: b.required,
        pass: b.pass,
        method: b.method,
      });
    }
  }

  await pageFreeze.evaluate((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }).catch(() => undefined);

  return checks;
}

/** Map a route/state to the most likely source file for FINDINGS. */
export function guessSourceFile(route: string, state: string): string {
  const r = route.replace(/^\/(en|es)/, "");
  if (state.includes("toast")) return "src/components/ui/sonner.tsx / sonner";
  if (state.includes("pin")) return "src/components/ui/pin-input.tsx / settings/security";
  if (state.includes("asset") && state.includes("dialog")) return "src/components/AddAssetForm.tsx / AddAssetModal.tsx";
  if (state.includes("beneficiary") && state.includes("dialog")) return "src/components/AddBeneficiaryModal.tsx";
  if (state.includes("user-menu") || state.includes("sidebar")) return "src/components/LayoutWrapper.tsx";
  if (state.includes("validation") || state.includes("placeholder")) return "src/app/globals.css (tokens) + form components";
  if (r.startsWith("/dashboard")) return "src/app/[locale]/(dashboard)/dashboard/DashboardClient.tsx";
  if (r.startsWith("/beneficiaries")) return "src/app/[locale]/(dashboard)/beneficiaries/BeneficiariesClient.tsx";
  if (r.startsWith("/my-beneficiary")) return "src/app/[locale]/(dashboard)/my-beneficiary-relationships/page.tsx";
  if (r.startsWith("/digital-assets")) return "src/app/[locale]/(dashboard)/digital-assets/DigitalAssetsClient.tsx";
  if (r.startsWith("/billing/plans")) return "src/app/[locale]/(dashboard)/billing/plans/page.tsx";
  if (r.startsWith("/billing")) return "src/app/[locale]/(dashboard)/billing/page.tsx";
  if (r.startsWith("/settings/security")) return "src/app/[locale]/(dashboard)/settings/security/page.tsx";
  if (r.startsWith("/settings/preferences")) return "src/app/[locale]/(dashboard)/settings/preferences/page.tsx";
  if (r.startsWith("/settings")) return "src/app/[locale]/(dashboard)/settings/page.tsx";
  if (r.startsWith("/wizard")) return "src/app/[locale]/(dashboard)/wizard/page.tsx";
  if (r.startsWith("/auth/login") || r.startsWith("/auth/register")) return "src/components/auth/auth-form.tsx";
  if (r.startsWith("/auth/forgot")) return "src/components/auth/forgot-password-form.tsx";
  if (r.startsWith("/auth/reset")) return "src/components/auth/reset-password-form.tsx";
  if (r.startsWith("/auth")) return "src/app/[locale]/auth/page.tsx";
  if (r.includes("wompi")) return "src/app/[locale]/payments/wompi/return/page.tsx";
  if (r.includes("payu")) return "src/app/[locale]/payments/payu/return/page.tsx";
  if (r.includes("verify-beneficiary")) return "src/app/[locale]/verify-beneficiary-email/page.tsx";
  if (r === "" || r === "/") return "src/app/[locale]/LandingPage.tsx";
  return "src/app/globals.css (design tokens) / shared UI";
}
