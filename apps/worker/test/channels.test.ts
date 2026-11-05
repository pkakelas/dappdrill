import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../src/notify/channels.js";

afterEach(() => vi.unstubAllEnvs());

describe("sendEmail", () => {
  it("doesn't claim a logged email was delivered", async () => {
    vi.stubEnv("SMTP_URL", "");
    await expect(sendEmail(["a@example.test"], { title: "t", lines: [], link: "http://x" })).resolves.toBe(false);
  });
});
