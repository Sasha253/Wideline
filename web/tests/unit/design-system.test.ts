import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Design-system guards for Floodlight (docs/design-handoff/): no hard-coded colours in the UI
// library or the component CSS, the token files stay verbatim copies of the handoff, and the
// legacy alias block defines no colours of its own.

const web = join(import.meta.dirname, "../..");
const styles = join(web, "src/styles");
const uiDir = join(web, "src/components/ui");
const componentsCssDir = join(styles, "components");
const handoff = join(web, "../docs/design-handoff");

const devDir = join(web, "src/app/dev");
// D02: the app shell, page templates, shared states and the template showcase.
const d02Dirs = ["shell", "templates", "states"].map((d) => join(web, "src/components", d));
const templatesShowcase = join(web, "src/app/(app)/dev/templates");

const filesIn = (dir: string, pattern: RegExp) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => pattern.test(f))
    .map((f) => join(dir, f));

const uiFiles = [uiDir, devDir, ...d02Dirs, templatesShowcase].flatMap((dir) =>
  filesIn(dir, /\.(ts|tsx|css)$/),
);
const componentCss = filesIn(componentsCssDir, /\.css$/);

describe("no hard-coded colours or spacing", () => {
  it.each([...uiFiles, ...componentCss])("%s uses tokens only", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgba?|hsla?)\(/);
  });

  it.each(uiFiles)("%s has no arbitrary px utilities", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/-\[\d+px\]/);
  });
});

describe("component CSS", () => {
  it("is split into the core, domain and shell groups", () => {
    for (const group of ["core", "domain", "shell"]) {
      expect(existsSync(join(componentsCssDir, `${group}.css`)), group).toBe(true);
    }
    expect(existsSync(join(styles, "components.css"))).toBe(false);
  });
});

describe("fonts", () => {
  it("loads Archivo (with the width axis) and JetBrains Mono only", () => {
    const layout = readFileSync(join(web, "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/Archivo\(\{[\s\S]*axes: \["wdth"\]/);
    expect(layout).toContain("JetBrains_Mono(");
    expect(layout).not.toMatch(/Barlow|Instrument|Plex/);
  });
});

// The repo copies differ from the handoff only by the repo note and the next/font variables.
const normalise = (css: string) =>
  css
    .replace(/\/\* Wideline repo note:[\s\S]*?\*\/\n\n/, "")
    .replace(/var\(--font-archivo, ("Archivo")\)/g, "$1")
    .replace(/var\(--font-jetbrains, ("JetBrains Mono")\)/g, "$1");

describe("Floodlight token files", () => {
  it("wideline-tailwind.css clears the default palette", () => {
    const css = readFileSync(join(styles, "wideline-tailwind.css"), "utf8");
    expect(css).toContain("--color-*: initial;");
    expect(css).toContain("--radius-*: initial;");
  });

  it("wideline-tokens.css points the font stacks at next/font", () => {
    const css = readFileSync(join(styles, "wideline-tokens.css"), "utf8");
    expect(css).toContain('--wl-font-ui: var(--font-archivo, "Archivo")');
    expect(css).toContain('--wl-font-mono: var(--font-jetbrains, "JetBrains Mono")');
  });

  it("the temporary legacy layer is gone", () => {
    expect(existsSync(join(styles, "tokens.css"))).toBe(false);
    const globals = readFileSync(join(web, "src/app/globals.css"), "utf8");
    expect(globals).not.toContain('"../styles/tokens.css"');
    expect(globals).not.toMatch(/--breakpoint-(md|lg|xl)|--color-surface|\.text-pitch/);
  });

  // The old variable names (--surface, --pitch, --space-4…) no longer exist anywhere.
  it.each(componentCss)("%s uses no legacy variable names", (file) => {
    const css = readFileSync(file, "utf8");
    expect(css).not.toMatch(
      /var\(--(surface|line|ink|pitch|on-pitch|floodlight|on-floodlight|home|away|warning|danger|focus|turf|chalk|heat-\d|shadow-pop|space-\d+|radius-\w+|font-(sans|display|mono))(-[\w-]+)?\)/,
    );
  });

  // docs/ is not mounted in the web container; CI has the full checkout.
  it.skipIf(!existsSync(handoff))("are documented in docs/design-handoff", () => {
    expect(existsSync(join(handoff, "README.md"))).toBe(true);
    expect(existsSync(join(handoff, "A11Y.md"))).toBe(true);
    expect(existsSync(join(handoff, "IMPLEMENTATION.md"))).toBe(true);
  });

  it("normalise() strips only the repo-specific edits", () => {
    const css = readFileSync(join(styles, "wideline-tokens.css"), "utf8");
    const out = normalise(css);
    expect(out).toContain('--wl-font-ui: "Archivo", system-ui, sans-serif;');
    expect(out).not.toContain("Wideline repo note");
  });
});
