/**
 * One-off KAN-146 diagnosis (env-gated). Captures full-run vs isolated crops + styles.
 * DIAGNOSIS=1 PLAYWRIGHT_E2E_REAL_SUPABASE=1 PLAYWRIGHT_TEST_BASE_URL=http://localhost:3007 \
 *   npx playwright test e2e/contrast-diagnosis7.spec.ts
 */
import { test, expect } from "./fixtures/test";
import { loginViaUi } from "./fixtures/ui";
import {
  auditAllVisibleText,
  setTheme,
  waitForVisualReady,
  contrastRatio,
  parseCssColorWithAlpha,
} from "./lib/contrast";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const OUT = "/tmp/iablee-contrast3-shots/diagnosis";
const RUN = process.env.DIAGNOSIS === "1";

type StyleDump = {
  text: string;
  tag: string;
  className: string;
  color: string;
  colorAlpha: number;
  webkitFill: string;
  opacity: string;
  ancestorOpacities: string[];
  backgroundColor: string;
  backgroundImage: string;
  transition: string;
  solidBg: number[] | null;
  rect: { x: number; y: number; w: number; h: number };
};

async function dumpMatching(
  page: import("@playwright/test").Page,
  match: RegExp,
): Promise<StyleDump[]> {
  return page.evaluate((patternSource) => {
    const re = new RegExp(patternSource, "i");
    const parseAlpha = (color: string): number => {
      if (!color || color === "transparent") return 0;
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
    const out: StyleDump[] = [];
    const walk = (root: Node) => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = tw.currentNode as Element | null;
      while (node) {
        const el = node;
        const parts: string[] = [];
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            const t = (child.textContent || "").trim();
            if (t) parts.push(t);
          }
        }
        const text = parts.join(" ");
        if (text && re.test(text)) {
          const cs = getComputedStyle(el);
          let solidBg: number[] | null = null;
          let walkEl: Element | null = el;
          while (walkEl) {
            const wcs = getComputedStyle(walkEl);
            const raw = wcs.backgroundColor;
            const alpha = parseAlpha(raw);
            if (alpha >= 1 && raw && raw !== "transparent" && !solidBg) {
              const m = raw.match(/rgba?\(([^)]+)\)/);
              if (m) {
                const nums = m[1]
                  .split(/[,\s/]+/)
                  .map((p) => parseFloat(p))
                  .filter((n) => !Number.isNaN(n));
                if (nums.length >= 3) {
                  const tag = walkEl.tagName.toLowerCase();
                  if (tag !== "body" && tag !== "html") {
                    solidBg = [
                      Math.round(nums[0]),
                      Math.round(nums[1]),
                      Math.round(nums[2]),
                    ];
                  }
                }
              }
            }
            walkEl = walkEl.parentElement;
          }
          const opacities: string[] = [];
          let a: Element | null = el;
          while (a) {
            const o = getComputedStyle(a).opacity;
            if (o && o !== "1") opacities.push(`${a.tagName}:${o}`);
            a = a.parentElement;
          }
          const rect = el.getBoundingClientRect();
          out.push({
            text: text.slice(0, 80),
            tag: el.tagName.toLowerCase(),
            className: (el.getAttribute("class") || "").slice(0, 200),
            color: cs.color,
            colorAlpha: parseAlpha(cs.color),
            webkitFill: cs.getPropertyValue("-webkit-text-fill-color"),
            opacity: cs.opacity,
            ancestorOpacities: opacities,
            backgroundColor: cs.backgroundColor,
            backgroundImage: (cs.backgroundImage || "").slice(0, 120),
            transition: cs.transition || cs.getPropertyValue("transition"),
            solidBg,
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          });
        }
        node = tw.nextNode() as Element | null;
      }
    };
    walk(document.body);
    return out;
  }, match.source);
}

async function captureCrops(
  page: import("@playwright/test").Page,
  label: string,
  match: RegExp,
) {
  const dumps = await dumpMatching(page, match);
  const shotVisible = await page.screenshot({ type: "png", fullPage: false });
  // text-hidden shot
  const style = await page.addStyleTag({
    content: `
      html body [data-diag], html body [data-diag] * {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
      }
    `,
  });
  // mark targets
  await page.evaluate((patternSource) => {
    const re = new RegExp(patternSource, "i");
    document.querySelectorAll("body *").forEach((el) => {
      for (const child of Array.from(el.childNodes)) {
        if (
          child.nodeType === Node.TEXT_NODE &&
          re.test((child.textContent || "").trim())
        ) {
          (el as HTMLElement).setAttribute("data-diag", "1");
        }
      }
    });
  }, match.source);
  // wait short (current audit) vs long (settled)
  await page.waitForTimeout(50);
  const shotHidden50 = await page.screenshot({ type: "png", fullPage: false });
  await page.waitForTimeout(400);
  const shotHidden450 = await page.screenshot({ type: "png", fullPage: false });
  await style.evaluate((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }).catch(() => undefined);
  await page.evaluate(() => {
    document.querySelectorAll("[data-diag]").forEach((el) => el.removeAttribute("data-diag"));
  });

  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "styles.json"), JSON.stringify(dumps, null, 2));

  const vp = page.viewportSize() || { width: 1280, height: 800 };
  for (let i = 0; i < dumps.length; i++) {
    const d = dumps[i];
    const left = Math.max(0, Math.floor(d.rect.x) - 4);
    const top = Math.max(0, Math.floor(d.rect.y) - 4);
    const width = Math.min(vp.width - left, Math.ceil(d.rect.w) + 8);
    const height = Math.min(vp.height - top, Math.ceil(d.rect.h) + 8);
    if (width < 2 || height < 2) continue;
    const crop = async (buf: Buffer, name: string) => {
      await sharp(buf)
        .extract({ left, top, width, height })
        .png()
        .toFile(path.join(dir, `${i}-${name}.png`));
    };
    await crop(shotVisible, "text-visible");
    await crop(shotHidden50, "text-hidden-50ms");
    await crop(shotHidden450, "text-hidden-450ms");

    // sample center pixel from hidden-50 and hidden-450
    const sample = async (buf: Buffer) => {
      const { data, info } = await sharp(buf)
        .extract({
          left: Math.min(vp.width - 1, Math.max(0, Math.round(d.rect.x + d.rect.w * 0.5))),
          top: Math.min(vp.height - 1, Math.max(0, Math.round(d.rect.y + d.rect.h * 0.5))),
          width: 1,
          height: 1,
        })
        .raw()
        .ensureAlpha()
        .toBuffer({ resolveWithObject: true });
      void info;
      return [data[0], data[1], data[2]];
    };
    const bg50 = await sample(shotHidden50);
    const bg450 = await sample(shotHidden450);
    const fgParsed = parseCssColorWithAlpha(d.color);
    const rows = {
      ...d,
      bgSample50: bg50,
      bgSample450: bg450,
      solidBgRatio:
        d.solidBg && fgParsed
          ? Number(
              contrastRatio(
                fgParsed.a >= 0.95
                  ? fgParsed.rgb
                  : [
                      Math.round(fgParsed.rgb[0] * fgParsed.a + d.solidBg[0] * (1 - fgParsed.a)),
                      Math.round(fgParsed.rgb[1] * fgParsed.a + d.solidBg[1] * (1 - fgParsed.a)),
                      Math.round(fgParsed.rgb[2] * fgParsed.a + d.solidBg[2] * (1 - fgParsed.a)),
                    ],
                d.solidBg,
              ).toFixed(2),
            )
          : null,
      opaqueInkRatio:
        d.solidBg && fgParsed
          ? Number(contrastRatio(fgParsed.rgb, d.solidBg).toFixed(2))
          : null,
    };
    fs.writeFileSync(path.join(dir, `${i}-metrics.json`), JSON.stringify(rows, null, 2));
  }
  return dumps;
}

test.describe("KAN-146 diagnosis #7", () => {
  test.skip(!RUN, "Set DIAGNOSIS=1");

  test("isolated vs full-run crops", async ({ page, user }) => {
    fs.mkdirSync(OUT, { recursive: true });
    const summary: Array<Record<string, unknown>> = [];

    // --- ISOLATED: register CTA light ---
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en/auth/register", { waitUntil: "load" });
    await setTheme(page, "light");
    await waitForVisualReady(page);
    await page.waitForTimeout(500);
    await captureCrops(page, "isolated-register-light", /^(Create account|Crear cuenta)$/);
    const isoLight = await auditAllVisibleText(page);
    const isoCta = isoLight.filter((r) => /Create account|Crear cuenta/i.test(r.text));
    summary.push({ ctx: "isolated-register-light", audit: isoCta });

    await setTheme(page, "dark");
    await waitForVisualReady(page);
    await page.waitForTimeout(500);
    await captureCrops(page, "isolated-register-dark", /^(Create account|Crear cuenta)$/);
    const isoDark = await auditAllVisibleText(page);
    summary.push({
      ctx: "isolated-register-dark",
      audit: isoDark.filter((r) => /Create account|Crear cuenta/i.test(r.text)),
    });

    // --- FULL-RUN-LIKE: login, wander, then remeasure register + billing sidebar ---
    await loginViaUi(page, user, "en");
    await setTheme(page, "light");
    await page.goto("/en/dashboard", { waitUntil: "load" });
    await waitForVisualReady(page);
    await page.goto("/en/billing/plans", { waitUntil: "load" });
    await waitForVisualReady(page);
    // hover a nav item then leave (leave transition mid-flight risk)
    const dash = page.getByRole("link", { name: /dashboard/i }).first();
    await dash.hover();
    await page.waitForTimeout(80);
    await captureCrops(
      page,
      "fullrun-billing-sidebar-light",
      /^(Dashboard|Digital Assets|Beneficiaries|I.m a beneficiary of|Billing|Setup Wizard)$/,
    );
    const billAudit = await auditAllVisibleText(page);
    summary.push({
      ctx: "fullrun-billing-sidebar-light",
      audit: billAudit.filter((r) =>
        /Dashboard|Digital Assets|Beneficiaries|beneficiary|Billing|Setup Wizard|Subscribe|Save/i.test(
          r.text,
        ),
      ),
    });

    // Subscribe / primary buttons on plans
    await captureCrops(page, "fullrun-subscribe-light", /^(Subscribe|Suscribirse|Save|Guardar)$/);

    // Back to register while still "warm" session context (logged out path)
    await page.goto("/en/auth/register", { waitUntil: "load" });
    await setTheme(page, "light");
    await waitForVisualReady(page);
    // deliberately short settle (mimic busy audit)
    await page.waitForTimeout(50);
    await captureCrops(page, "fullrun-register-light-rush", /^(Create account|Crear cuenta)$/);
    const rush = await auditAllVisibleText(page);
    summary.push({
      ctx: "fullrun-register-light-rush",
      audit: rush.filter((r) => /Create account|Crear cuenta/i.test(r.text)),
    });

    // toast success colour (axe failures)
    await page.goto("/en/billing/plans", { waitUntil: "load" });
    await setTheme(page, "light");
    await waitForVisualReady(page);
    await page.evaluate(() => {
      const t = (window as Window & { __iableeToast?: { success: (m: string) => void } })
        .__iableeToast;
      t?.success("Subscription created successfully");
    });
    await page.waitForTimeout(300);
    await captureCrops(page, "fullrun-toast-success-light", /Subscription created successfully/);
    const toastAudit = await auditAllVisibleText(page);
    summary.push({
      ctx: "fullrun-toast-success-light",
      audit: toastAudit.filter((r) => /Subscription created/i.test(r.text)),
    });

    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
    expect(summary.length).toBeGreaterThan(0);
  });
});
