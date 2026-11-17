"use strict";

/*
 * The logic behind the update page: read an uploaded CheqRoom export, compare it with the
 * list in use, publish it, or go back to the previous list.
 *
 * It only talks to a `store` ({ get(key), set(key, value) }) so it runs the same in the
 * Netlify Function (Netlify Blobs) and in the review copy in the browser (in memory).
 * Passcode checking lives in netlify/functions/admin-inventory.js, not here.
 */
const { buildInventory } = require("./inventory-build");

const CURRENT = "current";
const PREVIOUS = "previous";

const isKit = (it) => it.type === "kit";

function meta(rec) {
  if (!rec || !Array.isArray(rec.items)) return null;
  const gear = rec.items.filter((it) => !isKit(it));
  return {
    generatedAt: rec.generatedAt || null,
    filename: rec.filename || "",
    items: gear.length,
    kits: rec.items.length - gear.length,
    units: gear.reduce((n, it) => n + (it.available || 0), 0),
    categories: new Set(gear.map((it) => it.category)).size,
  };
}

const label = (it) => (isKit(it) ? `${it.name} (kit)` : it.name);

function diff(oldItems, newItems) {
  const before = new Map(oldItems.map((it) => [it.id, it]));
  const after = new Map(newItems.map((it) => [it.id, it]));
  const added = newItems.filter((it) => !before.has(it.id));
  const removed = oldItems.filter((it) => !after.has(it.id));
  const changed = newItems
    .filter((it) => before.has(it.id) && before.get(it.id).available !== it.available)
    .map((it) => ({ name: label(it), from: before.get(it.id).available, to: it.available }));
  const cap = 200;
  return {
    added: added.slice(0, cap).map(label),
    addedCount: added.length,
    removed: removed.slice(0, cap).map(label),
    removedCount: removed.length,
    changed: changed.slice(0, cap),
    changedCount: changed.length,
  };
}

function warningsFor(built, baseline) {
  const out = [];
  const { stats, items } = built;
  if (!stats.columns.kit && !stats.kitsFile) {
    out.push("No Kit column was found, so no kits will appear. If you use kits, check that the export includes that column, or add the separate kits export.");
  } else if (!stats.kits) {
    out.push("There is a Kit column but nothing is filled in, so no kits will appear.");
  }
  if (stats.kitsFile && stats.kitsFile.unresolved) {
    const n = stats.kitsFile.unresolved;
    out.push(`${n} item${n === 1 ? "" : "s"} listed inside kits ${n === 1 ? "isn't" : "aren't"} in the items export (likely retired), so ${n === 1 ? "it is" : "they are"} left out of the kits.`);
  }
  if (stats.kitsFile && stats.kitsFile.incomplete.length) {
    const n = stats.kitsFile.incomplete.length;
    out.push(`${n} kit${n === 1 ? " is" : "s are"} marked incomplete in CheqRoom. ${n === 1 ? "It is" : "They are"} still listed.`);
  }
  if (!stats.columns.category) {
    out.push("No Category column was found. Every item will be listed under Other.");
  }
  if (stats.skipped) {
    out.push(`${stats.skipped} row${stats.skipped === 1 ? " was" : "s were"} skipped (retired, lost, archived, or no name).`);
  }
  if (baseline) {
    const was = baseline.items.filter((it) => !isKit(it)).length;
    const now = items.filter((it) => !isKit(it)).length;
    if (was >= 10 && now < was * 0.7) {
      out.push(`The new list has ${now} items and the current one has ${was}. Check that this is the full export, not a filtered one.`);
    }
    const wasKits = baseline.items.length - was;
    if (wasKits > 0 && !(items.length - now)) {
      out.push(`The current list has ${wasKits} kit${wasKits === 1 ? "" : "s"} and the new one has none.`);
    }
  }
  return out;
}

function build(csv, kitsCsv) {
  if (typeof csv !== "string" || !csv.trim()) throw new Error("The file is empty.");
  return buildInventory(csv, { kitsCsv: typeof kitsCsv === "string" && kitsCsv.trim() ? kitsCsv : null });
}

/** Returns { status, data }. */
async function run(action, body, store) {
  const baseline = await store.get(CURRENT);
  const previous = await store.get(PREVIOUS);

  if (action === "status") {
    return { status: 200, data: { current: meta(baseline), previous: meta(previous) } };
  }

  if (action === "preview" || action === "publish") {
    let built;
    try {
      built = build(body && body.csv, body && body.kitsCsv);
    } catch (err) {
      return { status: 400, data: { error: `Couldn't use that file: ${err.message}` } };
    }
    const record = {
      generatedAt: new Date().toISOString(),
      filename: String((body && body.filename) || "").slice(0, 200),
      items: built.items,
    };

    if (action === "preview") {
      return {
        status: 200,
        data: {
          next: meta(record),
          current: meta(baseline),
          diff: baseline ? diff(baseline.items, built.items) : null,
          warnings: warningsFor(built, baseline),
        },
      };
    }

    if (baseline) await store.set(PREVIOUS, baseline);
    await store.set(CURRENT, record);
    return {
      status: 200,
      data: { ok: true, current: meta(record), previous: meta(baseline) },
    };
  }

  if (action === "restore") {
    if (!previous) return { status: 400, data: { error: "There is no earlier list to go back to." } };
    // Swap, so restoring twice gets you back where you started.
    const restored = { ...previous, generatedAt: new Date().toISOString() };
    if (baseline) await store.set(PREVIOUS, baseline);
    await store.set(CURRENT, restored);
    return { status: 200, data: { ok: true, current: meta(restored), previous: meta(baseline) } };
  }

  return { status: 400, data: { error: "Unknown action." } };
}

module.exports = { run, meta, diff, CURRENT, PREVIOUS };
