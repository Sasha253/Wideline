# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: upload.spec.ts >> accepted footage takes kickoff and half-time markers, typed as mm:ss
- Location: tests/e2e/upload.spec.ts:176:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Half-time must be after kickoff.')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Half-time must be after kickoff.') with timeout 10000ms
  - waiting for getByText('Half-time must be after kickoff.')

```

```yaml
- link "Skip to content":
  - /url: "#main"
- complementary "Sidebar":
  - link "Wideline":
    - /url: /
  - 'button "Organisation: Wideline Demo FC. Switch organisation"': Organisation Wideline Demo FC
  - navigation "Main":
    - list:
      - listitem:
        - link "Dashboard":
          - /url: /dashboard
      - listitem:
        - link "Squad":
          - /url: /squad
      - listitem:
        - link "Matches":
          - /url: /matches
      - listitem:
        - link "Settings":
          - /url: /settings/organisation
  - paragraph: Lab Admin
  - paragraph: admin@wideline.localhost
  - link "Your organisations":
    - /url: /organisations
  - button "Sign out"
- main:
  - link "Back to Match":
    - /url: /matches/cmvmz8bdd00f931nqqx140hm5
  - heading "Kickoff and half-time" [level=1]
  - paragraph: Mark four moments in the video, so video time maps to match minutes.
  - region "Video":
    - heading "Video" [level=2]
  - region "Markers":
    - heading "Markers" [level=2]
    - list:
      - listitem:
        - text: Kickoff
        - textbox "Kickoff": 0:05
        - paragraph: The first whistle. For example 2:31.
      - listitem:
        - text: Half-time
        - textbox "Half-time": 0:04
        - paragraph: The whistle that ends the first half. For example 2:31.
      - listitem:
        - text: Second-half kickoff
        - textbox "Second-half kickoff"
        - paragraph: The whistle that starts the second half. For example 2:31.
      - listitem:
        - text: Full time
        - textbox "Full time"
        - paragraph: The final whistle. For example 2:31.
    - paragraph: Unsaved changes
    - button "Saving…" [disabled]
- alert
```

# Test source

```ts
  93  |   block.on = false;
  94  |   await page.getByRole("button", { name: "Retry now" }).click();
  95  |   await expect(page).toHaveURL(/\/matches\/[^/?]+\?done=uploaded/, { timeout: 60_000 });
  96  |   await expect(page.getByRole("status").filter({ hasText: "Upload complete." })).toBeVisible();
  97  |   // Part 1 went once, in the first attempt; 2 and 3 after the connection came back.
  98  |   expect(sentCount(log, 1)).toBe(1);
  99  |   expect(sentCount(log, 2)).toBe(1);
  100 |   expect(sentCount(log, 3)).toBe(1);
  101 |   expect(log.filter((p) => !p.sent).length).toBeGreaterThan(0);
  102 | });
  103 | 
  104 | test("a reload mid-upload resumes from the same point with the same file", async ({ page }) => {
  105 |   test.setTimeout(180_000);
  106 |   const path = await createMatch(page, { home: ownId, awayLabel: `${oppName} (2026)` });
  107 |   const log: PutLog = [];
  108 |   const block = { on: true };
  109 |   await routeParts(page, log, block);
  110 |   await page.goto(`${path}/upload`);
  111 |   await page.locator('input[type="file"]').setInputFiles(FOOTAGE_1080P);
  112 |   await page.getByRole("button", { name: "Start upload" }).click();
  113 |   await expect(page.getByText("Connection lost. Retrying in", { exact: false })).toBeVisible({
  114 |     timeout: 30_000,
  115 |   });
  116 |   expect(sentCount(log, 1)).toBe(1);
  117 | 
  118 |   await page.reload();
  119 |   await expect(page.getByRole("heading", { level: 2, name: "Carry on uploading" })).toBeVisible();
  120 |   await expect(
  121 |     page.getByText(
  122 |       "The upload of footage-1080p.mp4 stopped at 40%. Choose the same file to carry on from there.",
  123 |     ),
  124 |   ).toBeVisible();
  125 |   await expectNoAxeViolations(page);
  126 |   // Another file is refused with the C06 copy.
  127 |   await page.locator('input[type="file"]').setInputFiles(FOOTAGE_720P);
  128 |   await expect(
  129 |     page.getByText(/^This is not the file you started with \(footage-1080p\.mp4/),
  130 |   ).toBeVisible();
  131 | 
  132 |   await page.locator('input[type="file"]').setInputFiles(FOOTAGE_1080P);
  133 |   await expect(page.getByText("Resuming from 40%")).toBeVisible();
  134 |   block.on = false;
  135 |   // The next automatic retry may already have finished the upload.
  136 |   await page
  137 |     .getByRole("button", { name: "Retry now" })
  138 |     .click({ timeout: 2000 })
  139 |     .catch(() => {});
  140 |   await expect(page).toHaveURL(/\/matches\/[^/?]+\?done=uploaded/, { timeout: 60_000 });
  141 |   // Part 1 never went again after the reload.
  142 |   expect(sentCount(log, 1)).toBe(1);
  143 | });
  144 | 
  145 | test("720p footage is rejected with re-film guidance", async ({ page }) => {
  146 |   test.setTimeout(180_000);
  147 |   const path = await createMatch(page, { home: ownId, awayLabel: `${oppName} (2026)` });
  148 |   await page.goto(`${path}/upload`);
  149 |   await page.locator('input[type="file"]').setInputFiles(FOOTAGE_720P);
  150 |   // The browser pre-check reads the frame size and warns before the upload.
  151 |   await expect(
  152 |     page.getByText(
  153 |       "This video looks like 1280 × 720. Footage under 1080p is rejected after upload.",
  154 |     ),
  155 |   ).toBeVisible();
  156 |   await expect(page.getByRole("button", { name: "Choose another file" })).toHaveClass(
  157 |     /wl-btn--primary/,
  158 |   );
  159 |   await page.getByRole("button", { name: "Upload anyway" }).click();
  160 |   await expect(page).toHaveURL(/\?done=uploaded/, { timeout: 60_000 });
  161 |   // The worker checks the footage; the page polls, a reload is the same.
  162 |   await expect(async () => {
  163 |     await page.reload();
  164 |     await expect(page.getByText("This footage cannot be used.")).toBeVisible({ timeout: 1000 });
  165 |   }).toPass({ timeout: 90_000 });
  166 |   await expect(
  167 |     page.getByText("This video is 1280 × 720. Wideline needs at least 1080p (1920 × 1080)."),
  168 |   ).toBeVisible();
  169 |   await expect(
  170 |     page.getByText("Set the camera to 1080p or higher before the next match", { exact: false }),
  171 |   ).toBeVisible();
  172 |   await expect(page.getByRole("link", { name: "Upload footage" })).toBeVisible();
  173 |   await expectNoAxeViolations(page);
  174 | });
  175 | 
  176 | test("accepted footage takes kickoff and half-time markers, typed as mm:ss", async ({ page }) => {
  177 |   test.setTimeout(180_000);
  178 |   await expect(async () => {
  179 |     await page.goto(acceptedPath);
  180 |     await expect(page.getByText(/Footage accepted/)).toBeVisible({ timeout: 1000 });
  181 |   }).toPass({ timeout: 90_000 });
  182 |   await expect(page.getByText("1920 × 1080")).toBeVisible();
  183 |   // No lineup yet on the own side: that is the next step.
  184 |   await expect(page.getByRole("link", { name: "Enter lineups" }).first()).toBeVisible();
  185 | 
  186 |   await page.goto(`${acceptedPath}/markers`);
  187 |   await expect(
  188 |     page.getByRole("heading", { level: 1, name: "Kickoff and half-time" }),
  189 |   ).toBeVisible();
  190 |   await page.getByRole("textbox", { name: "Kickoff", exact: true }).fill("0:05");
  191 |   await page.getByRole("textbox", { name: "Half-time", exact: true }).fill("0:04");
  192 |   await page.getByRole("button", { name: "Save markers" }).click();
> 193 |   await expect(page.getByText("Half-time must be after kickoff.")).toBeVisible();
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
  194 | 
  195 |   await page.getByRole("textbox", { name: "Half-time", exact: true }).fill("2:40");
  196 |   await page.getByRole("textbox", { name: "Second-half kickoff", exact: true }).fill("2:50");
  197 |   await page.getByRole("textbox", { name: "Full time", exact: true }).fill("5:20.5");
  198 |   await expect(page.getByText("Unsaved changes")).toBeVisible();
  199 |   await page.getByRole("button", { name: "Save markers" }).click();
  200 |   await expect(
  201 |     page
  202 |       .getByRole("status")
  203 |       .filter({ hasText: "Markers saved. Match minutes now follow these times." }),
  204 |   ).toBeVisible();
  205 |   await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  206 |   await expectNoAxeViolations(page);
  207 |   for (const width of [375, 768, 1280]) {
  208 |     await page.setViewportSize({ width, height: 900 });
  209 |     await page.screenshot({ path: test.info().outputPath(`markers-${width}.png`), fullPage: true });
  210 |   }
  211 | 
  212 |   await page.goto(acceptedPath);
  213 |   await page.screenshot({
  214 |     path: test.info().outputPath("detail-accepted-1280.png"),
  215 |     fullPage: true,
  216 |   });
  217 |   for (const t of ["0:05", "2:40", "2:50", "5:20"]) {
  218 |     await expect(page.getByText(t, { exact: true })).toBeVisible();
  219 |   }
  220 | });
  221 | 
```