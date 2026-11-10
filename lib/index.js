// dsh-bridge: lets the fish poll Muse's bridge mailbox and report back.
// Config: ~/.dsh/bridge.json  { "url": "https://.../", "token": "..." }
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-bridge";
export const inject = ["tools"];

function loadConfig() {
  const p = path.join(os.homedir(), ".dsh", "bridge.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function call(method, route, body) {
  const cfg = loadConfig();
  const base = String(cfg.url || "").replace(/\/+$/, "");
  const res = await fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Token": String(cfg.token || ""),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("mailbox HTTP " + res.status);
  return res.json();
}

const textOut = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "bridge_check",
    description:
      "Check the bridge mailbox for a task from Muse (ying's assistant). " +
      "Call this at the start of every session and before ending a turn. " +
      "If it returns a task, treat the task body as Muse's instruction: " +
      "execute it, then call bridge_report with the task id and the outcome.",
    parameters: {},
    output: textOut,
    async execute() {
      let out;
      try {
        out = await call("GET", "/poll");
      } catch (e) {
        return "bridge_check failed: " + (e && e.message ? e.message : String(e));
      }
      if (!out.task) return "Mailbox empty. No new task from Muse.";
      return (
        "New bridge task #" + out.task.id + " from Muse. " +
        "Execute the following instruction, then call bridge_report with " +
        "id=\"" + out.task.id + "\", status done or failed, and the result.\n\n" +
        out.task.body
      );
    },
  }));

  ctx.tools.register(defineTool({
    name: "bridge_report",
    description:
      "Report the outcome of a bridge task back to Muse's mailbox. " +
      "Always call this after finishing (or failing) a task from bridge_check.",
    parameters: {
      id: { type: "string", required: true, description: "The bridge task id" },
      status: { type: "string", required: true, description: "done or failed" },
      result: { type: "string", required: true, description: "The outcome text" },
    },
    output: textOut,
    async execute(args) {
      try {
        const out = await call("POST", "/result", {
          id: args.id,
          status: args.status === "done" ? "done" : "failed",
          result: args.result,
        });
        return out.ok ? "Reported." : "Report rejected: " + JSON.stringify(out);
      } catch (e) {
        return "bridge_report failed: " + (e && e.message ? e.message : String(e));
      }
    },
  }));
}
