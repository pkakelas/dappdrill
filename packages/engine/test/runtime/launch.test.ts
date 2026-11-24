import { afterEach, describe, expect, it } from "vitest";
import { launchOptions } from "../../src/browser/launch.js";

const KEYS = ["DAPPDRILL_CHANNEL", "DAPPDRILL_HEADLESS", "DAPPDRILL_PROXY"] as const;

function set(patch: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, patch);
}

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("launchOptions", () => {
  it("changes nothing when the environment is empty", () => {
    set({});
    expect(launchOptions(true)).toMatchObject({ headless: true, channel: undefined });
    expect(launchOptions(false).headless).toBe(false);
    expect(launchOptions(true).proxy).toBeUndefined();
  });

  it("takes a real browser build and a head from the environment", () => {
    set({ DAPPDRILL_CHANNEL: "chrome" });
    expect(launchOptions(true).channel).toBe("chrome");

    set({ DAPPDRILL_HEADLESS: "0" });
    expect(launchOptions(true).headless).toBe(false);
    expect(launchOptions(false).headless).toBe(false);
    set({ DAPPDRILL_HEADLESS: "false" });
    expect(launchOptions(true).headless).toBe(false);
    set({ DAPPDRILL_HEADLESS: "1" });
    expect(launchOptions(true).headless).toBe(true);
  });

  it("splits a proxy's credentials out of its server", () => {
    set({ DAPPDRILL_PROXY: "http://u:p%40ss@resi.example:8000" });
    expect(launchOptions(true).proxy).toEqual({ server: "http://resi.example:8000", username: "u", password: "p@ss" });

    // Anything that won't parse as a URL is handed to Playwright whole.
    set({ DAPPDRILL_PROXY: "%%%" });
    expect(launchOptions(true).proxy).toEqual({ server: "%%%" });

    set({ DAPPDRILL_PROXY: "  " });
    expect(launchOptions(true).proxy).toBeUndefined();
  });
});
