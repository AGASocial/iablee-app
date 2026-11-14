/**
 * Run #10 diagnosis: fill-sample glyph proof + settings ui-border dump.
 * DIAGNOSIS10=1 PLAYWRIGHT_E2E_REAL_SUPABASE=1 PLAYWRIGHT_TEST_BASE_URL=http://localhost:3007 \
 *   npx playwright test e2e/contrast-diagnosis10.spec.ts
 */
import { test, expect } from "./fixtures/test";
import { loginViaUi } from "./fixtures/ui";
import {
  auditUiBorders,
  contrastRatio,
  parseCssColor,
  setTheme,
  waitForVisualReady,
} from "./lib/contrast";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const OUT = "/tmp/iablee-contrast3-shots/diagnosis/fill-sample";
const RUN = process.env.DIAGNOSIS10 === "1";

test.describe("KAN-146 run #10 diagnosis", () => {
  test.skip(!RUN, "Set DIAGNOSIS10=1");

  test("fill-sample glyph proof + settings border dump", async ({ page, user }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await loginViaUi(page, user, "en");
    // Light theme: dark search icon over white fill is the classic false-bg case.
    await setTheme(page, "light");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en/digital-assets", { waitUntil: "load" });
    await waitForVisualReady(page);

    const search = page.locator(".relative input").first();
    await expect(search).toBeVisible({ timeout: 15_000 });
    const box = await search.boundingBox();
    if (!box) throw new Error("no search box");

    const meta = await search.evaluate((el) => {
      const cs = getComputedStyle(el);
      const ph = getComputedStyle(el, "::placeholder").color || cs.color;
      const icon = el.parentElement?.querySelector("svg");
      const ir = icon?.getBoundingClientRect();
      el.setAttribute("data-contrast-audit-id", "fill-sample-proof");
      return {
        fill: cs.backgroundColor,
        placeholder: ph,
        border: cs.borderTopColor,
        icon: ir
          ? { x: ir.x, y: ir.y, w: ir.width, h: ir.height }
          : null,
        input: (() => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })(),
      };
    });

    // BEFORE: live paint (placeholder glyphs + search icon visible in bbox)
    const shotBefore = await page.screenshot({ type: "png" });
    // AFTER hide: same inject as auditAllVisibleText — glyphs gone; sibling SVG icon remains
    const hide = await page.addStyleTag({
      content: `
        html body [data-contrast-audit-id],
        html body [data-contrast-audit-id] * {
          color: transparent !important;
          -webkit-text-fill-color: transparent !important;
          caret-color: transparent !important;
          text-shadow: none !important;
        }
        html body [data-contrast-audit-id]::placeholder {
          color: transparent !important;
          -webkit-text-fill-color: transparent !important;
        }
      `,
    });
    await page.waitForTimeout(50);
    const shotAfterHide = await page.screenshot({ type: "png" });
    await hide.dispose().catch(() => undefined);

    const sampleShot = async (shot: Buffer, x: number, y: number) => {
      const { data, info } = await sharp(shot).raw().ensureAlpha().toBuffer({
        resolveWithObject: true,
      });
      const dpr = info.width / (await page.viewportSize())!.width;
      const px = Math.min(info.width - 1, Math.max(0, Math.round(x * dpr)));
      const py = Math.min(info.height - 1, Math.max(0, Math.round(y * dpr)));
      const i = (py * info.width + px) * 4;
      return {
        rgb: [data[i], data[i + 1], data[i + 2]] as [number, number, number],
        dpr,
        info,
      };
    };

    const iconX = meta.icon ? meta.icon.x + meta.icon.w / 2 : box.x + 20;
    const iconY = meta.icon ? meta.icon.y + meta.icon.h / 2 : box.y + box.height / 2;
    const midX = box.x + Math.max(box.width * 0.55, 48);
    const midY = box.y + box.height / 2;

    const beforeIcon = await sampleShot(shotBefore, iconX, iconY);
    const beforeMid = await sampleShot(shotBefore, midX, midY);
    const afterIcon = await sampleShot(shotAfterHide, iconX, iconY);
    const afterMid = await sampleShot(shotAfterHide, midX, midY);
    const solidBg = parseCssColor(meta.fill);
    const phColor = parseCssColor(meta.placeholder);
    if (!solidBg || !phColor) throw new Error("parse failed");

    const ratios = {
      beforeGlyphOrIconVsPh: Number(contrastRatio(phColor, beforeMid.rgb).toFixed(2)),
      beforeIconCenterVsPh: Number(contrastRatio(phColor, beforeIcon.rgb).toFixed(2)),
      afterHideIconStillVsPh: Number(contrastRatio(phColor, afterIcon.rgb).toFixed(2)),
      afterHideMidFillVsPh: Number(contrastRatio(phColor, afterMid.rgb).toFixed(2)),
      solidBgVsPh: Number(contrastRatio(phColor, solidBg).toFixed(2)),
      required: 4.5,
    };

    const dpr = beforeIcon.dpr;
    const extract = async (shot: Buffer, name: string, x: number, y: number, w: number, h: number) => {
      await sharp(shot)
        .extract({
          left: Math.round(x * dpr),
          top: Math.round(y * dpr),
          width: Math.max(1, Math.round(w * dpr)),
          height: Math.max(1, Math.round(h * dpr)),
        })
        .png()
        .toFile(path.join(OUT, name));
    };
    await extract(shotBefore, "before-with-glyphs-and-icon.png", box.x, box.y, box.width, box.height);
    await extract(shotAfterHide, "after-text-hidden-icon-remains.png", box.x, box.y, box.width, box.height);
    if (meta.icon) {
      await extract(
        shotAfterHide,
        "before-icon-overlap.png",
        meta.icon.x - 2,
        meta.icon.y - 2,
        meta.icon.w + 4,
        meta.icon.h + 4,
      );
    }
    await extract(shotAfterHide, "after-true-fill.png", midX - 20, box.y, 40, box.height);

    const falseFail =
      (ratios.beforeGlyphOrIconVsPh < 4.5 || ratios.afterHideIconStillVsPh < 4.5) &&
      ratios.solidBgVsPh >= 4.5;
    const markedlyWorse =
      Math.min(ratios.beforeGlyphOrIconVsPh, ratios.afterHideIconStillVsPh) <
      ratios.solidBgVsPh - 2;

    const evidence = {
      meta,
      samples: {
        beforeMidPixel_mayIncludeGlyph: beforeMid.rgb,
        beforeIconCenter: beforeIcon.rgb,
        afterHideIconCenter_siblingSvgRemains: afterIcon.rgb,
        afterHideMidFill: afterMid.rgb,
        computedSolidBg: solidBg,
        placeholderColor: phColor,
      },
      ratios,
      verdict: falseFail
        ? "PROVEN: glyph/icon pixels inside input bbox fail AA; computed solidBg passes"
        : markedlyWorse
          ? "PROVEN: glyph/icon pixels markedly worse than solidBg (false-bg risk without solidBg)"
          : "NOT PROVEN: could not show glyph/icon false-fail vs solidBg",
    };
    fs.writeFileSync(path.join(OUT, "samples.json"), JSON.stringify(evidence, null, 2));

    // Settings border dump (dark mobile)
    await page.setViewportSize({ width: 375, height: 812 });
    await setTheme(page, "dark");
    await page.goto("/en/settings", { waitUntil: "load" });
    await waitForVisualReady(page);
    const borders = await auditUiBorders(page);
    const liveInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input:not([type='hidden'])")).map((el, idx) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          idx,
          id: (el as HTMLInputElement).id,
          disabled: (el as HTMLInputElement).disabled,
          border: cs.borderTopColor,
          fill: cs.backgroundColor,
          cls: (el as HTMLElement).className,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      });
    });
    fs.writeFileSync(
      path.join(OUT, "settings-border-dump.json"),
      JSON.stringify({ borders, liveInputs }, null, 2),
    );

    const readme = `# Fill-sample proof (KAN-146 run #10)

## Question
Does the run #9 "fill-sample fix (no glyph false fail)" correctly avoid sampling
non-background pixels (search icon / placeholder glyph) inside an input bbox as the fill?

## Method
1. Light theme, \`/en/digital-assets\` FilterBar search input (Lucide \`Search\` SVG
   is a **sibling** of the input, absolutely positioned over the left padding).
2. Capture **before** (glyphs + icon visible) and **after** the same transparent-text
   inject used by \`auditAllVisibleText\` (glyphs hidden; sibling SVG **remains**).
3. Compare placeholder contrast against: mid-bbox pixel (glyphs), icon-center pixel,
   post-hide mid fill, and computed \`backgroundColor\` (\`solidBg\`).

## Results
\`\`\`json
${JSON.stringify(evidence.samples, null, 2)}
\`\`\`

| Pair | Ratio |
|---|---:|
| placeholder vs mid pixel (glyphs visible) | ${ratios.beforeGlyphOrIconVsPh}:1 |
| placeholder vs icon center (before) | ${ratios.beforeIconCenterVsPh}:1 |
| placeholder vs icon center (text hidden, SVG remains) | ${ratios.afterHideIconStillVsPh}:1 |
| placeholder vs mid fill (text hidden) | ${ratios.afterHideMidFillVsPh}:1 |
| placeholder vs computed solidBg | ${ratios.solidBgVsPh}:1 |
| required | ${ratios.required}:1 |

## Verdict
**${evidence.verdict}**

## Crops
- \`before-with-glyphs-and-icon.png\` — live control (placeholder ink + search icon)
- \`after-text-hidden-icon-remains.png\` — after transparent-text inject (icon stays)
- \`before-icon-overlap.png\` — icon crop after hide
- \`after-true-fill.png\` — mid-field fill after hide
- \`samples.json\` — raw values
`;
    fs.writeFileSync(path.join(OUT, "README.md"), readme);
    console.log(JSON.stringify(evidence, null, 2));
  });
});
