import { afterEach, describe, expect, it } from "vitest";
import { accessConfigured, accessToken, hasAccess, keyMatches } from "./access";

describe("access key gate", () => {
  afterEach(() => {
    delete process.env.PANEL_ACCESS_KEY;
  });

  it("refuses everything when no key is set up (live data is never open by default)", () => {
    expect(accessConfigured()).toBe(false);
    expect(keyMatches("")).toBe(false);
    expect(hasAccess(accessToken(""))).toBe(false);
  });

  it("refuses a key shorter than 12 characters on the server", () => {
    process.env.PANEL_ACCESS_KEY = "short";
    expect(accessConfigured()).toBe(false);
    expect(keyMatches("short")).toBe(false);
  });

  it("accepts the right key and its cookie, nothing else", () => {
    process.env.PANEL_ACCESS_KEY = "gleuhr-panel-key-2026";
    expect(accessConfigured()).toBe(true);
    expect(keyMatches("gleuhr-panel-key-2026")).toBe(true);
    expect(keyMatches("gleuhr-panel-key-2027")).toBe(false);
    expect(hasAccess(accessToken("gleuhr-panel-key-2026"))).toBe(true);
    expect(hasAccess("gleuhr-panel-key-2026")).toBe(false); // the cookie holds a hash, never the key
    expect(hasAccess(undefined)).toBe(false);
    // changing the key on the server logs everyone out
    const old = accessToken("gleuhr-panel-key-2026");
    process.env.PANEL_ACCESS_KEY = "a-brand-new-key-2026";
    expect(hasAccess(old)).toBe(false);
  });
});
