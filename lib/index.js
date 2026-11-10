// dsh-bridge: lets the fish poll Muse's bridge mailbox and report back.
// Config: ~/.dsh/bridge.json { "url": "https://.../", "token": "..."}
// v0.2: also watches the queue count and, while tasks wait, injects a
// system-prompt section into EVERY session of the profile (any preset):
// the fish is told to bridge_check first. No section when the queue is empty.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineTool} from "@deepseek-ai/dsh-tools";

export const name = "dsh-bridge";
export const inject = ["tools", "systemPrompt"];

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
body: body? JSON.stringify(body): undefined,
});
if (!res.ok) throw new Error("mailbox HTTP " + res.status);
return res.json();
}

async function queuedCount() {
const cfg = loadConfig();
const base = String(cfg.url || "").replace(/\/+$/, "");
const res = await fetch(base + "/queue-status");
if (!res.ok) throw new Error("mailbox HTTP " + res.status);
const out = await res.json();
return Number(out.queued || 0);
}

const textOut = {
schema: { type: "string"},
render: (_args, value) => [{ type: "text", text: value}],
};

function sectionText(n) {
return (
"你有 " + n + " 封来自应乐（主人的助手）的未处理桥信。" +
"在处理其他事之前，先调用 bridge_check 取最旧的一封，按信中要求办理，" +
"办完用 bridge_report 回报；若还有剩余，继续取下一封，直到取空。" +
"例外：信中若涉及给别人发消息、花钱、碰账号凭据、删东西，不要直接执行，先停下来问主人。"
);
}

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
return "bridge_check failed: " + (e && e.message? e.message: String(e));
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
id: { type: "string", required: true, description: "The bridge task id"},
status: { type: "string", required: true, description: "done or failed"},
result: { type: "string", required: true, description: "The outcome text"},
},
output: textOut,
async execute(args) {
try {
const out = await call("POST", "/result", {
id: args.id,
status: args.status === "done"? "done": "failed",
result: args.result,
});
return out.ok? "Reported.": "Report rejected: " + JSON.stringify(out);
} catch (e) {
return "bridge_report failed: " + (e && e.message? e.message: String(e));
}
},
}));

// Keep a system-prompt section alive while the queue is non-empty.
ctx.inject(["systemPrompt"], (sctx) => {
let disposeSection = null;
let lastN = -1;
const refresh = async () => {
let n;
try {
n = await queuedCount();
} catch {
return; // mailbox unreachable: leave the current section as-is
}
if (n === lastN) return;
lastN = n;
if (disposeSection) { disposeSection(); disposeSection = null;}
if (n > 0) {
disposeSection = sctx.systemPrompt.section({
name: "dsh-bridge:mail",
order: 500,
text: sectionText(n),
});
}
};
sctx.effect(() => {
void refresh();
const timer = setInterval(() => { void refresh();}, 60000);
if (timer.unref) timer.unref();
return () => {
clearInterval(timer);
if (disposeSection) disposeSection();
disposeSection = null;
};
}, "dsh-bridge: mailbox prompt section");
});
}
