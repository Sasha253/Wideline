import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Design-system guards for D01: no hard-coded colours in the UI library, and
// the repo's CSS stays in sync with docs/design-system/.

const web = join(import.meta.dirname, "../..");
const uiDir = join(web, "src/components/ui");
const componentsCss = join(web, "src/styles/components.css");
const tokensCss = join(web, "src/styles/tokens.css");
const designSystem = join(web, "../docs/design-system");

const devDir = join(web, "src/app/dev");

const uiFiles = [uiDir, devDir].flatMap((dir) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx|css)$/.test(f))
    .map((f) => join(dir, f)),
);

describe("no hard-coded colours or spacing", () => {
  it.each([...uiFiles, componentsCss])("%s uses tokens only", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgba?|hsla?)\(/);
  });

  it.each(uiFiles)("%s has no arbitrary px utilities", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/-\[\d+px\]/);
  });
});

// The Additions block (local rules at the end of components.css) takes its type from the
// type classes in tokens.css and its spacing from --space-* tokens. These are the only
// accepted exceptions, recorded in docs/build/STATUS.md (D01):
// - 88px: the Cover wordmark from 768px, from Cover/preview.html; not on the type scale.
// - 3.2px: the AveragePositionMap dot label, in SVG user units of the pitch viewBox.
const ACCEPTED_FONT_SIZES = ["3.2px", "88px"];

describe("components.css Additions block", () => {
  const css = readFileSync(componentsCss, "utf8");
  const additions = css.slice(css.indexOf("/* Additions")).replace(/\/\*[\s\S]*?\*\//g, "");

  it("exists", () => {
    expect(css.indexOf("/* Additions")).toBeGreaterThan(0);
  });

  it("hard-codes no font size apart from the accepted exceptions", () => {
    const sizes = [...additions.matchAll(/\bfont(?:-size)?\s*:([^;}]*)/g)].flatMap(
      ([, value]) => value!.match(/\d*\.?\d+(?:px|rem|em|pt)\b/g) ?? [],
    );
    expect(sizes.sort()).toEqual(ACCEPTED_FONT_SIZES);
  });

  it("uses spacing tokens for margin, padding and gaps", () => {
    const spacing = [
      ...additions.matchAll(/\b(?:margin|padding|gap|row-gap|column-gap)(?:-\w+)?\s*:([^;}]*)/g),
    ].filter(([, value]) => /\d*\.?\d+px\b/.test(value!));
    expect(spacing.map(([decl]) => decl)).toEqual([]);
  });
});

/** Splits CSS into rules, whitespace-normalised, dropping comments. */
function rules(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((r) => r.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((r) => `${r} }`);
}

// docs/ is not mounted in the web container; CI has the full checkout.
describe.skipIf(!existsSync(designSystem))("in sync with docs/design-system", () => {
  it("tokens.css matches, apart from the stray }} fix", () => {
    const source = readFileSync(join(designSystem, "tokens.css"), "utf8").replaceAll("}}", "}");
    expect(readFileSync(tokensCss, "utf8")).toBe(source);
  });

  it("components.css holds every bundle rule, in order", () => {
    const bundle = readFileSync(join(designSystem, "components/bundle.css"), "utf8")
      .split("\n")
      // Deliberate omissions: fonts load via next/font, and globals.css owns body.
      .filter((line) => !line.startsWith("@import") && !line.startsWith("body {"))
      .join("\n");
    const local = rules(readFileSync(componentsCss, "utf8"));
    let from = 0;
    for (const rule of rules(bundle)) {
      const at = local.indexOf(rule, from);
      expect(at, `missing or out of order: ${rule}`).toBeGreaterThanOrEqual(0);
      from = at + 1;
    }
  });
});
