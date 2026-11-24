// Plan emails (24 Nov 2026): which plan each request day asks for, and who gets them.
import { describe, expect, it } from "vitest";
import { smtpMissing } from "./mail";
import { cycleRequestedOn, planRecipients } from "./plan-mail";

describe("plan request emails", () => {
  it("Thursday asks for next week's plan; the 23rd asks for next month's; other days ask for nothing", () => {
    expect(cycleRequestedOn("2026-11-26", "weekly")).toMatchObject({ id: "w-2026-11-30", dueOn: "2026-11-28" });
    expect(cycleRequestedOn("2026-11-23", "monthly")).toMatchObject({ id: "m-2026-12", dueOn: "2026-11-25" });
    expect(cycleRequestedOn("2026-11-24", "weekly")).toBeNull();
    expect(cycleRequestedOn("2026-11-24", "monthly")).toBeNull();
  });
  it("sends to the Marketing head, the Sales head and Management by default; Vercel settings can change them", () => {
    expect(planRecipients({})).toEqual({ marketing: ["amanpreet@gleuhr.com"], sales: ["manisha@gleuhr.com"], management: ["abhishek@gleuhr.com"] });
    expect(planRecipients({ PLAN_MAIL_MANAGEMENT: "a@x.com, b@x.com" }).management).toEqual(["a@x.com", "b@x.com"]);
  });
  it("names what SMTP still needs", () => {
    expect(smtpMissing({})).toEqual(["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]);
    expect(smtpMissing({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "f" })).toEqual([]);
  });
});
