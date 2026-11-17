"use strict";

/*
 * Server-side validation. The browser checks the same rules for convenience,
 * but this is the version that counts.
 */

const EMAIL_RE = /^[^\s@<>()[\]",;:\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const MAX_ITEMS = 150;
const MAX_ADDITIONAL = 10;
const FALLBACK_MAX_QTY = 99;

function cleanLine(v, max) {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanBlock(v, max) {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function todayInLA() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function checkEmail(v, domain) {
  const email = cleanLine(v, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "invalid" };
  if (!email.endsWith("@" + domain)) return { error: "domain" };
  return { email };
}

function validate(payload, inventory, opts = {}) {
  const errors = [];
  const add = (msg) => {
    if (!errors.includes(msg)) errors.push(msg);
  };

  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "goldenhippo.com").toLowerCase().replace(/^@/, "");
  const today = opts.today || todayInLA();
  const p = payload && typeof payload === "object" ? payload : {};

  const project = cleanLine(p.project, 120);
  const notes = cleanBlock(p.notes, 2000);

  // Dates
  const dates = {};
  [
    ["shootDate", "Proposed shoot date"],
    ["pickupDate", "Pick-up date"],
    ["returnDate", "Return date"],
  ].forEach(([key, label]) => {
    const v = typeof p[key] === "string" ? p[key].trim() : "";
    if (!v) add(`${label} is required.`);
    else if (!isIsoDate(v)) add(`${label} isn't a valid date.`);
    else dates[key] = v;
  });
  if (dates.pickupDate && dates.pickupDate < today) add("Pick-up date can't be in the past.");
  if (dates.pickupDate && dates.returnDate && dates.returnDate < dates.pickupDate) {
    add("Return date must be on or after the pick-up date.");
  } else if (
    dates.pickupDate &&
    dates.returnDate &&
    dates.shootDate &&
    (dates.shootDate < dates.pickupDate || dates.shootDate > dates.returnDate)
  ) {
    add("The proposed shoot date must fall between the pick-up and return dates.");
  }

  // Main cinematographer
  const m = p.main && typeof p.main === "object" ? p.main : {};
  const main = { first: cleanLine(m.first, 60), last: cleanLine(m.last, 60), email: "" };
  if (!main.first) add("Main cinematographer first name is required.");
  if (!main.last) add("Main cinematographer last name is required.");
  const mainEmail = checkEmail(m.email, domain);
  if (mainEmail.error === "invalid") add("Main cinematographer email: enter a valid email address.");
  else if (mainEmail.error === "domain") add(`Main cinematographer email must be a @${domain} address.`);
  else main.email = mainEmail.email;

  // Additional cinematographers (optional)
  const additional = [];
  const rawAdditional = Array.isArray(p.additional) ? p.additional.slice(0, MAX_ADDITIONAL) : [];
  rawAdditional.forEach((a, i) => {
    const row = a && typeof a === "object" ? a : {};
    const first = cleanLine(row.first, 60);
    const last = cleanLine(row.last, 60);
    const rawEmail = cleanLine(row.email, 120);
    if (!first && !last && !rawEmail) return;
    if (!first || !last) {
      add(`Additional cinematographer ${i + 1}: first and last name are required.`);
      return;
    }
    let email = "";
    if (rawEmail) {
      const res = checkEmail(rawEmail, domain);
      if (res.error === "invalid") add(`Additional cinematographer ${i + 1}: enter a valid email address.`);
      else if (res.error === "domain") add(`Additional cinematographer ${i + 1}: use a @${domain} email address.`);
      else email = res.email;
    }
    additional.push({ first, last, email });
  });

  // Equipment
  const invMap =
    inventory && Array.isArray(inventory.items) && inventory.items.length
      ? new Map(inventory.items.map((it) => [it.id, it]))
      : null;
  const rawItems = Array.isArray(p.items) ? p.items : [];
  if (rawItems.length > MAX_ITEMS) add(`Too many line items (limit ${MAX_ITEMS}).`);

  const merged = new Map();
  for (const r of rawItems.slice(0, MAX_ITEMS)) {
    const id = cleanLine(r && r.id, 80);
    const qty = Number(r && r.qty);
    if (!id || !Number.isInteger(qty) || qty < 1) {
      add("One of the quantities isn't valid.");
      continue;
    }
    const entry = merged.get(id) || { id, qty: 0, name: cleanLine(r.name, 120), category: cleanLine(r.category, 60) };
    entry.qty += qty;
    merged.set(id, entry);
  }

  const items = [];
  for (const entry of merged.values()) {
    if (invMap) {
      const inv = invMap.get(entry.id);
      if (!inv) {
        add("An item on your list is no longer in the inventory. Refresh the page and try again.");
        continue;
      }
      if (entry.qty > inv.available) {
        add(`${inv.name}: only ${inv.available} in inventory.`);
        continue;
      }
      items.push({
        name: inv.name,
        category: inv.category,
        subcategory: inv.subcategory || "",
        brand: inv.brand || "",
        model: inv.model || "",
        contents: Array.isArray(inv.contents) ? inv.contents : null,
        qty: entry.qty,
      });
    } else {
      if (!entry.name) {
        add("An item on your list is missing its name.");
        continue;
      }
      if (entry.qty > FALLBACK_MAX_QTY) {
        add(`${entry.name}: quantity is too high.`);
        continue;
      }
      items.push({
        name: entry.name,
        category: entry.category || "Other",
        subcategory: "",
        brand: "",
        model: "",
        qty: entry.qty,
      });
    }
  }
  if (!items.length && !errors.length) add("Add at least one piece of equipment.");
  else if (!rawItems.length) add("Add at least one piece of equipment.");

  return {
    errors,
    clean: {
      project,
      shootDate: dates.shootDate,
      pickupDate: dates.pickupDate,
      returnDate: dates.returnDate,
      main,
      additional,
      items,
      notes,
    },
  };
}

module.exports = { validate, cleanLine, todayInLA };
