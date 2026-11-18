import { EventEmitter } from "node:events";
import type { BrowserContext, Request } from "playwright";
import { describe, expect, it } from "vitest";
import { refusalIn, Traffic } from "../../src/browser/traffic.js";

const request = (url: string, postData: string) => ({ url: () => url, postData: () => postData, resourceType: () => "fetch" }) as unknown as Request;

describe("refusals", () => {
  it("reads the reason an error answer gives", () => {
    expect(refusalIn('{"error":"User limit reached","code":"max_accounts_reached"}')).toBe("User limit reached");
    expect(refusalIn('{"error":{"code":403,"message":"Region not supported"}}')).toBe("Region not supported");
    expect(refusalIn('{"ok":false,"items":[]}')).toBeUndefined();
    expect(refusalIn("<html>Bad gateway</html>")).toBeUndefined();
  });

  it("names the server that refused during a step, once", async () => {
    const context = new EventEmitter();
    const traffic = new Traffic();
    traffic.install(context as unknown as BrowserContext);
    const answered = (url: string, status: number, body: string) => {
      const r = { ...request(url, ""), response: async () => ({ status: () => status, text: async () => body }) } as unknown as Request;
      context.emit("request", r);
      context.emit("requestfinished", r);
    };
    const before = Date.now();
    answered("https://auth.privy.io/api/v1/siwe/authenticate", 400, '{"error":"User limit reached","code":"max_accounts_reached"}');
    answered("https://auth.privy.io/api/v1/siwe/authenticate", 400, '{"error":"User limit reached","code":"max_accounts_reached"}');
    answered("https://api.example.com/me", 401, "");
    answered("https://api.example.com/ok", 200, '{"error":"not an error"}');
    await new Promise((r) => setTimeout(r, 10));
    expect(traffic.refusedSince(before)).toEqual(["auth.privy.io answered 400: “User limit reached”"]);
    expect(traffic.refusedSince(Date.now() + 1000)).toEqual([]);
  });
});
