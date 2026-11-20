// Who is using the panel. Until login exists (backend stage), a "Viewing as" switch in the
// top bar lets you see the panel the way each person will see it.

export type RoleId = "management" | "marketing" | "sales" | "purchase" | "supply";
export type Access = "admin" | "viewer" | "planner";
/** The plans submitted each cycle (19 Nov 2026: the clinic plan merged into the sales plan; the D2C plan retired). */
export type PlanPart = "marketing" | "sales";

export interface Role {
  id: RoleId;
  person: string;
  title: string;
  access: Access;
  /** The plan part this person submits (planners only). */
  planPart?: PlanPart;
}

/** The five roles (decided 19 Nov 2026). Management replaces the CBO, the MD and Herman. */
export const ROLES: Role[] = [
  { id: "management", person: "Management", title: "MD and leadership · approves orders, changes settings", access: "admin" },
  { id: "marketing", person: "Marketing", title: "Marketing head · the marketing plan", access: "planner", planPart: "marketing" },
  { id: "sales", person: "Sales head", title: "The sales plan, clinic by clinic", access: "planner", planPart: "sales" },
  { id: "purchase", person: "Purchase", title: "Purchase orders · sees every page, changes nothing", access: "viewer" },
  { id: "supply", person: "Supply chain head", title: "Stock and transfers · sees every page, changes nothing", access: "viewer" },
];

/** Roles saved in a browser before 19 Nov 2026, and the role each one is now. */
export const LEGACY_ROLES: Record<string, RoleId> = {
  cbo: "management",
  md: "management",
  herman: "management",
  online: "management",
  mh: "marketing",
  sh: "sales",
  manisha: "sales",
};

export function roleById(id: RoleId | string): Role {
  const real = (LEGACY_ROLES[id] ?? id) as RoleId;
  return ROLES.find((r) => r.id === real) ?? ROLES[0]!;
}

export const PLAN_PARTS: { id: PlanPart; label: string; owner: RoleId; description: string }[] = [
  { id: "marketing", label: "Marketing plan", owner: "marketing", description: "Campaigns, offers and ad budget; expected units product by product" },
  { id: "sales", label: "Sales plan", owner: "sales", description: "Sales targets by channel, clinic by clinic, and the actions behind them" },
];

/** Parts that are locked once submitted, after the planner confirms the stock risks and the MD's approval (both, since 19 Nov 2026). */
export const CONSENT_PARTS: PlanPart[] = ["marketing", "sales"];

/** Pages each access level can open. */
export const PAGE_ACCESS: Record<string, Access[]> = {
  "/": ["admin", "viewer", "planner"],
  "/sales": ["admin", "viewer", "planner"],
  "/channels": ["admin", "viewer", "planner"],
  "/projections": ["admin", "viewer", "planner"],
  "/stock": ["admin", "viewer", "planner"],
  "/indent": ["admin", "viewer"],
  "/plans": ["admin", "viewer", "planner"],
  "/reports": ["admin", "viewer"],
  "/alerts": ["admin", "viewer"],
  "/settings": ["admin", "viewer"],
  "/health": ["admin", "viewer"],
  "/marketing-impact": ["viewer"],
  "/bottles": ["admin", "viewer"],
};

/** Pages only some roles see at all (decided 20 Nov 2026: the Purchase-only additions). Other roles don't get the nav item. */
export const PAGE_ROLES: Record<string, RoleId[]> = {
  "/marketing-impact": ["purchase"],
};

export function canOpen(path: string, access: Access, roleId?: RoleId): boolean {
  const key = Object.keys(PAGE_ACCESS)
    .filter((k) => k === "/" ? path === "/" : path === k || path.startsWith(k + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (key && PAGE_ROLES[key] && !(roleId && PAGE_ROLES[key]!.includes(roleId))) return false;
  return key ? (PAGE_ACCESS[key] ?? []).includes(access) : true;
}

/** false = the page is not shown in this role's nav at all (rather than shown locked). */
export function inNav(path: string, roleId: RoleId): boolean {
  return !PAGE_ROLES[path] || PAGE_ROLES[path]!.includes(roleId);
}
