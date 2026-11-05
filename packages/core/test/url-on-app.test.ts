import { describe, expect, it } from "vitest";
import { urlOnApp } from "../src/test.js";

describe("urlOnApp", () => {
  it("keeps the app URL's query on a path without one", () => {
    expect(urlOnApp("/vault", "http://localhost:5173/?bugs=none")).toBe("http://localhost:5173/vault?bugs=none");
    expect(urlOnApp("/", "https://app.example/swap?chain=mainnet")).toBe("https://app.example/?chain=mainnet");
  });

  it("lets a path's own query win, and leaves other sites alone", () => {
    expect(urlOnApp("/vault?tab=2", "http://localhost:5173/?bugs=none")).toBe("http://localhost:5173/vault?tab=2");
    expect(urlOnApp("https://other.example/x", "http://localhost:5173/?bugs=none")).toBe("https://other.example/x");
  });
});
