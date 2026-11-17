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
};
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

/** Returns { items, stats }. Throws an Error with a readable message if the sheet can't be used. */
function buildInventory(input) {
  let rows;
  try {
    rows = parse(input, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw new Error(`could not read the CSV (${err.message}).`);
  }
  if (!rows.length) throw new Error("the CSV has no rows.");

  const headers = Object.keys(rows[0]);
  const col = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const header = headers.find((h) => norm(h) === alias);
      if (header) {
        col[field] = header;
        break;
      }
    }
  }
  if (!col.name && !col.brand && !col.model) {
    throw new Error(`no Name column found. Headers in the file: ${headers.join(", ")}`);
  }

  const groups = new Map();
  const kits = new Map();
  let skipped = 0;

  for (const row of rows) {
    const get = (field) => (col[field] ? String(row[col[field]] ?? "").trim() : "");

    if (EXCLUDED_STATUS.test(get("status"))) {
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

    const key = [name, category, brand, model].map((s) => s.toLowerCase()).join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.available += 1;
    } else {
      groups.set(key, {
        id: `${slug(name)}-${hash(key)}`,
        name,
        category,
        subcategory,
        brand,
        model,
        available: 1,
      });
    }

    const kitName = get("kit");
    if (kitName) {
      const kitKey = kitName.toLowerCase();
      const kit = kits.get(kitKey) || { name: kitName, members: new Map() };
      const member = kit.members.get(key) || { name, qty: 0 };
      member.qty += 1;
      kit.members.set(key, member);
      kits.set(kitKey, kit);
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
    },
  };
}

module.exports = { buildInventory };
