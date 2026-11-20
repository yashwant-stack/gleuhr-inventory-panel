"""Builds docs/Gleuhr_Inventory_Architecture_and_Flow.pdf: python3 scripts/make-architecture-pdf.py <out.pdf> (reportlab + DejaVu Sans)."""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, CondPageBreak)
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon, Group
from reportlab.lib.fonts import addMapping

OUT = sys.argv[1]
pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DVB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DVM", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))
addMapping("DV", 0, 0, "DV"); addMapping("DV", 1, 0, "DVB"); addMapping("DV", 0, 1, "DV"); addMapping("DV", 1, 1, "DVB")

INK = colors.HexColor("#1f2328"); INK2 = colors.HexColor("#4a5058"); MUTED = colors.HexColor("#7a8089")
CORAL = colors.HexColor("#d75649"); CORAL_SOFT = colors.HexColor("#fbebe9")
LINE = colors.HexColor("#d9dce1"); BONE = colors.HexColor("#f7f6f3"); GREY = colors.HexColor("#eef0f3")
GREEN = colors.HexColor("#1f7a4d"); GREEN_SOFT = colors.HexColor("#e6f3ec")
BLUE_SOFT = colors.HexColor("#eaf1fb"); BLUE = colors.HexColor("#2f5d9a")
AMBER_SOFT = colors.HexColor("#fdf3e1"); AMBER = colors.HexColor("#9a6412")
RED = colors.HexColor("#b4332a")

PAGE_W, PAGE_H = A4
M = 18 * mm
CW = PAGE_W - 2 * M  # content width

ss = {
    "title": ParagraphStyle("title", fontName="DVB", fontSize=24, leading=30, textColor=INK),
    "sub": ParagraphStyle("sub", fontName="DV", fontSize=12, leading=17, textColor=INK2),
    "h1": ParagraphStyle("h1", fontName="DVB", fontSize=15, leading=20, textColor=INK, spaceBefore=4, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="DVB", fontSize=11, leading=15, textColor=INK, spaceBefore=8, spaceAfter=3),
    "body": ParagraphStyle("body", fontName="DV", fontSize=9.2, leading=13.4, textColor=INK, spaceAfter=5),
    "small": ParagraphStyle("small", fontName="DV", fontSize=8, leading=11, textColor=INK2),
    "cell": ParagraphStyle("cell", fontName="DV", fontSize=8.2, leading=11, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="DVB", fontSize=8.2, leading=11, textColor=INK),
    "head": ParagraphStyle("head", fontName="DVB", fontSize=8.2, leading=11, textColor=INK2),
    "bullet": ParagraphStyle("bullet", fontName="DV", fontSize=9.2, leading=13.4, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=3, bulletFontName="DV"),
    "mono": ParagraphStyle("mono", fontName="DVM", fontSize=8.4, leading=12, textColor=INK),
    "note": ParagraphStyle("note", fontName="DV", fontSize=8.8, leading=12.6, textColor=INK, backColor=BONE, borderPadding=(6, 7, 6, 7), leftIndent=7, rightIndent=7, spaceBefore=8, spaceAfter=10),
}


def P(t, s="body"):
    return Paragraph(t, ss[s])


def bullets(items):
    return [Paragraph(t, ss["bullet"], bulletText="•") for t in items]


def table(rows, widths, head=True, zebra=False):
    data = [[c if not isinstance(c, str) else Paragraph(c, ss["head" if head and i == 0 else "cell"]) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    st = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if head:
        st += [("BACKGROUND", (0, 0), (-1, 0), GREY)]
    if zebra:
        for i in range(1 if head else 0, len(rows)):
            if i % 2 == 0:
                st.append(("BACKGROUND", (0, i), (-1, i), BONE))
    t.setStyle(TableStyle(st))
    return t


# ---------- drawing helpers ----------
def wrap(text, font, size, width):
    out = []
    for para in text.split("\n"):
        words, line = para.split(" "), ""
        for w in words:
            cand = (line + " " + w).strip()
            if stringWidth(cand, font, size) <= width:
                line = cand
            else:
                if line:
                    out.append(line)
                line = w
        out.append(line)
    return out


def rrect(d, x, y, w, h, fill=colors.white, stroke=LINE, r=6, sw=0.8, dash=None):
    rc = Rect(x, y, w, h, rx=r, ry=r, fillColor=fill, strokeColor=stroke, strokeWidth=sw)
    if dash:
        rc.strokeDashArray = dash
    d.add(rc)


def box(d, x, y, w, h, title, text="", fill=colors.white, stroke=LINE, tcolor=INK, size=7.4, tsize=8.4, center=False, pad=6):
    rrect(d, x, y, w, h, fill, stroke)
    cy = y + h - pad - tsize
    lines = wrap(title, "DVB", tsize, w - 2 * pad)
    for ln in lines:
        if center:
            d.add(String(x + w / 2, cy, ln, fontName="DVB", fontSize=tsize, fillColor=tcolor, textAnchor="middle"))
        else:
            d.add(String(x + pad, cy, ln, fontName="DVB", fontSize=tsize, fillColor=tcolor))
        cy -= tsize + 2.5
    cy -= 1.5
    if text:
        for ln in wrap(text, "DV", size, w - 2 * pad):
            if center:
                d.add(String(x + w / 2, cy, ln, fontName="DV", fontSize=size, fillColor=INK2, textAnchor="middle"))
            else:
                d.add(String(x + pad, cy, ln, fontName="DV", fontSize=size, fillColor=INK2))
            cy -= size + 2.6


def arrow(d, x1, y1, x2, y2, label="", color=INK2, lsize=6.8, loff=(4, 0), lanchor="start", sw=1):
    d.add(Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=sw))
    import math
    a = math.atan2(y2 - y1, x2 - x1)
    L, Wd = 6, 3.2
    p1 = (x2 - L * math.cos(a) + Wd * math.sin(a), y2 - L * math.sin(a) - Wd * math.cos(a))
    p2 = (x2 - L * math.cos(a) - Wd * math.sin(a), y2 - L * math.sin(a) + Wd * math.cos(a))
    d.add(Polygon([x2, y2, p1[0], p1[1], p2[0], p2[1]], fillColor=color, strokeColor=color, strokeWidth=0.5))
    if label:
        mx, my = (x1 + x2) / 2 + loff[0], (y1 + y2) / 2 + loff[1]
        lines = label.split("\n")
        for i, ln in enumerate(lines):
            d.add(String(mx, my - i * (lsize + 2), ln, fontName="DV", fontSize=lsize, fillColor=color, textAnchor=lanchor))


# ---------- diagrams ----------
def architecture():
    W, H = CW, 400
    d = Drawing(W, H)
    # browser
    box(d, 0, 340, W, 56, "Staff browser · the Gleuhr Inventory panel (11 screens)",
        "Opens with the access key. Receives ONE data file (stock + daily sales + settings) and works out every number on screen from it, "
        "with the same formulas the tests check (src/lib/domain/formulas.ts).", fill=BLUE_SOFT, stroke=colors.HexColor("#c9d8ee"), tcolor=BLUE)
    arrow(d, W / 2, 340, W / 2, 302, "HTTPS · access-key cookie", loff=(5, 2))
    # vercel
    rrect(d, 0, 186, W, 116, fill=BONE, stroke=LINE)
    d.add(String(8, 289, "Vercel · Next.js app (project gleuhr-inventory-panel)", fontName="DVB", fontSize=8.6, fillColor=INK))
    d.add(String(W - 8, 289, "Vercel Cron: daily 9:00 AM IST · or Sync now", fontName="DV", fontSize=7.2, fillColor=INK2, textAnchor="end"))
    bw = (W - 16 - 2 * 8) / 3
    xs = [8, 8 + bw + 8, 8 + 2 * (bw + 8)]
    box(d, xs[0], 194, bw, 84, "/api/cron/sync · the sync",
        "Runs on the schedule (checks CRON_SECRET). Reads Zoho and the CRM, writes the panel's tables, then rebuilds the data file.")
    box(d, xs[1], 194, bw, 84, "/api/dataset · the data file",
        "Builds the data file from the panel's tables. Kept in memory up to 15 min and rebuilt right after each sync.")
    box(d, xs[2], 194, bw, 84, "/api/unlock · the gate",
        "Checks the access key and sets a 30-day cookie that holds a hash, never the key itself.")
    # zoho
    zx, zw = 0, 150
    box(d, zx, 8, zw, 132, "Zoho Inventory (India)",
        "Source of STOCK only.\n· Items (197)\n· Stock per location: 16 locations, 11 readable by the login\n· Open purchase orders (\"on the way\")\n· Item cost (purchase price)",
        fill=AMBER_SOFT, stroke=colors.HexColor("#ecd7ad"), tcolor=AMBER)
    # crm db
    cx = 170
    cw = W - cx
    rrect(d, cx, 0, cw, 148, fill=GREEN_SOFT, stroke=colors.HexColor("#bfdccb"))
    d.add(String(cx + 8, 135, "CRM database · Supabase gleuhr-clinic-prod (Postgres 17)", fontName="DVB", fontSize=8.2, fillColor=GREEN))
    box(d, cx + 8, 88, cw - 16, 40, "Gateway function inventory-panel-sql",
        "Accepts a request only with the panel key (its SHA-256 is stored, never the key). Two modes, below.", fill=colors.white)
    sw2 = (cw - 16 - 8) / 2
    box(d, cx + 8, 8, sw2, 70, "public · the clinic + online CRM",
        "\"crm\" mode: one READ-ONLY transaction, SELECT/WITH only. Bills, orders, stock movements, clinics, products.")
    box(d, cx + 8 + sw2 + 8, 8, sw2, 70, "inventory_panel · the panel's own tables",
        "\"panel\" mode: runs as role inventory_panel, which owns only this schema and has no rights on CRM tables.")
    arrow(d, cx + 8 + sw2 / 2, 88, cx + 8 + sw2 / 2, 79)
    arrow(d, cx + 8 + sw2 * 1.5 + 8, 88, cx + 8 + sw2 * 1.5 + 8, 79)
    # arrows vercel -> sources
    arrow(d, 60, 194, 60, 141, "Zoho API, read only\n≤ 10 calls/min · ≤ 600/day", loff=(5, 6))
    arrow(d, xs[0] + bw - 20, 194, cx + 60, 149, "HTTPS + panel key", loff=(6, 4))
    arrow(d, xs[1] + bw / 2, 194, cx + 170, 149, "reads panel tables", loff=(6, 4))
    return d


def chain(steps, cols, bw, bh, gap=18, fill=colors.white, stroke=LINE):
    rows = (len(steps) + cols - 1) // cols
    W = cols * bw + (cols - 1) * gap
    H = rows * bh + (rows - 1) * 26 + 4
    d = Drawing(W, H)
    pos = []
    for i, (t, s) in enumerate(steps):
        r, c = divmod(i, cols)
        if r % 2 == 1:
            c = cols - 1 - c  # snake layout
        x = c * (bw + gap)
        y = H - 2 - (r + 1) * bh - r * 26
        f = fill(i) if callable(fill) else fill
        box(d, x, y, bw, bh, t, s, fill=f, stroke=stroke, size=7.2, tsize=8)
        pos.append((x, y, r))
    for i in range(len(pos) - 1):
        x, y, r = pos[i]
        x2, y2, r2 = pos[i + 1]
        if r == r2:
            if x2 > x:
                arrow(d, x + bw, y + bh / 2, x2, y2 + bh / 2)
            else:
                arrow(d, x, y + bh / 2, x2 + bw, y2 + bh / 2)
        else:
            arrow(d, x + bw / 2, y, x2 + bw / 2, y2 + bh)
    return d


def calc_flow():
    steps = [
        ("1 · Daily usage", "Per product, per sales point, per day: sold − returns + free samples + exchanges (from the CRM's stock movements)."),
        ("2 · Sells per day (rolling 60 days)", "Sum of the last 60 days ÷ 60, zero days included. A sales point that joined later: its own days so far (day 42 → ÷ 42). The parts are added up."),
        ("3 · Days of stock (days of cover)", "Current stock ÷ sells per day. Stock = Mohali warehouse + every clinic Zoho lets us read."),
        ("4 · Reorder point", "Sells per day × the regimen's trigger: 150 days for Night Regime, 120 for Day Regime and Wellness (or × the lead time, when longer). Applied campaign and festival units are taken off the stock first."),
        ("5 · Status", "No sales → Critical → Low → Overstock → Healthy, checked in that order (rules on the next page)."),
        ("6 · Order quantity (only once due)", "Sells per day × (lead time 60 + target days) − stock − on the way (+ campaign and festival units), rounded up to the pack size. Target: 180 days for Night Regime, 150 for Day Regime and Wellness, so stock is back at the target when the order lands."),
        ("7 · Approve → order in Zoho", "Management approves on Auto indent (marks the line agreed). The purchase order is raised in Zoho; the next sync reads it as \"on the way\"."),
    ]
    W, bh, gap = CW, 50, 14
    H = len(steps) * bh + (len(steps) - 1) * gap + 4
    d = Drawing(W, H)
    bw = 300
    x = 0
    for i, (t, s) in enumerate(steps):
        y = H - 2 - (i + 1) * bh - i * gap
        fill = CORAL_SOFT if i in (3, 5) else colors.white
        stroke = colors.HexColor("#efc7c2") if i in (3, 5) else LINE
        box(d, x, y, bw, bh, t, s, fill=fill, stroke=stroke, size=7.2, tsize=8.4)
        if i < len(steps) - 1:
            arrow(d, x + bw / 2, y, x + bw / 2, y - gap)
    # example column
    ex = [
        "BB Cream (live, 17 Nov): 587 used in 60 days",
        "Parts: 509 ÷ 60 = 8.5 · 11 ÷ 47 = 0.2 · 18 ÷ 43 = 0.4 · 39 ÷ 35 = 1.1 · 10 ÷ 34 = 0.3 → 10.54 / day",
        "122 in stock ÷ 10.54 = 11 days",
        "10.54 × 60 = 633 units",
        "Critical: 11 days < 60-day lead time — it runs out before a new order could land",
        "10.54 × (60 + 60) − 122 − 0 = 1,143 → order 1,144",
        "Approved 1,144 → PO in Zoho → \"on the way\" after the next sync",
    ]
    exx = bw + 16
    d.add(String(exx, H - 2 + 2, "Worked example", fontName="DVB", fontSize=7.6, fillColor=MUTED))
    for i, t in enumerate(ex):
        y = H - 2 - (i + 1) * bh - i * gap
        lines = wrap(t, "DV", 7.2, W - exx)
        cy = y + bh / 2 + (len(lines) - 1) * 4.6 - 2
        for ln in lines:
            d.add(String(exx, cy, ln, fontName="DV", fontSize=7.2, fillColor=INK2))
            cy -= 9.2
    return d


def ops_flow():
    steps = [
        ("Sync (daily 9:00 AM, or Sync now)", "Stock from Zoho, sales from the CRM, open POs, then reorder alerts."),
        ("Home · Products that need action", "Critical and Low first; order for 7/15/30/60/90 days."),
        ("Auto indent", "Quantity, order-by date, arrival date and value at cost for every due product."),
        ("Management approves", "Marks the lines agreed. Nothing is sent to Zoho."),
        ("Purchase order in Zoho", "Raised by the purchase team as today."),
        ("Next daily sync", "Reads the open PO: \"on the way\"; the product is no longer Critical if it lands in time."),
        ("Stock lands", "Zoho stock rises; status returns to Healthy."),
        ("Send to clinics", "Mohali tops up any clinic below 10 days to 25 days; clinic-to-clinic only if Mohali is short."),
    ]
    return chain(steps, 4, (CW - 3 * 14) / 4, 66, gap=14)


def sync_flow():
    steps = [
        ("Vercel Cron", "daily 03:30 UTC (9:00 AM IST), run=all"),
        ("/api/cron/sync", "checks CRON_SECRET; takes the sync lock so two runs never overlap"),
        ("Jobs, in order", "frequent: 5 jobs · daily: Zoho access + open POs (table below)"),
        ("Time budget", "no Zoho call starts after 250 s; what is not read is read next run"),
        ("sync_runs", "one row per job: rows written, Zoho calls, ok or not, note"),
        ("Data file rebuilt", "the next page load shows the new numbers"),
    ]
    return chain(steps, 3, (CW - 2 * 14) / 3, 46, gap=14)


# ---------- page furniture ----------
def on_page(c, doc):
    c.saveState()
    c.setFillColor(CORAL)
    c.rect(0, PAGE_H - 5, PAGE_W, 5, stroke=0, fill=1)
    if doc.page > 1:
        c.setFont("DV", 7.5)
        c.setFillColor(MUTED)
        c.drawString(M, 10 * mm, "Gleuhr Inventory Planning Panel · Architecture and flow · 19 Nov 2026")
        c.drawRightString(PAGE_W - M, 10 * mm, f"Page {doc.page}")
    c.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=16 * mm, bottomMargin=18 * mm,
                      title="Gleuhr Inventory Planning Panel — Architecture and flow", author="Gleuhr",
                      subject="Architecture, data flow and calculation flow of the inventory planning panel")
doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(M, 18 * mm, CW, PAGE_H - 34 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=on_page)])

S = []
# ---------- cover ----------
S += [Spacer(1, 40 * mm), P("Gleuhr Inventory Planning Panel", "title"), Spacer(1, 4),
      P("Architecture and flow of inventory management", "sub"), Spacer(1, 2),
      P("How stock and sales come in, where they are kept, how every number is worked out, and who does what with it.", "sub"),
      Spacer(1, 14 * mm)]
cover_rows = [
    ["", ""],
    ["Status", "Live data: stock from Zoho Inventory, sales from the clinic + online CRM"],
    ["Hosting", "Vercel (Next.js) · the panel's tables in the CRM database's own schema, through a gateway function"],
    ["Rules in force", "Sells per day = last 60 days ÷ 60 · lead time 60 days · Night Regime: order at 150 days, back to 180 · Day Regime and Wellness: at 120, back to 150"],
    ["Code version", "develop branch, 20 Nov 2026 (regimen rules + reorder alerts)"],
    ["Date", "20 November 2026"],
]
t = Table([[Paragraph(a, ss["cellb"]), Paragraph(b, ss["cell"])] for a, b in cover_rows[1:]], colWidths=[34 * mm, CW - 34 * mm])
t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                       ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
S += [t, Spacer(1, 12 * mm),
      P("<b>Contents</b>", "h2")]
S += bullets(["1 · The panel at a glance", "2 · System architecture", "3 · Security and access", "4 · Data flow: the sync",
              "5 · How sales and usage are counted", "6 · Data flow: opening the panel", "7 · Calculation flow: from sales to an order",
              "8 · Status rules, transfers and projections", "9 · Operating flow: who does what", "10 · Settings and their defaults",
              "11 · Screens", "12 · Where the code lives", "13 · Current limits and next steps"])
S.append(PageBreak())

# ---------- 1 at a glance ----------
S += [P("1 · The panel at a glance", "h1"),
      P("The panel answers four questions every day: <b>how fast is each product selling</b>, <b>how many days will the stock last</b>, "
        "<b>what must be ordered now and how much</b>, and <b>where stock should move between Mohali and the clinics</b>. "
        "It reads two systems and changes neither:"),
      ]
S += bullets([
    "<b>Zoho Inventory</b> is read for <b>stock</b>: items, stock per location, open purchase orders and item cost. Zoho is never used for sales.",
    "<b>The CRM database</b> (shared by the clinic CRM and the online order CRM) is read for <b>sales</b>: every clinic bill and online order, "
    "through the CRM's stock movements. It is read-only for the panel.",
    "<b>The panel's own tables</b> (a separate schema, <i>inventory_panel</i>, inside the same database) hold what the panel copies and keeps: "
    "stock levels, a daily stock photo, daily sales per product and sales point, purchase orders, settings and the sync log.",
])
S += [P("What it covers today", "h2"),
      table([["Area", "Today (17 Nov 2026 sync)"],
             ["Products planned", "40 (CRM products linked to a Zoho item). 13 CRM products have no Zoho item and are left out, listed on Data health."],
             ["Stock locations", "16 Zoho locations: Mohali warehouse + clinics + darkstores. The Zoho login can read 11; the other 5 show “unknown”, never 0."],
             ["Sales channels", "Clinic sales (16 clinics), online team, website (Shopify). Amazon and Flipkart: not connected yet."],
             ["History kept", "180 days of daily sales per product and sales point."],
             ["Refresh", "Every 2 hours (stock + sales); purchase orders and Zoho access once a day."],
             ["Result on 17 Nov", "6 products Critical (under 60 days of stock with a 60-day lead time), 34 Overstock (over 90 days)."]],
            [36 * mm, CW - 36 * mm], zebra=True)]
S.append(PageBreak())

# ---------- 2 architecture ----------
S += [P("2 · System architecture", "h1"),
      P("Three parts: the <b>browser</b>, the <b>app on Vercel</b>, and the <b>two sources</b> (Zoho and the CRM database). "
        "The panel's own tables live in the CRM database but in their own schema, reached only through a gateway function."),
      architecture(), Spacer(1, 8),
      P("Why this shape", "h2")]
S += bullets([
    "<b>One database, nothing touched:</b> the CRM tables are only ever read, inside a read-only transaction. The panel writes only to its own schema, as a role that has no rights on CRM tables.",
    "<b>No database password in the app:</b> Vercel holds only the gateway's address and key (PANEL_SQL_URL, PANEL_SQL_KEY). The gateway stores just the key's SHA-256.",
    "<b>No lasting disk on Vercel:</b> everything the panel keeps is in its database schema; on Vercel the panel refuses to fall back to a local folder and names the missing setting instead.",
    "<b>One place for every formula:</b> src/lib/domain/formulas.ts. The screens, the reports and the tests all call the same functions, so a number cannot differ between two pages.",
])
S.append(PageBreak())

# ---------- 3 security ----------
S += [P("3 · Security and access", "h1"),
      table([["Layer", "How it is protected"],
             ["Opening the panel", "One shared access key (PANEL_ACCESS_KEY) until personal logins come. The browser keeps a 30-day httpOnly cookie that holds a hash of the key, never the key. With no key set on the server, live data is refused."],
             ["The scheduled sync", "Vercel sends “Authorization: Bearer CRON_SECRET”; any other caller is refused."],
             ["The gateway", "Header x-panel-key must match the SHA-256 stored in inventory_panel.gateway_key. Wrong key → refused."],
             ["CRM data", "“crm” mode runs one read-only transaction and accepts only SELECT/WITH statements. Nothing in the CRM can be changed through it."],
             ["The panel's tables", "“panel” mode switches to role inventory_panel: NOLOGIN, no BYPASSRLS, owns only the inventory_panel schema, 0 grants on CRM tables."],
             ["Zoho", "OAuth refresh token (India data centre). The panel only reads; it never posts stock changes. Calls are budgeted: ≤ 10 a minute, ≤ 600 a day."],
             ["Secrets", "Live only in Vercel → Settings → Environment Variables (and a local .env.local that is never committed). Every code zip is scanned for secret values before it is shared."],
             ["Snapshot link", "The shareable one-file page is encrypted (AES-256-GCM, key derived from the access key with PBKDF2, 600,000 rounds). Without the key it shows nothing."],
             ["Roles on screen", "Five roles: Management (approves, changes settings), Marketing and Sales head (fill the plans), Purchase and Supply chain head (stock, orders and reports, change nothing; the marketing and sales plans are not shown to them). Purchase also has Marketing impact and the inventory value on Home. Today the role is picked in the top bar after the access key: it shapes the screens but is not yet a login."]],
            [34 * mm, CW - 34 * mm], zebra=True),
      Spacer(1, 6),
      P("Environment variables on Vercel", "h2"),
      P("NEXT_PUBLIC_DATA_SOURCE=live · PANEL_SQL_URL · PANEL_SQL_KEY · PANEL_ACCESS_KEY · CRON_SECRET · ZOHO_ORG_ID · ZOHO_CLIENT_ID · "
        "ZOHO_CLIENT_SECRET · ZOHO_REFRESH_TOKEN · ZOHO_API_BASE · ZOHO_ACCOUNTS_BASE (optional: SYNC_TIME_BUDGET_SECONDS). "
        "Values never go into git; .env.example lists the names only.", "small")]
S.append(PageBreak())

# ---------- 4 sync ----------
S += [P("4 · Data flow: the sync", "h1"),
      P("The sync copies what the panel needs from Zoho and the CRM into the panel's own tables. It runs on Vercel's schedule; nobody has to start it."),
      sync_flow(), Spacer(1, 8),
      P("The jobs", "h2"),
      table([["Job", "Reads", "Writes (inventory_panel)", "When"],
             ["zoho_catalog", "Zoho locations and items (197)", "locations, products", "daily 9:00 AM"],
             ["crm_reference", "CRM clinics and retail products, and each product's Zoho item link", "crm_clinics, crm_products", "daily 9:00 AM"],
             ["zoho_stock", "Stock per item per location. Oldest-read location first; a location Zoho refuses is retried once a day", "stock_levels, stock_snapshots (one stock photo a day)", "daily 9:00 AM"],
             ["crm_flows", "CRM stock movements with their bills and orders: the last 3 days each run (first run: 180 days)", "stage_* (working copies), daily_flows", "daily 9:00 AM"],
             ["crm_health", "CRM stock changes that Zoho refused (last 30 days)", "push_health", "daily 9:00 AM"],
             ["zoho_access", "Which Zoho areas the login can read; open purchase orders with their lines and dates", "zoho_access, purchase_orders", "daily 9:00 AM"]],
            [28 * mm, 64 * mm, 48 * mm, CW - 140 * mm], zebra=True),
      P("Every run writes one row per job to <b>sync_runs</b> (rows written, Zoho calls, ok or not, and a note that carries any error), shown on Data health as “Last syncs”. "
        "A lock (sync_lock) stops two runs overlapping; the Zoho token is cached in zoho_token and every call is counted in zoho_calls.", "note")]
S.append(PageBreak())

# ---------- 5 counting ----------
S += [P("5 · How sales and usage are counted", "h1"),
      P("Sales come from the CRM's <b>stock movements</b>: every time a bill or an order takes stock out (or puts it back), the CRM writes one. "
        "Each movement is sorted into one kind:"),
      table([["CRM movement", "Counted as", "Effect"],
             ["sale · online_sale", "Sale", "Sales units and value; usage"],
             ["complimentary", "Free sample", "Usage (stock really left), no sales value"],
             ["adjustment on a clinic bill", "Return (free, if the bill was complimentary)", "Bill edited down or cancelled: the stock came back"],
             ["online_rto_in · online_cancel_in · online pack reversals (qty > 0)", "Return", "Stock came back"],
             ["exchange_in · exchange_out", "Exchange", "Usage"],
             ["adjustment not on a bill, qty > 0", "Stock received", "Not a sale, never makes a place a sales point"],
             ["anything else (RTO missing/damaged, write-off)", "Loss", "Not a sale"]],
            [62 * mm, 46 * mm, CW - 108 * mm], zebra=True),
      Spacer(1, 4),
      P("<b>Usage per day</b> = sales − returns + free samples + exchanges. Usage drives stock planning; sales value drives the money figures."),
      P("Channel and location", "h2")]
S += bullets([
    "A clinic bill → <b>clinic</b> channel; an online order linked to a Shopify order → <b>website</b>; any other online order → <b>online team</b>.",
    "A clinic's sales come off its own Zoho location; a clinic with no Zoho location (Delhi East) comes off Mohali. Online orders come off the location they ship from.",
    "Each sales point is measured from the day it started recording sales in the CRM (Chandigarh from 28 Aug; the other clinics 1–15 Oct), so weeks before it joined never count as zero sales.",
])
S += [P("Sales value (₹)", "h2")]
S += bullets([
    "Never from Zoho. Always what the customer paid, GST included.",
    "<b>Clinic:</b> each bill line's price after its discount, scaled to the bill's real total (whole-bill offers and round-off sit on the bill). Example: 2 serums whose lines say ₹2,000, billed ₹1,500, count as ₹1,500.",
    "<b>Online:</b> each line after its discount, less buy-one-get-one free units and round-off; delivery charges (COD fee, shipping) are left out.",
    "Checked against the CRM, 1–15 Nov: clinic 7,782 units ₹1,16,34,483 · online team 6,567 units ₹98,16,012 · website 1,469 units ₹22,94,952 — exact.",
])
S.append(PageBreak())

# ---------- 6 opening ----------
S += [P("6 · Data flow: opening the panel", "h1"),
      chain([("Open the link", "The page loads; no data yet."),
             ("Enter the access key", "/api/unlock checks it and sets a 30-day cookie."),
             ("/api/dataset", "Returns the data file. Built from the panel tables, kept in memory up to 15 min."),
             ("Browser works it out", "Rates, cover, status, orders, transfers and projections, with the formulas in section 7."),
             ("Settings change", "Changing a setting recalculates every page at once, in the browser."),
             ("After a sync", "The data file is rebuilt; the next load shows it.")],
            3, (CW - 2 * 14) / 3, 56, gap=14),
      Spacer(1, 8),
      P("The data file holds: the days (180), products, locations, clinics, channels and sales points, stock per product per location "
        "(unknown kept as unknown), open purchase orders, and per product × sales point × day: units sold, units used and sales value. "
        "Only non-zero days travel, so the file is about 270 KB."),
      P("The first load after Vercel starts a fresh server takes up to about 30 seconds (the file is built through the gateway); "
        "after that it comes from memory in well under a second. The data request may take up to 120 seconds before Vercel stops it.", "note"),
      P("The shareable snapshot", "h2"),
      P("Besides the live site there is a one-file snapshot page: the same panel with a copy of the data, encrypted with the access key. "
        "It is refreshed by hand (sync → download the data file → encrypt → build) and is useful to share a fixed picture.")]
S.append(PageBreak())

# ---------- 7 calculation ----------
S += [P("7 · Calculation flow: from sales to an order", "h1"),
      P("Rules decided on 17 Nov 2026. Every step is shown, with its numbers, in the product drawer under “How the numbers are worked out”."),
      calc_flow(), Spacer(1, 6),
      P("Your own examples, as tests", "h2"),
      table([["Rule", "Example", "Result"],
             ["Sells per day, early days", "Day 42: days 1–42 sold 840 units", "840 ÷ 42 = 20 a day"],
             ["Days of stock", "500 in stock at 20 a day", "500 ÷ 20 = 25 days"],
             ["Rolling window", "Tomorrow: the oldest day drops off, today is added", "Always the latest 60 days"],
             ["When to order (Night Regime)", "20 a day, 3,000 left = 150 days, lead time 60", "Due now"],
             ["How much", "20 × (60 + 180) − 3,000 − 0 on the way", "Order 1,800 (90 days) → 1,800 left as it lands + 1,800 = 180 days"],
             ["Not yet", "7 a day, 1,120 left (160 days)", "Order 0 · “due in 10 days” (when 1,050 = 150 days are left)"],
             ["Day Regime / Wellness", "10 a day, 1,200 left = 120 days, lead 60", "Order 10 × (60 + 150) − 1,200 = 900 → back to 150 days"]],
            [38 * mm, 74 * mm, CW - 112 * mm], zebra=True)]
S.append(PageBreak())

# ---------- 8 status ----------
S += [P("8 · Status rules, transfers and projections", "h1"),
      table([["Status", "Rule (checked in this order)", "Meaning"],
             ["No sales", "Nothing used in the last 60 days", "No rate to judge stock by"],
             ["Critical", "Days of stock < lead time, and no open order lands before the stock runs out", "It will run out before a new order can arrive: order now"],
             ["Low", "Stock + on the way ≤ reorder point (150 days of sales, or the lead time if longer)", "Time to order"],
             ["Overstock", "Days of stock > 90 (the overstock limit)", "Money stuck on the shelf; excess = stock − 90 days of sales"],
             ["Healthy", "Everything else", "Above the trigger (150 / 120 days) and not more than 210"]],
            [22 * mm, 82 * mm, CW - 104 * mm], zebra=True),
      Spacer(1, 4),
      P("With the default 60-day lead time, Critical means less than 60 days of stock (it runs out before an order could land); Low means 150 days or less: time to order. A 15-day lead time at the 150-day trigger orders little or nothing, because 150 days of stock already cover it.", "small"),
      P("Moving stock between locations", "h2"),
      table([["Move", "Rule", "Defaults"],
             ["Mohali → clinic (send to clinics)", "A clinic below (delivery days + safety days) of its own usage is topped up to (delivery + cover + safety) days, most urgent first. Shows whether Mohali can cover it.", "below 3 + 7 = 10 days → up to 3 + 15 + 7 = 25 days"],
             ["Clinic → clinic", "Only for products Mohali cannot cover. A clinic with more than 60 days of its own usage sends to one under 7 days, up to 14 days, never dropping the sender below 60.", "giver > 60 days · taker < 7 days"],
             ["Never counted", "Moving stock between locations is never a sale or usage: sales come only from CRM bills and orders.", "—"]],
            [36 * mm, 92 * mm, CW - 128 * mm], zebra=True),
      P("Projections and plans", "h2")]
S += bullets([
    "<b>Projection</b> for 7 / 15 / 30 / 60 / 90 days = sells per day × days (an optional trend factor, off by default, can scale it within ±25%).",
    "<b>Channels</b>: each channel's sales, growth and next-30-day forecast. A growth % shows only when the sales points behind it were recording through the whole previous period; otherwise “earlier data incomplete”.",
    "<b>Plans</b>: two plans each week and month: Marketing and the Sales head (the Sales head plans the clinics clinic by clinic; the separate clinic and D2C plans were retired on 19 Nov). A plan more than ±20% away from the system's projection is flagged; Reports lays plans against the projection.",
    "<b>Marketing plan: stock check, consent and lock</b>: each product has an ad budget; section C shows each product's days of stock left at the plan's pace and when new stock can arrive. Submitting opens a popup listing products at risk of running out (with their ad budget and new-stock date) and overstock the plan does not push; Marketing ticks that the risks were checked and that the plan was discussed with and approved by the MD. The plan is then locked; only Management can reopen it. The sales plan gets the same stock check, popup and lock (each product moves with its channel's target; no ad budgets).",
    "<b>Marketing plan, product by product</b>: inside each channel (clinics, online team, website) the Marketing Head sees every product with its stock now, last 30 days and the system's expected units, and types their own expected units. The channel total is the sum of its products, and each product's own plan feeds the stock-shortfall check.",
])
S.append(PageBreak())

# ---------- 9 ops ----------
S += [P("9 · Operating flow: who does what", "h1"),
      ops_flow(), Spacer(1, 8),
      table([["Who", "Access", "Uses the panel to"],
             ["Management", "Admin: every page; approves; changes settings", "Approve Auto indent lines; set lead times and thresholds; reopen a locked plan; read Reports and Alerts"],
             ["Marketing", "Planner", "Submit the marketing plan product by product, with ad budgets; confirm the stock warnings and the MD's approval"],
             ["Sales head", "Planner", "Submit the sales plan: each channel, and the clinics clinic by clinic; confirm the stock warnings and the MD's approval"],
             ["Purchase", "Viewer: every page except the plans, no changes", "Follow Auto indent; raise the purchase order in Zoho for approved lines; Marketing impact"],
             ["Supply chain head", "Viewer: every page except the plans, no changes", "Follow stock health and the transfers between Mohali and the clinics"],
             ["Vercel Cron", "System", "Run the full sync and the reorder alerts every day at 9:00 AM"]],
            [32 * mm, 52 * mm, CW - 84 * mm], zebra=True),
      Spacer(1, 4),
      P("Planners see Home, Sales, Channels, Projections, Stock health and Plans. Auto indent, Reports, Alerts, Settings and Data health are for Management, Purchase and the Supply chain head.", "small")]
S.append(PageBreak())

# ---------- 10 settings ----------
S += [P("10 · Settings and their defaults", "h1"),
      P("Every threshold is a setting, not a fixed number in the code. Management changes them on the Settings page; every page recalculates at once."),
      table([["Setting", "Default", "Used for"],
             ["Sales window", "60 days", "Sells per day = last 60 days ÷ 60"],
             ["Lead time (no supplier lead time set)", "60 days", "Per supplier and per product overrides on Settings / the product drawer"],
             ["Night Regime: order at / back to", "150 / 180 days", "From Zoho's Type Regimen field"],
             ["Day Regime and Wellness: order at / back to", "120 / 150 days", "From Zoho's Type Regimen field"],
             ["No regimen: order when stock falls to", "150 days", "Reorder point (or the lead time, if longer)"],
             ["Safety stock on purchases", "90 days", "Days of sales added to every order on top of the cover"],
             ["Order to cover", "45 days", "Days of sales the order covers after it lands; 7 / 15 / 30 / 45 / 60 / 90 to choose"],
             ["Overstock limit", "210 days", "Overstock status and excess units (above the 180-day Night target)"],
             ["Unused bottle stock", "₹0 = not entered", "Added to Purchase's Total inventory value"],
             ["Clinic top-up: delivery / cover / safety", "3 / 15 / 7 days", "Send to clinics from Mohali"],
             ["Clinic-to-clinic: giver / taker", "> 60 / < 7 days", "Transfers when Mohali is short"],
             ["Plan gap flag", "± 20%", "Plans far from the projection"],
             ["Trend factor", "Off (cap ± 25%)", "Optional scaling of projections"],
             ["Cost when Zoho's is a ₹10 placeholder", "30% of the price", "Values at cost (stored in the panel database)"],
             ["History kept", "180 days", "Daily sales kept per product and sales point"],
             ["Zoho call budget", "10 a minute · 600 a day", "Protects the Zoho account's limits"],
             ["Sync time budget", "250 seconds", "No Zoho call starts after it; the rest is read on the next run"]],
            [62 * mm, 34 * mm, CW - 96 * mm], zebra=True)]
S.append(PageBreak())

# ---------- 11 screens ----------
S += [P("11 · Screens", "h1"),
      table([["Screen", "What it shows"],
             ["Home", "Key figures; Products that need action (All / Critical / Low / Overstock) with an order-for switch (7/15/30/45/60/90 days). For Purchase: Total inventory value (Mohali + clinics + unused bottles, at cost) and its split into Day Regime / Night Regime / Wellness, in place of Sales over time."],
             ["Marketing impact", "Purchase only. Campaigns (dates, budget, segment or products, channels, clinics, uplift % for conservative / expected / aggressive) and a festival calendar (dates, surge %). Applied ones add their extra units to Order now."],
             ["Sales", "Sales by day, product, channel and clinic for any date range, with filters."],
             ["Channels", "Each channel's sales, growth and next-30-day forecast; D2C total; clinic-wise sales."],
             ["Projections", "7 / 15 / 30 / 60 / 90-day projections per product and channel."],
             ["Stock health", "Stock per product and location, days of stock and status; send to clinics; clinic-to-clinic moves; overstock."],
             ["Auto indent", "What to order now and how much, order-by and arrival dates, value at cost; what-if tables for lead time 7–90 days and cover 7–90 days; Management approval."],
             ["Plans", "The weekly plan cycle: each planner's part, on time or late, gaps against the projection."],
             ["Reports", "The chain from stock facts up to the big picture: low stock and overstock, the order projection, plans vs system."],
             ["Alerts", "The daily reorder alert by email (Resend) and WhatsApp (360dialog): products at their reorder point with how much to order; which channel is set up; the real sent log."],
             ["Data health", "Last syncs, Zoho access, unreadable locations, stock below zero, CRM changes Zoho refused, products left out."],
             ["Settings", "Every threshold, supplier lead times, recipients and schedule."],
             ["Product drawer", "Opens from any product: rate, stock by location, a 60-day chart and every calculation step with its numbers."]],
            [30 * mm, CW - 30 * mm], zebra=True),
      Spacer(1, 6),
      P("Every column, tile and status has a hover description in plain words (src/lib/glossary.ts); a test fails if a new label has none.", "small")]
S.append(PageBreak())

# ---------- 12 code ----------
S += [P("12 · Where the code lives", "h1"),
      table([["Path", "What it is"],
             ["src/lib/domain/formulas.ts", "Every formula: sells per day, days of stock, reorder point, order quantity, status, excess, transfers, plan gap."],
             ["src/lib/data/engine.ts", "Applies the formulas per product, location, channel and sales point; builds what each screen shows."],
             ["src/server/sync.ts", "The sync jobs and their order, the lock and the time budget."],
             ["src/server/crm.ts", "The SQL that turns CRM stock movements into daily sales, usage and value (section 5)."],
             ["src/server/zoho.ts", "Zoho client: token refresh, call budget, retries."],
             ["src/server/dataset.ts · dataset-cache.ts", "Builds the data file from the panel tables; keeps it in memory."],
             ["src/server/db.ts", "Chooses the panel database (gateway on Vercel) and the CRM reader."],
             ["src/app/api/*", "cron/sync, dataset, unlock."],
             ["supabase/functions/inventory-panel-sql", "The gateway function in the CRM project."],
             ["supabase/inventory_panel_setup.sql · migrations/", "The role, the schema and the panel's tables."],
             ["vercel.json", "Daily 03:30 UTC (9:00 AM IST) full sync, 03:40 catch-up + alerts; functions in Mumbai (bom1)."],
             ["preview/", "The one-file snapshot page and its encryption."],
             ["src/**/*.test.ts · e2e/", "63 unit tests (formulas with your examples, sync, gateway, glossary) and browser checks."],
             ["docs/BACKEND_PLAN.md", "The data rules in full, each one tested."]],
            [62 * mm, CW - 62 * mm], zebra=True)]
S.append(PageBreak())

# ---------- 13 limits ----------
S += [P("13 · Current limits and next steps", "h1"),
      table([["Item", "Today", "Next"],
             ["Deployment", "Vercel runs whatever is on GitHub main; on 18 Nov that was an older commit (0109485), which is why the site showed “couldn’t load”.", "Push the latest commits (922b273) to GitHub main."],
             ["Approvals, plans, settings", "Saved in each person's browser.", "Save them in the panel's tables (indent_approvals, plan_submissions, settings are ready)."],
             ["Logins", "One shared access key; the role is picked in the top bar.", "Personal logins through the CRM's accounts."],
             ["Unreadable Zoho locations", "Ahmedabad, Mumbai, Pune, Delhi darkstore, Mumbai darkstore: stock unknown.", "Give the Zoho login access to them."],
             ["Zoho stock accuracy", "2,504 CRM stock changes refused by Zoho in 30 days (no access to Mumbai/Ahmedabad; “not authorized”), so some Zoho stock is too high.", "Fix the Zoho user the CRM posts as."],
             ["Products left out", "13 CRM products have no Zoho item.", "Link them in the CRM."],
             ["Treatment consumption", "Retail products used in treatments are not recorded in the CRM.", "Decide how clinics record it."],
             ["Costs", "Most Zoho purchase prices are ₹10 placeholders; 30% of the price is used instead.", "Enter real purchase / landed costs in Zoho."],
             ["Amazon, Flipkart", "Not connected.", "Decide where their orders are recorded."],
             ["Stock runs out before an order lands", "The order still includes the sales of the empty days (assumes they wait).", "Your decision: lost or waiting sales."],
             ["Deferred by you", "Bottle planning; Day / Night / Wellness categories; batches and expiry.", "Later."],
             ["Alerts", "Previews only: email and WhatsApp sending is not connected, and the Alerts page’s “Sent log” shows sample rows.", "Connect sending, or label the log as a sample until then."],
             ["Not built", "Marketing campaign uplift; clinic → warehouse transfers; history import.", "On request."]],
            [36 * mm, 76 * mm, CW - 112 * mm], zebra=True)]

doc.build(S)
print("ok", OUT)
