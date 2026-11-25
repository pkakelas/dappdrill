import type { Fund } from "@dappdrill/core";
import { z } from "zod";

const Token = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "A token is its contract address: 0x and 40 hex characters.");
const Amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "An amount to send is a number, like 0.05 or 100.")
  .refine((a) => Number(a) > 0, "An amount to send is more than zero.");

/** Something a new account is sent, as a form holds it: the chain's own coin when the token is empty. */
export interface FundRow {
  chainId?: number;
  token: string;
  amount: string;
}

/** The rows of a form as what an account is sent. A row with no amount and no token is skipped. */
export function readFund(rows: FundRow[]): Fund[] | { error: string } {
  const fund: Fund[] = [];
  for (const row of rows) {
    const [tokenIn, amountIn] = [row.token.trim(), row.amount.trim()];
    if (!amountIn && !tokenIn) continue;
    if (!Number.isInteger(row.chainId) || row.chainId! <= 0) return { error: "Choose the chain for what a new account is sent." };
    const amount = Amount.safeParse(amountIn);
    if (!amount.success) return { error: amount.error.issues[0]!.message };
    const token = tokenIn ? Token.safeParse(tokenIn) : undefined;
    if (token && !token.success) return { error: token.error.issues[0]!.message };
    fund.push({ chainId: row.chainId!, ...(token ? { token: token.data } : {}), amount: amount.data });
  }
  return fund;
}

/** Said when funds are asked for and the app has no key to pay them from. */
export const NO_PAYER = "Add the private key that pays each new account, or take out what to send.";
