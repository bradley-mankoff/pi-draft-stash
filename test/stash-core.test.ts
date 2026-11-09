import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findImagePaths, formatAge, dropStash, listStashes, popStash, pruneTrash, saveStash, slugify, stampName,
} from "../lib/stash-core.ts";

const DAY = 24 * 60 * 60 * 1000;

function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pds-")));
  const tmpRoot = path.join(base, "tmp");
  const root = path.join(base, "stash");
  fs.mkdirSync(tmpRoot);
  const img = (name: string, bytes = name) => {
    const p = path.join(tmpRoot, name);
    fs.writeFileSync(p, bytes);
    return p;
  };
  return { base, tmpRoot, root, img };
}

test("slugify", () => {
  assert.equal(slugify("Fix the login bug in auth.ts please now"), "fix-the-login-bug-in-auth");
  assert.equal(slugify("Héllo, wörld!! café"), "h-llo-w-rld-caf");
  const long = slugify("abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij");
  assert.ok(long.length <= 40 && !long.endsWith("-"), long);
  assert.equal(slugify(""), "draft");
  assert.equal(slugify("!!! ???"), "draft");
});

test("stampName uses local time", () => {
  assert.equal(stampName(new Date(2026, 9, 10, 17, 45, 1)), "20261010-174501");
});

test("findImagePaths finds a path mid-sentence", () => {
  const s = sandbox();
  const p = s.img("pi-clipboard-1234-abcd.png");
  const text = `please look at ${p} and fix it`;
  const refs = findImagePaths(text, [s.tmpRoot]);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].start, "please look at ".length);
  assert.equal(text.slice(refs[0].start, refs[0].end), p);
});

test("findImagePaths handles spaces, raw and backslash-escaped", () => {
  const s = sandbox();
  const p = s.img("Screenshot 2026-10-10 at 5.35.12 PM.png");
  const raw = findImagePaths(`see ${p} now`, [s.tmpRoot]);
  assert.equal(raw.length, 1);
  assert.equal(raw[0].fsPath, p);
  const escaped = p.replace(/ /g, "\\ ");
  const esc = findImagePaths(`see ${escaped} now`, [s.tmpRoot]);
  assert.equal(esc.length, 1);
  assert.equal(esc[0].fsPath, p);
});

test("findImagePaths finds two images on a line and the same image twice", () => {
  const s = sandbox();
  const a = s.img("a.png");
  const b = s.img("b.jpg");
  const two = findImagePaths(`${a} and ${b}`, [s.tmpRoot]);
  assert.deepEqual(two.map((r) => r.fsPath), [a, b]);
  const same = findImagePaths(`${a} then ${a}`, [s.tmpRoot]);
  assert.equal(same.length, 2);
  assert.equal(same[0].fsPath, same[1].fsPath);
});

test("findImagePaths ignores non-matches and recovers after a missing path", () => {
  const s = sandbox();
  const txt = s.img("notes.txt");
  const outside = path.join(s.base, "outside.png");
  fs.writeFileSync(outside, "x");
  assert.equal(findImagePaths(`${s.tmpRoot}/missing.png`, [s.tmpRoot]).length, 0);
  assert.equal(findImagePaths(txt, [s.tmpRoot]).length, 0);
  assert.equal(findImagePaths(outside, [s.tmpRoot]).length, 0);
  assert.equal(findImagePaths("/Users/x/tmp/a.png", ["/tmp"]).length, 0);
  const real = s.img("real.png");
  const refs = findImagePaths(`${s.tmpRoot}/missing.png ${real}`, [s.tmpRoot]);
  assert.deepEqual(refs.map((r) => r.fsPath), [real]);
});

test("saveStash round trip with images and a long pasted block", () => {
  const s = sandbox();
  const a = s.img("a.png", "AAA");
  const b = s.img("b.JPG", "BBB");
  const block = Array.from({ length: 15 }, (_, i) => `line ${i} ${"x".repeat(80)}`).join("\n");
  assert.ok(block.length > 1200);
  const text = `Fix this ${a} and ${b} also ${a}\n${block}\n`;
  const now = new Date(2026, 9, 10, 17, 45, 1);
  const r = saveStash(s.root, text, now, [s.tmpRoot]);
  assert.match(r.name, /^20261010-174501-fix-this-and-also-line-0$/);
  assert.equal(r.imageCount, 2);
  const saved = fs.readFileSync(path.join(r.dir, "prompt.md"), "utf8");
  assert.ok(saved.includes(`${r.dir}/image-1.png`));
  assert.ok(saved.includes(`${r.dir}/image-2.jpg`));
  assert.ok(!saved.includes(s.tmpRoot));
  assert.equal(fs.readFileSync(path.join(r.dir, "image-1.png"), "utf8"), "AAA");
  assert.equal(fs.readFileSync(path.join(r.dir, "image-2.jpg"), "utf8"), "BBB");
  assert.ok(saved.endsWith(`\n${block}\n`));
});

test("a draft without images survives save then pop unchanged", () => {
  const s = sandbox();
  const text = "héllo \u{1F600}\n\nsecond paragraph\n\n\n";
  const r = saveStash(s.root, text, new Date(), [s.tmpRoot]);
  assert.equal(popStash(s.root, r.name, new Date()).text, text);
});

test("listStashes sorts newest first and skips non-stashes", () => {
  const s = sandbox();
  const older = saveStash(s.root, "older draft", new Date(2026, 9, 9, 8, 0, 0), [s.tmpRoot]);
  const newer = saveStash(s.root, `newer ${s.img("n.png")}`, new Date(2026, 9, 10, 9, 30, 0), [s.tmpRoot]);
  fs.mkdirSync(path.join(s.root, ".trash", "20261011-000000-trashed"), { recursive: true });
  fs.mkdirSync(path.join(s.root, "random-folder"));
  fs.mkdirSync(path.join(s.root, "20261012-000000-no-prompt"));
  const list = listStashes(s.root);
  assert.deepEqual(list.map((i) => i.name), [newer.name, older.name]);
  assert.equal(list[0].slug, "newer");
  assert.equal(list[0].imageCount, 1);
  assert.equal(list[1].imageCount, 0);
  assert.deepEqual(list[0].createdAt, new Date(2026, 9, 10, 9, 30, 0));
  assert.deepEqual(listStashes(path.join(s.base, "nope")), []);
});

test("two stashes in the same second get a -2 suffix", () => {
  const s = sandbox();
  const now = new Date(2026, 9, 10, 1, 2, 3);
  const one = saveStash(s.root, "same words", now, [s.tmpRoot]);
  const two = saveStash(s.root, "same words", now, [s.tmpRoot]);
  assert.ok(two.name.endsWith("-2"));
  assert.notEqual(one.name, two.name);
});

test("popStash moves the folder to .trash and repoints images", () => {
  const s = sandbox();
  const r = saveStash(s.root, `look ${s.img("a.png")}`, new Date(), [s.tmpRoot]);
  const popped = popStash(s.root, r.name, new Date());
  const trashDir = path.join(s.root, ".trash", r.name);
  assert.ok(!fs.existsSync(r.dir));
  assert.ok(popped.text.includes(`${trashDir}/image-1.png`));
  assert.ok(fs.existsSync(path.join(trashDir, "image-1.png")));
  assert.deepEqual(popped.missing, []);
});

test("popStash reports images that were deleted", () => {
  const s = sandbox();
  const r = saveStash(s.root, `look ${s.img("a.png")}`, new Date(), [s.tmpRoot]);
  fs.rmSync(path.join(r.dir, "image-1.png"));
  const popped = popStash(s.root, r.name, new Date());
  assert.deepEqual(popped.missing, [path.join(s.root, ".trash", r.name, "image-1.png")]);
});

test("re-stashing popped text copies images out of .trash", () => {
  const s = sandbox();
  const r = saveStash(s.root, `look ${s.img("a.png", "PNG")}`, new Date(2026, 9, 10, 1, 0, 0), [s.tmpRoot]);
  const popped = popStash(s.root, r.name, new Date());
  const again = saveStash(s.root, popped.text, new Date(2026, 9, 10, 2, 0, 0), [s.tmpRoot]);
  assert.equal(again.imageCount, 1);
  assert.equal(fs.readFileSync(path.join(again.dir, "image-1.png"), "utf8"), "PNG");
  assert.ok(!fs.readFileSync(path.join(again.dir, "prompt.md"), "utf8").includes(".trash"));
});

test("dropStash trashes and pruneTrash removes only old entries", () => {
  const s = sandbox();
  const now = new Date();
  const old = saveStash(s.root, "old one", new Date(2026, 0, 1, 0, 0, 0), [s.tmpRoot]);
  const recent = saveStash(s.root, "recent one", new Date(2026, 0, 2, 0, 0, 0), [s.tmpRoot]);
  dropStash(s.root, old.name, now);
  dropStash(s.root, recent.name, now);
  assert.deepEqual(listStashes(s.root), []);
  const t = (n: string) => path.join(s.root, ".trash", n);
  const fourDays = new Date(now.getTime() - 4 * DAY);
  const twoDays = new Date(now.getTime() - 2 * DAY);
  fs.utimesSync(t(old.name), fourDays, fourDays);
  fs.utimesSync(t(recent.name), twoDays, twoDays);
  assert.equal(pruneTrash(s.root, now), 1);
  assert.ok(!fs.existsSync(t(old.name)));
  assert.ok(fs.existsSync(t(recent.name)));
});

test("formatAge boundaries", () => {
  const now = new Date(2026, 9, 10, 12, 0, 0);
  const ago = (ms: number) => formatAge(new Date(now.getTime() - ms), now);
  assert.equal(ago(59_000), "just now");
  assert.equal(ago(60_000), "1m");
  assert.equal(ago(59 * 60_000), "59m");
  assert.equal(ago(3600_000), "1h");
  assert.equal(ago(23 * 3600_000), "23h");
  assert.equal(ago(DAY), "1d");
  assert.equal(ago(3 * DAY), "3d");
});
