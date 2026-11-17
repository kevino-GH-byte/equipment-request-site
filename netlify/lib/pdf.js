"use strict";

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { LOGO_PNG_BASE64 } = require("./logo");

const hex = (h) =>
  rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

// Golden Hippo tokens
const C = {
  yellow: hex("#edbf26"),
  yellow50: hex("#fefaeb"),
  ink900: hex("#0f1115"),
  ink700: hex("#2a2f3a"),
  ink500: hex("#5b6373"),
  ink300: hex("#c5cad3"),
  ink100: hex("#eef0f4"),
  white: hex("#ffffff"),
};

const PAGE = { w: 612, h: 792, mx: 48, bottom: 64 }; // US Letter
const CONTENT_W = PAGE.w - PAGE.mx * 2;

// The built-in PDF fonts only cover Latin-1, so swap common punctuation and drop the rest.
function safe(s) {
  return String(s == null ? "" : s)
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E¡-ÿ]/gu, "?");
}

function wrapText(text, font, size, maxW) {
  const out = [];
  // Split on newlines before cleaning: safe() would turn them into "?".
  for (const rawPara of String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n")) {
    const para = safe(rawPara);
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (let word of para.trim().split(/\s+/)) {
      // Break words that are wider than the column
      while (font.widthOfTextAtSize(word, size) > maxW) {
        let cut = word.length;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxW) cut--;
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxW) {
        line = test;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysOut(startIso, endIso) {
  const [y1, m1, d1] = startIso.split("-").map(Number);
  const [y2, m2, d2] = endIso.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

function fmtTimestamp(date) {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date) + " PT"
  );
}

/**
 * d: { ref, submittedAt, project, shootDate, pickupDate, returnDate,
 *      main:{first,last,email}, additional:[{first,last,email}],
 *      items:[{name,category,subcategory,qty}], notes }
 * Returns a Buffer containing the PDF.
 */
async function buildPdf(d) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(`Equipment request ${d.ref}`));
  pdf.setAuthor("Golden Hippo");
  pdf.setCreator("Golden Hippo equipment request form");
  pdf.setCreationDate(d.submittedAt);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));

  const pages = [];
  let page;
  let y;

  function newPage(first) {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE.h - 5, width: PAGE.w, height: 5, color: C.yellow });
    if (first) {
      const bandH = 72;
      page.drawRectangle({ x: 0, y: PAGE.h - 5 - bandH, width: PAGE.w, height: bandH, color: C.ink900 });
      const lh = 44;
      const lw = (logo.width / logo.height) * lh;
      page.drawImage(logo, { x: PAGE.mx, y: PAGE.h - 5 - bandH / 2 - lh / 2, width: lw, height: lh });
      const label = "EQUIPMENT REQUEST";
      const labelW = bold.widthOfTextAtSize(label, 10);
      page.drawText(label, {
        x: PAGE.w - PAGE.mx - labelW,
        y: PAGE.h - 5 - bandH / 2 - 3.5,
        size: 10,
        font: bold,
        color: C.white,
      });
      y = PAGE.h - 5 - bandH - 28;
    } else {
      page.drawText(safe(`Equipment request ${d.ref} (continued)`), {
        x: PAGE.mx,
        y: PAGE.h - 34,
        size: 9,
        font: regular,
        color: C.ink500,
      });
      y = PAGE.h - 56;
    }
  }

  // Starts a new page when h points won't fit. Returns true if it did.
  function ensure(h) {
    if (y - h < PAGE.bottom) {
      newPage(false);
      return true;
    }
    return false;
  }

  function para(text, o = {}) {
    const {
      font = regular,
      size = 10.5,
      color = C.ink900,
      x = PAGE.mx,
      width = CONTENT_W,
      lh = size * 1.45,
      gap = 0,
    } = o;
    for (const ln of wrapText(text, font, size, width)) {
      ensure(lh);
      if (ln) page.drawText(ln, { x, y: y - size, size, font, color });
      y -= lh;
    }
    y -= gap;
  }

  function heading(text) {
    ensure(70); // keep the heading with what follows
    y -= 6;
    para(text, { font: bold, size: 13, lh: 18 });
    page.drawRectangle({ x: PAGE.mx, y: y - 1, width: 28, height: 2, color: C.yellow });
    y -= 14;
  }

  function callout(text) {
    const size = 10;
    const lh = 14.5;
    const padX = 16;
    const padY = 11;
    const lines = wrapText(text, regular, size, CONTENT_W - padX * 2 - 4);
    const h = lines.length * lh + padY * 2;
    ensure(h + 8);
    page.drawRectangle({ x: PAGE.mx, y: y - h, width: CONTENT_W, height: h, color: C.yellow50 });
    page.drawRectangle({ x: PAGE.mx, y: y - h, width: 4, height: h, color: C.yellow });
    let ty = y - padY;
    for (const ln of lines) {
      if (ln) page.drawText(ln, { x: PAGE.mx + padX + 4, y: ty - size, size, font: regular, color: C.ink700 });
      ty -= lh;
    }
    y -= h + 12;
  }

  function gridRow(cells) {
    const gap = 16;
    const size = 11;
    const lh = 15;
    const totalFlex = cells.reduce((s, c) => s + (c.flex || 1), 0);
    const unit = (CONTENT_W - gap * (cells.length - 1)) / totalFlex;
    const prepared = cells.map((c) => {
      const w = unit * (c.flex || 1);
      return { ...c, w, lines: wrapText(c.value || "-", regular, size, w) };
    });
    const maxLines = Math.max(...prepared.map((c) => c.lines.length));
    const h = 14 + maxLines * lh + 12;
    ensure(h);
    let x = PAGE.mx;
    for (const c of prepared) {
      page.drawText(safe(c.label).toUpperCase(), { x, y: y - 8, size: 7.5, font: bold, color: C.ink500 });
      let ly = y - 14;
      for (const ln of c.lines) {
        if (ln) page.drawText(ln, { x, y: ly - size, size, font: regular, color: C.ink900 });
        ly -= lh;
      }
      x += c.w + gap;
    }
    y -= h;
    page.drawLine({
      start: { x: PAGE.mx, y: y + 4 },
      end: { x: PAGE.w - PAGE.mx, y: y + 4 },
      thickness: 0.5,
      color: C.ink300,
    });
  }

  function categoryHeader(name, units) {
    const h = 22;
    page.drawRectangle({ x: PAGE.mx, y: y - h, width: CONTENT_W, height: h, color: C.ink100 });
    page.drawText(safe(name).slice(0, 70), { x: PAGE.mx + 10, y: y - 15, size: 9.5, font: bold, color: C.ink900 });
    const right = `${units} unit${units === 1 ? "" : "s"}`;
    page.drawText(right, {
      x: PAGE.w - PAGE.mx - 10 - regular.widthOfTextAtSize(right, 9),
      y: y - 15,
      size: 9,
      font: regular,
      color: C.ink500,
    });
    y -= h;
  }

  // ---- Layout ----
  newPage(true);

  para("Equipment request", { font: bold, size: 24, lh: 30 });
  para(`Reference ${d.ref}   |   Submitted ${fmtTimestamp(d.submittedAt)}`, {
    size: 10,
    color: C.ink500,
    gap: 16,
  });

  callout(
    "This is a request, not a confirmed reservation. Post your proposed dates in Slack for approval. " +
      "The equipment manager creates the CheqRoom reservation from this form."
  );

  heading("Shoot details");
  gridRow([{ label: "Project", value: d.project || "Not specified" }]);
  gridRow([
    { label: "Proposed shoot date", value: fmtDate(d.shootDate), flex: 1.15 },
    { label: "Pick-up", value: fmtDate(d.pickupDate), flex: 1.15 },
    { label: "Return", value: fmtDate(d.returnDate), flex: 1.15 },
    { label: "Days out", value: String(daysOut(d.pickupDate, d.returnDate)), flex: 0.55 },
  ]);

  heading("Cinematographers");
  gridRow([
    { label: "Main cinematographer", value: `${d.main.first} ${d.main.last}`, flex: 1 },
    { label: "Email", value: d.main.email, flex: 1.2 },
  ]);
  if (d.additional.length) {
    ensure(48);
    y -= 12;
    para("ADDITIONAL CINEMATOGRAPHERS", { font: bold, size: 7.5, color: C.ink500, lh: 12, gap: 4 });
    for (const a of d.additional) {
      para(`${a.first} ${a.last}${a.email ? "   |   " + a.email : ""}`, { size: 11, lh: 16 });
    }
  }

  const sorted = [...d.items].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  const totalUnits = sorted.reduce((n, it) => n + it.qty, 0);
  ensure(150); // keep the Equipment heading with the first category
  heading("Equipment");
  para(
    `${sorted.length} item${sorted.length === 1 ? "" : "s"}   |   ${totalUnits} total unit${totalUnits === 1 ? "" : "s"}`,
    { size: 9.5, color: C.ink500, gap: 8 }
  );

  const groups = new Map();
  for (const it of sorted) {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category).push(it);
  }

  const nameW = CONTENT_W - 56 - 10;
  const rowHeight = (it) => {
    const lines = wrapText(it.name, regular, 10.5, nameW);
    // Kits list what is in them under the kit name
    const incl =
      it.contents && it.contents.length
        ? wrapText(
            "Includes: " + it.contents.map((c) => (c.qty > 1 ? `${c.name} x${c.qty}` : c.name)).join(", "),
            regular,
            8.5,
            nameW
          )
        : [];
    return { lines, incl, h: lines.length * 14 + (it.subcategory ? 12 : 0) + incl.length * 11.5 + 12 };
  };

  for (const [cat, list] of groups) {
    const units = list.reduce((n, it) => n + it.qty, 0);
    ensure(22 + rowHeight(list[0]).h); // keep the category header with its first row
    categoryHeader(cat, units);
    for (const it of list) {
      const { lines, incl, h } = rowHeight(it);
      if (ensure(h)) categoryHeader(`${cat} (continued)`, units);
      page.drawText(String(it.qty), { x: PAGE.mx + 10, y: y - 6 - 10.5, size: 11, font: bold, color: C.ink900 });
      let ty = y - 6;
      for (const ln of lines) {
        if (ln) page.drawText(ln, { x: PAGE.mx + 56, y: ty - 10.5, size: 10.5, font: regular, color: C.ink900 });
        ty -= 14;
      }
      if (it.subcategory) {
        page.drawText(safe(it.subcategory), {
          x: PAGE.mx + 56,
          y: ty - 8.5,
          size: 8.5,
          font: regular,
          color: C.ink500,
        });
        ty -= 12;
      }
      for (const ln of incl) {
        if (ln) page.drawText(ln, { x: PAGE.mx + 56, y: ty - 8.5, size: 8.5, font: regular, color: C.ink500 });
        ty -= 11.5;
      }
      y -= h;
      page.drawLine({
        start: { x: PAGE.mx, y },
        end: { x: PAGE.w - PAGE.mx, y },
        thickness: 0.5,
        color: C.ink300,
      });
    }
    y -= 10;
  }

  if (d.notes) {
    heading("Notes");
    para(d.notes, { size: 10.5, color: C.ink700 });
  }

  // Footer on every page, once the page count is known
  const total = pages.length;
  pages.forEach((pg, i) => {
    pg.drawLine({
      start: { x: PAGE.mx, y: 46 },
      end: { x: PAGE.w - PAGE.mx, y: 46 },
      thickness: 0.5,
      color: C.ink300,
    });
    pg.drawText(safe(`Golden Hippo   |   Equipment request ${d.ref}`), {
      x: PAGE.mx,
      y: 32,
      size: 8,
      font: regular,
      color: C.ink500,
    });
    const right = `Page ${i + 1} of ${total}`;
    pg.drawText(right, {
      x: PAGE.w - PAGE.mx - regular.widthOfTextAtSize(right, 8),
      y: 32,
      size: 8,
      font: regular,
      color: C.ink500,
    });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { buildPdf, fmtDate, daysOut };
