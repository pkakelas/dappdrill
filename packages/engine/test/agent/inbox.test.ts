import { describe, expect, it } from "vitest";
import { createInboxAccount, extractCode, openInbox } from "../../src/inbox/index.js";

describe("extractCode", () => {
  it("prefers the digits next to the word code", () => {
    expect(extractCode("Your Privy login code is 483921. It expires in 10 minutes. Ref 20240101")).toBe("483921");
    expect(extractCode("<p>Enter this code:</p><h1>12 34 56</h1>")).toBe("123456");
    expect(extractCode("Use 7788 as your one-time PIN")).toBe("7788");
    expect(extractCode("Code: 123-456")).toBe("123456");
  });
  it("falls back to a magic link", () => {
    expect(extractCode('Click <a href="https://app.example.com/auth/verify?token=abc">here</a> to sign in')).toBe(
      "https://app.example.com/auth/verify?token=abc",
    );
    expect(extractCode("nothing here")).toBeUndefined();
  });
});

describe.skipIf(!process.env.DAPPDRILL_LIVE)("mail.tm (live)", () => {
  it("creates an account and reads an empty inbox", async () => {
    const creds = await createInboxAccount();
    expect(creds.address).toMatch(/^dd-[a-z0-9]+@/);
    const inbox = await openInbox(creds);
    expect(inbox.address).toBe(creds.address);
    await expect(inbox.latestCode({ sinceMs: 0, timeoutMs: 1_000 })).rejects.toThrow(/No login code/);
  }, 30_000);
});
