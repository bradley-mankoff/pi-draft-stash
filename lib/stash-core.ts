// Pure stash logic: no pi imports, Node stdlib only, so it can be unit tested.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];
export const TRASH = ".trash";
export const TRASH_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface ImageRef { start: number; end: number; raw: string; fsPath: string }
export interface StashInfo { name: string; dir: string; createdAt: Date; slug: string; imageCount: number }
export interface SaveResult { name: string; dir: string; imageCount: number }
export interface PopResult { text: string; missing: string[] }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const imageFileRe = new RegExp(`^image-.*\\.(${IMAGE_EXTS.join("|")})$`, "i");

export function defaultTempRoots(): string[] {
  const roots = [os.tmpdir()];
  try { roots.push(fs.realpathSync(os.tmpdir())); } catch {}
  roots.push("/tmp", "/private/tmp", "/var/folders", "/private/var/folders");
  return [...new Set(roots.map((r) => r.replace(/\/+$/, "")))];
}

export function findImagePaths(text: string, roots: string[]): ImageRef[] {
  const alt = [...roots].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const startRe = new RegExp(String.raw`(?<=^|[\s"'(\[<@=:,])(?:${alt})/`, "gm");
  const endRe = /\.(?:png|jpe?g|gif|webp)(?=$|[\s"'),;\]>])/gim;
  const refs: ImageRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(text))) {
    const start = m.index;
    let lineEnd = text.indexOf("\n", start);
    if (lineEnd < 0) lineEnd = text.length;
    endRe.lastIndex = start;
    let e: RegExpExecArray | null;
    // Shortest existing ending wins, so a wrong candidate cannot swallow a later real path.
    while ((e = endRe.exec(text)) && e.index + e[0].length <= lineEnd) {
      const end = e.index + e[0].length;
      const raw = text.slice(start, end);
      const fsPath = raw.replace(/\\(.)/g, "$1");
      if (fs.statSync(fsPath, { throwIfNoEntry: false })?.isFile()) {
        refs.push({ start, end, raw, fsPath });
        startRe.lastIndex = end;
        break;
      }
    }
  }
  return refs;
}

export function slugify(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  let slug = words.slice(0, 6).join("-");
  if (slug.length > 40) {
    const cut = slug.slice(0, 41).lastIndexOf("-");
    slug = cut > 0 ? slug.slice(0, cut) : slug.slice(0, 40);
  }
  return slug || "draft";
}

export function stampName(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(now.getFullYear(), 4)}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export function saveStash(root: string, text: string, now: Date, roots: string[]): SaveResult {
  fs.mkdirSync(root, { recursive: true });
  const refs = findImagePaths(text, [...roots, root]);
  let forSlug = text;
  for (const r of [...refs].reverse()) forSlug = forSlug.slice(0, r.start) + " " + forSlug.slice(r.end);
  const base = `${stampName(now)}-${slugify(forSlug)}`;
  let name = base;
  for (let n = 2; fs.existsSync(path.join(root, name)); n++) name = `${base}-${n}`;
  const dir = path.join(root, name);
  fs.mkdirSync(dir);

  const copies = new Map<string, string | undefined>();
  for (const r of refs) {
    if (copies.has(r.fsPath)) continue;
    const dest = path.join(dir, `image-${copies.size + 1}${path.extname(r.fsPath).toLowerCase()}`);
    try { fs.copyFileSync(r.fsPath, dest); copies.set(r.fsPath, dest); } catch { copies.set(r.fsPath, undefined); }
  }
  let out = "";
  let last = 0;
  for (const r of refs) {
    out += text.slice(last, r.start) + (copies.get(r.fsPath) ?? r.raw);
    last = r.end;
  }
  out += text.slice(last);
  fs.writeFileSync(path.join(dir, "prompt.md"), out); // last, so a failure never leaves a half stash that lists
  return { name, dir, imageCount: [...copies.values()].filter(Boolean).length };
}

export function listStashes(root: string): StashInfo[] {
  if (!fs.existsSync(root)) return [];
  const out: StashInfo[] = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const m = ent.isDirectory() && /^(\d{8})-(\d{6})-(.+)$/.exec(ent.name);
    const dir = path.join(root, ent.name);
    if (!m || !fs.existsSync(path.join(dir, "prompt.md"))) continue;
    const [d, t] = [m[1], m[2]];
    const createdAt = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
    const imageCount = fs.readdirSync(dir).filter((f) => imageFileRe.test(f)).length;
    out.push({ name: ent.name, dir, createdAt, slug: m[3], imageCount });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

export function moveToTrash(root: string, name: string, now: Date): string {
  const dest = path.join(root, TRASH, name);
  fs.mkdirSync(path.join(root, TRASH), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(path.join(root, name), dest);
  fs.utimesSync(dest, now, now); // the 3-day clock starts at the pop, not at creation
  return dest;
}

export function popStash(root: string, name: string, now: Date): PopResult {
  const dest = moveToTrash(root, name, now);
  const text = fs.readFileSync(path.join(dest, "prompt.md"), "utf8")
    .split(path.join(root, name) + "/").join(dest + "/");
  const found = text.match(new RegExp(escapeRe(dest + "/") + "image-\\d+\\.[a-z]+", "gi")) ?? [];
  return { text, missing: [...new Set(found)].filter((p) => !fs.existsSync(p)) };
}

export function dropStash(root: string, name: string, now: Date): void {
  moveToTrash(root, name, now);
}

export function pruneTrash(root: string, now: Date, maxAgeMs = TRASH_MAX_AGE_MS): number {
  const trash = path.join(root, TRASH);
  if (!fs.existsSync(trash)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(trash)) {
    const p = path.join(trash, name);
    if (now.getTime() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { recursive: true, force: true }); removed++; }
  }
  return removed;
}

export function formatAge(createdAt: Date, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
