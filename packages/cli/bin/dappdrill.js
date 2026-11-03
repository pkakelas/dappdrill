#!/usr/bin/env node
// Runs the TypeScript sources directly (packages are consumed as source, no build step).
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");
