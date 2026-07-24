import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

function pixelToken(body, token) {
  const match = body.match(new RegExp(`${token}\\s*:\\s*([\\d.]+)px`));
  assert.ok(match, `missing typography token: ${token}`);
  return Number(match[1]);
}

test("surveillance cards keep readable type tokens for primary and supporting data", () => {
  const card = ruleBody(".surv-card");

  assert.ok(pixelToken(card, "--surv-fs-primary") >= 26, "name and price must remain visually dominant");
  assert.ok(pixelToken(card, "--surv-fs-code") >= 19, "stock code must use the available card space");
  assert.ok(pixelToken(card, "--surv-fs-secondary") >= 16, "market, interval and period must remain readable");
  assert.ok(pixelToken(card, "--surv-fs-change") >= 17, "change percentage must remain readable");
  assert.ok(pixelToken(card, "--surv-fs-status") >= 18, "status text must remain readable");
  assert.ok(pixelToken(card, "--surv-fs-volume") >= 18, "volume must remain readable");

  const tokenConsumers = new Map([
    [".surv-card-name", "--surv-fs-primary"],
    [".surv-price", "--surv-fs-primary"],
    [".surv-code", "--surv-fs-code"],
    [".surv-market", "--surv-fs-secondary"],
    [".surv-iv", "--surv-fs-secondary"],
    [".surv-change", "--surv-fs-change"],
    [".surv-when", "--surv-fs-status"],
    [".surv-period", "--surv-fs-secondary"],
    [".surv-metric-volume", "--surv-fs-volume"],
    [".surv-metric-quote-date", "--surv-fs-secondary"],
  ]);

  for (const [selector, token] of tokenConsumers) {
    assert.match(ruleBody(selector), new RegExp(`font-size\\s*:\\s*var\\(${token.replaceAll("-", "\\-")}`));
  }
});

test("disposition cards give the long status a full row before period and volume", () => {
  const status = ruleBody(".surv-card:is(.is-soon, .is-in, .is-release) .surv-card-status > .surv-when");
  const metrics = ruleBody(".surv-card:is(.is-soon, .is-in, .is-release) .surv-card-status > .surv-metrics");

  assert.match(status, /grid-column\s*:\s*1\s*\/\s*-1/);
  assert.match(status, /white-space\s*:\s*nowrap/);
  assert.match(metrics, /grid-row\s*:\s*2/);
});

test("long decimal prices use a still-prominent compact size instead of overflowing the card", () => {
  const compact = ruleBody(".surv-price.is-compact");
  const match = compact.match(/font-size\s*:\s*([\d.]+)px/);
  assert.ok(match);
  assert.ok(Number(match[1]) >= 24, "compact price must not become small text");
});
