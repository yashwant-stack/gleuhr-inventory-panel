import { describe, expect, it } from "vitest";
import { canOpen, CONSENT_PARTS, LEGACY_ROLES, PLAN_PARTS, ROLES, roleById } from "./roles";

describe("roles (decided 19 Nov 2026)", () => {
  it("are exactly Management, Marketing, Sales head, Purchase and Supply chain head", () => {
    expect(ROLES.map((r) => r.person)).toEqual(["Management", "Marketing", "Sales head", "Purchase", "Supply chain head"]);
  });
  it("old roles saved in a browser map to the new ones", () => {
    expect(roleById("cbo").person).toBe("Management");
    expect(roleById("md").person).toBe("Management");
    expect(roleById("herman").person).toBe("Management");
    expect(roleById("manisha").person).toBe("Sales head");
    expect(roleById("mh").person).toBe("Marketing");
    for (const id of Object.values(LEGACY_ROLES)) expect(ROLES.some((r) => r.id === id)).toBe(true);
  });
  it("two plans, marketing and sales, each owned by a planner and locked after consent", () => {
    expect(PLAN_PARTS.map((p) => p.id)).toEqual(["marketing", "sales"]);
    for (const p of PLAN_PARTS) expect(roleById(p.owner).planPart).toBe(p.id);
    expect(CONSENT_PARTS).toEqual(["marketing", "sales"]);
  });
  it("only Management changes things; Purchase and Supply chain see every page; planners don't see Auto indent", () => {
    expect(roleById("management").access).toBe("admin");
    for (const id of ["purchase", "supply"]) {
      expect(roleById(id).access).toBe("viewer");
      for (const page of ["/indent", "/stock", "/reports", "/settings", "/health"]) expect(canOpen(page, roleById(id).access)).toBe(true);
    }
    expect(canOpen("/indent", roleById("marketing").access)).toBe(false);
  });
});
