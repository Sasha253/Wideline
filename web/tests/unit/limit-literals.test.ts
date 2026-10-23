import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { LIMIT_KEYS } from "@/lib/entitlement-keys";

// C03 acceptance (BILL01): no limit is hard-coded. The build fails when a known
// limit key, or an entitlement() / limitFor() call, is compared with a numeric
// literal anywhere in src/. Use hasCapacity() instead. The keys come from the
// registry, so a new key is covered as soon as it is added.

const COMPARISONS = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);
const LIMIT_CALLS = new Set(["entitlement", "limitFor"]);

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const KEYS = Object.keys(LIMIT_KEYS).map(normalise);

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) {
    n = n.expression;
  }
  return n;
}

function isNumericLiteral(node: ts.Expression): boolean {
  const n = unwrap(node);
  if (ts.isNumericLiteral(n) || ts.isBigIntLiteral(n)) return true;
  return (
    ts.isPrefixUnaryExpression(n) &&
    (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken) &&
    isNumericLiteral(n.operand)
  );
}

/** True when the expression calls entitlement() or limitFor(), at any depth. */
function callsLimit(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;
    if (name && LIMIT_CALLS.has(name)) return true;
  }
  return ts.forEachChild(node, callsLimit) ?? false;
}

function namesLimit(node: ts.Expression, sf: ts.SourceFile): boolean {
  const text = normalise(node.getText(sf));
  return KEYS.some((k) => text.includes(k)) || callsLimit(node);
}

/** "file:line  expression" for every limit compared with a numeric literal. */
function findLimitLiterals(source: string, fileName = "fixture.ts"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && COMPARISONS.has(node.operatorToken.kind)) {
      const { left, right } = node;
      const hit =
        (isNumericLiteral(right) && namesLimit(left, sf)) ||
        (isNumericLiteral(left) && namesLimit(right, sf));
      if (hit) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        found.push(`${fileName}:${line}  ${node.getText(sf)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const srcDir = join(import.meta.dirname, "../../src");
const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("generated/") && !f.endsWith(".d.ts"))
  .map((f) => join(srcDir, f));

describe("limit literal check", () => {
  it.each([
    ["matchesPerMonth > 5"],
    ['(await entitlement(o, "favourited_clips")) >= 100'],
    ["limits.scout_seats === 3"],
    ["if (5 < uploadMaxBytes) {}"],
    ["const ok = (await limitFor(org, key)) !== -1;"],
    ["memberSeats <= 10n"],
  ])("flags %s", (code) => {
    expect(findLimitLiterals(code)).toHaveLength(1);
  });

  it.each([
    ["await hasCapacity(org, 'matches_per_month', used)"],
    ["count > 0"],
    ["matchesPerMonth > limit"],
    ["items.length === 0"],
    ["(await entitlementsFor(org)).entitlements.length > 0"],
  ])("passes %s", (code) => {
    expect(findLimitLiterals(code)).toEqual([]);
  });

  it("reports file and line", () => {
    expect(findLimitLiterals("const a = 1;\nif (scout_seats > 2) {}", "x.ts")).toEqual([
      "x.ts:2  scout_seats > 2",
    ]);
  });

  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith("src/server/entitlements/index.ts"))).toBe(true);
  });

  it("no file in src/ compares a limit with a numeric literal", () => {
    const found = files.flatMap((f) =>
      findLimitLiterals(readFileSync(f, "utf8"), relative(srcDir, f)),
    );
    expect(found, "Use hasCapacity() or may() instead of comparing a limit with a number").toEqual(
      [],
    );
  });
});
