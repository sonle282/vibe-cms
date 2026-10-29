#!/usr/bin/env node
// Vibe CMS command line (P11): `npx vibe-cms help` in the site's folder. The code is in dist/cli (src/cli).
import { run } from "../dist/cli/index.js";

process.exitCode = await run(process.argv.slice(2));
