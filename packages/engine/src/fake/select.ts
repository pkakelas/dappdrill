import type { Engine } from "./index.js";

/** The real engine, or the fake one when DAPPDRILL_FAKE_ENGINE=1. Loaded lazily so the fake path never loads Playwright. */
export async function loadEngine(): Promise<Engine> {
  if (process.env.DAPPDRILL_FAKE_ENGINE === "1") return (await import("./index.js")).fakeEngine;
  const real = await import("../api.js");
  return { analyze: real.analyze, runTests: real.runTests, writeTest: real.writeTest, chatTurn: real.chatTurn };
}
