import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shareArtifacts } from "../src/artifacts.js";

describe("shareArtifacts", () => {
  let root = "";
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("gives the new job every file the result names, at the same relative path, and nothing else", async () => {
    root = await mkdtemp(join(tmpdir(), "dd-artifacts-"));
    const from = join(root, "explorations", "exp_1");
    const to = join(root, "runs", "batch_1");
    await mkdir(join(from, "videos"), { recursive: true });
    await mkdir(join(from, "screenshots"), { recursive: true });
    await writeFile(join(from, "videos", "run_a.webm"), "video");
    await writeFile(join(from, "screenshots", "run_a-step1.png"), "step");
    await writeFile(join(from, "screenshots", "other.png"), "not named");
    await writeFile(join(root, "secret.txt"), "outside");

    const result = {
      video: "videos/run_a.webm",
      steps: [{ screenshot: "screenshots/run_a-step1.png" }, { screenshot: "screenshots/missing.png" }],
      failure: "The page said 1.5 USDC.",
      walletRequests: [{ note: "../secret.txt" }, { url: "https://example.com/a.png" }],
    };
    await shareArtifacts(result, from, to);

    expect(await readFile(join(to, "videos", "run_a.webm"), "utf8")).toBe("video");
    expect(await readFile(join(to, "screenshots", "run_a-step1.png"), "utf8")).toBe("step");
    await expect(readFile(join(to, "screenshots", "other.png"))).rejects.toThrow();
    await expect(readFile(join(to, "secret.txt"))).rejects.toThrow();
  });
});
