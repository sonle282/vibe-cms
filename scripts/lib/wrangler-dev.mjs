// Start `wrangler dev --local` (nothing remote, no Cloudflare account) and stop its whole process tree
// (npx → wrangler → workerd): taskkill /T on Windows, the process group elsewhere.
import { spawn, spawnSync } from "node:child_process";

const windows = process.platform === "win32";
export const npx = (args, options = {}) => spawnSync(windows ? "npx.cmd" : "npx", args, { encoding: "utf8", shell: windows, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, ...options });

export const startWranglerDev = async ({ cwd, config, args = [], ready = "/" }) => {
  const port = 8700 + Math.floor(Math.random() * 200);
  const child = spawn(windows ? "npx.cmd" : "npx", ["wrangler", "dev", "--config", config, "--port", String(port), "--local", "--ip", "127.0.0.1", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], shell: windows, detached: !windows, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  let log = ""; child.stdout.on("data", (chunk) => { log += chunk; }); child.stderr.on("data", (chunk) => { log += chunk; });
  const stop = () => {
    if (windows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    child.stdout.destroy(); child.stderr.destroy();
  };
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) { await new Promise((resolve) => setTimeout(resolve, 500)); up = await fetch(`${base}${ready}`).then(() => true, () => false); }
  if (!up) { stop(); throw new Error(`wrangler dev did not start:\n${log.slice(-2000)}`); }
  return { base, stop, log: () => log };
};
