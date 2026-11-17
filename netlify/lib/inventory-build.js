"use strict";

/*
 * Turns a CheqRoom asset sheet (CSV text) into the list the request form searches.
 * Used at build time (scripts/build-inventory.js), by the update page's function (admin-core.js), and in the review copy's browser.
 *
 * - Columns are found by header name, ignoring case, spaces and punctuation.
 * - Identical items (same name, category, brand, model) become one line with a unit count.
 * - Items that share a "Kit Name" value become one kit. A kit can only be requested whole.
 * - Retired / lost / archived rows are skipped.
 */
const { parse } = require("csv-parse/sync");

// Header names are matched in this priority order.
const ALIASES = {
  name: ["name", "itemname", "item", "assetname", "asset", "title", "description"],
  category: ["category", "categories", "type"],
  brand: ["brand", "make", "manufacturer"],
  model: ["model", "modelnumber"],
  code: ["code", "assetid", "assetcode", "barcode", "tag"],
  status: ["status"],
  kit: ["kitname", "kit"],
  quantity: ["quantity", "qty"],
  id: ["id", "itemid"],
  retired: ["retired", "retireddate"],
};
// Columns of CheqRoom's separate kits export.
const KIT_ALIASES = { name: ["name", "kitname"], status: ["status"], items: ["items", "itemids"] };
const EXCLUDED_STATUS = /(retired|lost|archiv|stolen|sold|dispos)/i;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item";
// Small pure-JS hash (cyrb53) so this file also runs in a browser. Only used to make ids stable.
const hash = (s) => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).slice(0, 6);
};
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

function readCsv(input, what) {
  let rows;
  try {
    rows = parse(input, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: true });
  } catch (err) {
    throw new Error(`could not read the ${what} (${err.message}).`);
  }
  if (!rows.length) throw new Error(`the ${what} has no rows.`);
  return rows;
}

function findColumns(rows, aliasMap) {
  const headers = Object.keys(rows[0]);
  const col = {};
  for (const [field, aliases] of Object.entries(aliasMap)) {
    for (const alias of aliases) {
      const header = headers.find((h) => norm(h) === alias);
      if (header) {
        col[field] = header;
        break;
      }
    }
  }
  return { col, headers };
}

/**
 * Returns { items, stats }. Throws an Error with a readable message if the sheet can't be used.
 * `input` is the items CSV. `opts.kitsCsv` is CheqRoom's optional separate kits export; it lists
 * each kit's items by Id, and is matched against the Id column of the items export.
 */
function buildInventory(input, opts = {}) {
  const rows = readCsv(input, "CSV");
  const { col, headers } = findColumns(rows, ALIASES);
  if (!col.name && !col.brand && !col.model) {
    throw new Error(`no Name column found. Headers in the file: ${headers.join(", ")}`);
  }

  const groups = new Map();
  const kits = new Map();
  const byId = new Map(); // item Id -> { key, name, qty }
  const inKit = new Set(); // `${kitKey}|${id}` already counted from the items export
  let skipped = 0;

  for (const row of rows) {
    const get = (field) => (col[field] ? String(row[col[field]] ?? "").trim() : "");

    if (EXCLUDED_STATUS.test(get("status")) || get("retired")) {
      skipped++;
      continue;
    }

    const brand = get("brand");
    const model = get("model");
    const name = get("name") || [brand, model].filter(Boolean).join(" ") || get("code");
    if (!name) {
      skipped++;
      continue;
    }

    // CheqRoom writes sub-categories as "category/subcategory>sub-subcategory".
    const parts = get("category")
      .split(/[\/>]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const category = capitalize(parts[0] || "Other");
    const subcategory = parts.slice(1).join(" / ");

    // Bulk items (rolls, corners) carry a Quantity; everything else is one unit per row.
    const qty = Math.min(999, Math.max(1, parseInt(get("quantity"), 10) || 1));
    const key = [name, category, brand, model].map((s) => s.toLowerCase()).join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.available += qty;
    } else {
      groups.set(key, {
        id: `${slug(name)}-${hash(key)}`,
        name,
        category,
        subcategory,
        brand,
        model,
        available: qty,
      });
    }
    if (get("id")) byId.set(get("id"), { key, name, qty });

    const kitName = get("kit");
    if (kitName) {
      const kitKey = kitName; // exact name: CheqRoom can hold kits that differ only by case
      const kit = kits.get(kitKey) || { name: kitName, members: new Map() };
      const member = kit.members.get(key) || { name, qty: 0 };
      member.qty += qty;
      kit.members.set(key, member);
      kits.set(kitKey, kit);
      if (get("id")) inKit.add(`${kitKey}|${get("id")}`);
    }
  }

  // Optional separate kits export: add anything the items export's Kit column didn't already say.
  let kitsFile = null;
  if (opts.kitsCsv) {
    const krows = readCsv(opts.kitsCsv, "kits CSV");
    const { col: kcol } = findColumns(krows, KIT_ALIASES);
    if (!kcol.name || !kcol.items) throw new Error("the kits file needs name and items columns.");
    kitsFile = { rows: krows.length, unresolved: 0, incomplete: [] };
    for (const krow of krows) {
      const kitName = String(krow[kcol.name] || "").trim();
      const kstatus = kcol.status ? String(krow[kcol.status] || "") : "";
      if (!kitName || EXCLUDED_STATUS.test(kstatus)) continue;
      if (/incomplete/i.test(kstatus)) kitsFile.incomplete.push(kitName);
      const kitKey = kitName; // exact name: CheqRoom can hold kits that differ only by case
      for (const id of String(krow[kcol.items] || "").split(/[,;\s]+/).filter(Boolean)) {
        const found = byId.get(id);
        if (!found) {
          kitsFile.unresolved += 1;
          continue;
        }
        if (inKit.has(`${kitKey}|${id}`)) continue;
        inKit.add(`${kitKey}|${id}`);
        const kit = kits.get(kitKey) || { name: kitName, members: new Map() };
        const member = kit.members.get(found.key) || { name: found.name, qty: 0 };
        member.qty += found.qty;
        kit.members.set(found.key, member);
        kits.set(kitKey, kit);
      }
    }
  }

  const kitItems = [...kits.entries()].map(([kitKey, kit]) => ({
    id: `kit-${slug(kit.name)}-${hash(kitKey)}`,
    type: "kit",
    name: kit.name,
    category: "Kits",
    subcategory: "",
    brand: "",
    model: "",
    available: 1, // each kit exists once
    contents: [...kit.members.values()].sort(byName),
  }));

  // Kits first, then everything else by category and name.
  const rank = (it) => (it.type === "kit" ? 0 : 1);
  const items = [...kitItems, ...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.category.localeCompare(b.category) || byName(a, b)
  );
  if (!items.length) throw new Error("no usable rows after filtering.");

  return {
    items,
    stats: {
      rows: rows.length,
      skipped,
      kits: kitItems.length,
      units: [...groups.values()].reduce((n, it) => n + it.available, 0),
      lines: groups.size,
      columns: col,
      kitsFile,
    },
  };
}

module.exports = { buildInventory };
