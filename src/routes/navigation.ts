import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";

export const locations = ["header", "mobile", "footer", "footer-legal", "top-bar"] as const;
const handle = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const safeUrl = z.string().trim().min(1).max(2048).refine(value => {
  if (/[\s\u0000-\u001f\u007f\\]/.test(value) || /%0[ad]/i.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  if (/^#[a-z0-9_-]+$/i.test(value)) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "Use a relative path, anchor, or HTTP(S) URL.");
export type MenuItem = { id: string; label: string; type: "custom" | "page"; url?: string; pageId?: number; newTab: boolean; isActive: boolean; children: MenuItem[] };
const item: z.ZodType<MenuItem> = z.lazy(() => z.object({
  id: z.string().min(1).max(100), label: z.string().trim().min(1).max(120),
  type: z.enum(["custom", "page"]), url: safeUrl.optional(), pageId: z.number().int().positive().optional(),
  newTab: z.boolean().default(false), isActive: z.boolean().default(true), children: z.array(item).max(200).default([]),
}).superRefine((v, ctx) => {
  if (v.type === "custom" && !v.url) ctx.addIssue({ code: "custom", message: "A custom link needs a URL." });
  if (v.type === "page" && !v.pageId) ctx.addIssue({ code: "custom", message: "Select a page." });
}));
export const menuSchema = z.object({
  name: z.string().trim().min(1).max(120), items: z.array(item).max(200),
  locations: z.array(z.enum(locations)).max(locations.length).default([]), isActive: z.boolean().default(true),
  expectedUpdatedAt: z.string().datetime().optional(),
}).superRefine((v, ctx) => {
  const ids = new Set<string>(); let count = 0;
  function walk(items: MenuItem[], depth: number) { for (const x of items) {
    if (depth > 4 || ++count > 200 || ids.has(x.id)) { ctx.addIssue({ code: "custom", message: "Use unique item IDs, at most 200 items and four levels." }); return; }
    ids.add(x.id); walk(x.children, depth + 1);
  } }
  walk(v.items, 1);
  if (new Set(v.locations).size !== v.locations.length) ctx.addIssue({ code: "custom", message: "Duplicate menu position." });
});
class MenuError extends Error { constructor(public status: number, message: string) { super(message); } }
const r = Router(); const admin = [auth, adminOnly];
function error(res: any, e: any) {
  if (e instanceof z.ZodError) return res.status(400).json({ success: false, message: e.issues[0]?.message || "Invalid menu." });
  if (e instanceof MenuError) return res.status(e.status).json({ success: false, message: e.message });
  if (e?.code === "P2002") return res.status(409).json({ success: false, message: "Menu name or handle already exists." });
  return res.status(500).json({ success: false, message: "Unable to process navigation. Try again." });
}
function pageIds(items: MenuItem[]): number[] { return items.flatMap(x => [...(x.type === "page" ? [x.pageId!] : []), ...pageIds(x.children)]); }
async function save(menuHandle: string, body: unknown) {
  const b = menuSchema.parse(body);
  return prisma.$transaction(async tx => {
    // One shared lock serializes all location moves, saves and deletes across API workers.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71170319)`;
    const existing = await tx.navigationMenu.findUnique({ where: { handle: menuHandle } });
    if (existing && (!b.expectedUpdatedAt || existing.updatedAt.toISOString() !== b.expectedUpdatedAt)) throw new MenuError(409, "This menu changed. Reload it before saving.");
    const ids = [...new Set(pageIds(b.items))];
    if (ids.length && await tx.cmsPage.count({ where: { id: { in: ids } } }) !== ids.length) throw new MenuError(400, "A selected page no longer exists.");
    const others = await tx.navigationMenu.findMany({ where: { handle: { not: menuHandle }, locations: { hasSome: b.locations } } });
    for (const other of others) await tx.navigationMenu.update({ where: { id: other.id }, data: { locations: other.locations.filter(x => !b.locations.includes(x as any)) } });
    const data = { name: b.name, items: b.items as any, locations: b.locations, isActive: b.isActive };
    return tx.navigationMenu.upsert({ where: { handle: menuHandle }, create: { handle: menuHandle, ...data }, update: data });
  });
}
async function publicMenu(menu: any) {
  if (!menu?.isActive) throw new MenuError(404, "No active menu is assigned.");
  const parsed = menuSchema.safeParse({ ...menu, locations: menu.locations || [] });
  if (!parsed.success) throw new MenuError(404, "This menu needs to be updated in admin.");
  const ids = pageIds(parsed.data.items);
  const pages = ids.length ? await prisma.cmsPage.findMany({ where: { id: { in: ids }, isPublished: true }, select: { id: true, slug: true } }) : [];
  const urls = new Map(pages.map(x => [x.id, `/${x.slug.split('/').map(encodeURIComponent).join('/')}`]));
  const render = (items: MenuItem[]): any[] => items.filter(x => x.isActive && (x.type !== "page" || urls.has(x.pageId!))).map(x => ({ id: x.id, label: x.label, url: x.type === "page" ? urls.get(x.pageId!) : x.url, newTab: x.newTab, children: render(x.children) }));
  return { handle: menu.handle, name: menu.name, locations: menu.locations, items: render(parsed.data.items) };
}
r.get("/navigation/locations", ...admin, (_q, res) => res.json({ success: true, data: locations }));
r.get("/navigation/pages", ...admin, async (_q, res) => { try { res.json({ success: true, data: await prisma.cmsPage.findMany({ select: { id: true, title: true, slug: true, isPublished: true }, orderBy: { title: "asc" } }) }); } catch(e) { error(res,e); } });
r.get("/navigation/location/:location", async (req, res) => { try {
  const location = z.enum(locations).parse(req.params.location);
  res.json({ success: true, data: await publicMenu(await prisma.navigationMenu.findFirst({ where: { isActive: true, locations: { has: location } } })) });
} catch(e) { error(res,e); } });
r.get("/navigation", ...admin, async (_q,res) => { try { res.json({ success: true, data: await prisma.navigationMenu.findMany({ orderBy: { name: "asc" } }) }); } catch(e) { error(res,e); } });
r.put(["/navigation/:handle", "/cms/navigation/:handle"], ...admin, async (req,res) => { try { res.json({ success: true, data: await save(handle.parse(req.params.handle), req.body) }); } catch(e) { error(res,e); } });
r.delete("/navigation/:handle", ...admin, async (req,res) => { try {
  const menuHandle = handle.parse(req.params.handle); const expected = z.string().datetime().parse(req.body.expectedUpdatedAt);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71170319)`;
    const menu = await tx.navigationMenu.findUnique({ where: { handle: menuHandle } });
    if (!menu) throw new MenuError(404,"Menu not found.");
    if (menu.updatedAt.toISOString() !== expected) throw new MenuError(409,"This menu changed. Reload it before deleting.");
    await tx.navigationMenu.delete({ where: { handle: menuHandle } });
  }); res.json({ success: true });
} catch(e) { error(res,e); } });
r.get(["/navigation/:handle", "/cms/navigation/:handle"], async (req,res) => { try {
  res.json({ success: true, data: await publicMenu(await prisma.navigationMenu.findUnique({ where: { handle: handle.parse(req.params.handle) } })) });
} catch(e) { error(res,e); } });
export default r;
