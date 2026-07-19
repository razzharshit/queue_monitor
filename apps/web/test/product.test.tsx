import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "../src/components.js";
import { ONBOARDING_LABELS, onboardingPercent } from "../src/onboarding.js";
import { canAccessSettings, canInvite, canManageKeys, canManageProjects, canManageRoles } from "../src/permissions.js";

test("dashboard status components render accessible event state", () => {
  const html = renderToStaticMarkup(<StatusBadge status="failure" />);
  assert.match(html, /failure/);
  assert.match(html, /status--failure/);
});

test("onboarding tracks all external beta steps", () => {
  assert.equal(Object.keys(ONBOARDING_LABELS).length, 8);
  assert.equal(onboardingPercent([]), 0);
  assert.equal(onboardingPercent(Object.keys(ONBOARDING_LABELS)), 100);
});

test("team and API-key permissions match the documented role matrix", () => {
  assert.equal(canManageProjects("admin"), true);
  assert.equal(canManageProjects("developer"), false);
  assert.equal(canManageKeys("developer"), true);
  assert.equal(canManageKeys("viewer"), false);
  assert.equal(canInvite("admin"), true);
  assert.equal(canInvite("developer"), false);
  assert.equal(canManageRoles("owner"), true);
  assert.equal(canManageRoles("admin"), false);
  assert.equal(canAccessSettings("viewer"), false);
  assert.equal(canAccessSettings("developer"), true);
});
