// Who is using the panel. Until login exists (backend stage), a "Viewing as" switch in the
// top bar lets you see the panel the way each person will see it.

export type RoleId = "cbo" | "md" | "herman" | "mh" | "sh" | "online" | "manisha";
export type Access = "admin" | "viewer" | "planner";
export type PlanPart = "marketing" | "sales" | "d2c" | "clinic";

export interface Role {
  id: RoleId;
  person: string;
  title: string;
  access: Access;
  /** The plan part this person submits (planners only). */
  planPart?: PlanPart;
}

export const ROLES: Role[] = [
  { id: "cbo", person: "CBO", title: "Chief Business Officer · Admin", access: "admin" },
  { id: "md", person: "MD", title: "Managing Director · Viewer", access: "viewer" },
  { id: "herman", person: "Herman", title: "Viewer", access: "viewer" },
  { id: "mh", person: "Marketing Head", title: "Planner · marketing plan", access: "planner", planPart: "marketing" },
  { id: "sh", person: "Sales Head", title: "Planner · sales plan", access: "planner", planPart: "sales" },
  { id: "online", person: "Online product team", title: "Planner · D2C projection", access: "planner", planPart: "d2c" },
  { id: "manisha", person: "Manisha", title: "Planner · clinic projection", access: "planner", planPart: "clinic" },
];

export function roleById(id: RoleId): Role {
  return ROLES.find((r) => r.id === id) ?? ROLES[0]!;
}

export const PLAN_PARTS: { id: PlanPart; label: string; owner: RoleId; description: string }[] = [
  { id: "marketing", label: "Marketing plan", owner: "mh", description: "Campaigns, offers and budget; expected units by channel" },
  { id: "sales", label: "Sales plan", owner: "sh", description: "Sales targets by channel and the actions behind them" },
  { id: "d2c", label: "D2C projection", owner: "online", description: "Amazon, Flipkart, Shopify and online team: review and adjust" },
  { id: "clinic", label: "Clinic projection", owner: "manisha", description: "Clinic-wise projection: review and adjust" },
];

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
};

export function canOpen(path: string, access: Access): boolean {
  const key = Object.keys(PAGE_ACCESS)
    .filter((k) => k === "/" ? path === "/" : path === k || path.startsWith(k + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return key ? (PAGE_ACCESS[key] ?? []).includes(access) : true;
}
