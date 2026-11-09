import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import {
  defaultTempRoots, dropStash, formatAge, listStashes, popStash, pruneTrash, saveStash,
  type SaveResult, type StashInfo,
} from "../lib/stash-core.ts";

const USAGE = "Usage: /stash [pop | drop | list]";

export default function (pi: ExtensionAPI) {
  const root = process.env.PI_DRAFT_STASH_DIR || path.join(getAgentDir(), "stash");
  const keyEnv = process.env.PI_DRAFT_STASH_KEY;
  const key = keyEnv === undefined ? "alt+s" : keyEnv.trim();
  const autoRestore = process.env.PI_DRAFT_STASH_AUTO_RESTORE !== "0";
  let pending: string | undefined; // stash made by this process, restored after the next submit

  const updateStatus = (ctx: ExtensionContext) => {
    const n = listStashes(root).length;
    ctx.ui.setStatus("draft-stash", n ? `stash:${n}` : undefined);
  };

  // Returns undefined when the editor is empty or the save failed. The editor is only
  // cleared after prompt.md is written, so a failed write never loses the draft.
  function stashCurrent(ctx: ExtensionContext, markPending: boolean): SaveResult | undefined {
    const text = ctx.ui.getEditorText();
    if (!text.trim()) return undefined;
    let r: SaveResult;
    try {
      r = saveStash(root, text, new Date(), defaultTempRoots());
    } catch (e) {
      ctx.ui.notify(`Stash failed, draft kept: ${(e as Error).message}`, "error");
      return undefined;
    }
    ctx.ui.setEditorText("");
    if (markPending && autoRestore) pending = r.name;
    ctx.ui.notify(`Stashed${r.imageCount ? ` with ${r.imageCount} image(s)` : ""}: ${r.dir}`, "info");
    updateStatus(ctx);
    return r;
  }

  function restore(ctx: ExtensionContext, info: StashInfo): void {
    if (ctx.ui.getEditorText().trim()) stashCurrent(ctx, false); // swap, so nothing is overwritten
    let result;
    try {
      result = popStash(root, info.name, new Date());
    } catch (e) {
      ctx.ui.notify(`Restore failed: ${(e as Error).message}`, "error");
      return;
    }
    ctx.ui.setEditorText(result.text);
    if (pending === info.name) pending = undefined;
    ctx.ui.notify(`Restored "${info.slug}"`, "info");
    if (result.missing.length) ctx.ui.notify(`Missing image(s): ${result.missing.join(", ")}`, "warning");
    updateStatus(ctx);
  }

  async function pick(ctx: ExtensionContext, title: string): Promise<StashInfo | undefined> {
    const list = listStashes(root);
    if (!list.length) { ctx.ui.notify("No stashed drafts", "info"); return undefined; }
    const now = new Date();
    const labels = list.map((s, i) => `${i + 1}. ${s.slug} · ${formatAge(s.createdAt, now)} · ${s.imageCount} img`);
    const choice = await ctx.ui.select(title, labels);
    return choice === undefined ? undefined : list[labels.indexOf(choice)];
  }

  // Async functions run synchronously up to the first await, so fn starts at once.
  const safe = async (ctx: ExtensionContext, fn: () => void | Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) { ctx.ui.notify(`draft-stash: ${(e as Error).message}`, "error"); }
  };

  if (key !== "" && key.toLowerCase() !== "none") {
    pi.registerShortcut(key as Parameters<ExtensionAPI["registerShortcut"]>[0], {
      description: "Stash the prompt draft, or restore the newest stash when the editor is empty",
      handler: (ctx) => safe(ctx, () => {
        if (!ctx.hasUI || stashCurrent(ctx, true)) return;
        const newest = listStashes(root)[0];
        if (newest) restore(ctx, newest);
        else ctx.ui.notify("Nothing to stash or restore", "info");
      }),
    });
  }

  pi.registerCommand("stash", {
    description: "Restore a stashed draft (pop | drop | list)",
    getArgumentCompletions: (prefix) =>
      // A fully typed word gets no suggestion, so Enter runs the command instead of accepting it.
      ["pop", "drop", "list"].filter((v) => v.startsWith(prefix) && v !== prefix).map((v) => ({ value: v, label: v })),
    handler: (args, ctx) => safe(ctx, async () => {
      if (!ctx.hasUI) return;
      const sub = args.trim();
      if (sub === "") {
        const info = await pick(ctx, "Restore draft");
        if (info) restore(ctx, info);
      } else if (sub === "pop") {
        const newest = listStashes(root)[0];
        if (newest) restore(ctx, newest);
        else ctx.ui.notify("No stashed drafts", "info");
      } else if (sub === "drop") {
        const info = await pick(ctx, "Delete draft");
        if (!info) return;
        dropStash(root, info.name, new Date());
        ctx.ui.notify("Moved to .trash (kept 3 days)", "info");
        updateStatus(ctx);
      } else if (sub === "list") {
        const now = new Date();
        const lines = listStashes(root).map((s) => `${s.dir} · ${formatAge(s.createdAt, now)} · ${s.imageCount} img`);
        ctx.ui.notify(lines.length ? lines.join("\n") : "No stashed drafts", "info");
      } else {
        ctx.ui.notify(USAGE, "info");
      }
    }),
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    try { pruneTrash(root, new Date()); updateStatus(ctx); } catch {}
  });

  pi.on("input", (event, ctx) => {
    if (!pending || event.source !== "interactive" || !ctx.hasUI) return;
    const name = pending;
    pending = undefined;
    void safe(ctx, () => {
      const info = listStashes(root).find((s) => s.name === name);
      if (info) restore(ctx, info);
    });
  });
}
