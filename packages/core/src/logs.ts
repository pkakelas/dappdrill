import { z } from "zod";

export const ConsoleEntry = z.object({
  level: z.enum(["log", "info", "warn", "error", "pageerror"]),
  text: z.string(),
  at: z.string(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntry>;

export const RpcLogEntry = z.object({
  chainId: z.number().int().optional(),
  url: z.string().optional(),
  method: z.string(),
  /** "page" for the dApp's own RPC calls, "wallet" for calls through the injected provider. */
  via: z.enum(["page", "wallet"]),
  durationMs: z.number(),
  error: z.string().optional(),
  at: z.string(),
});
export type RpcLogEntry = z.infer<typeof RpcLogEntry>;
