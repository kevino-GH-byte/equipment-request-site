"use strict";

/*
 * Where the equipment list comes from at run time.
 *
 * 1. The list uploaded on the update page (kept in Netlify Blobs).
 * 2. If nothing has been uploaded yet, or the store can't be read, the sample list bundled
 *    at deploy time from data/inventory.csv. The `warning` field says when this is a fallback
 *    after an error rather than the normal "nothing uploaded yet" state.
 */
const { getListStore } = require("./store");
const { CURRENT } = require("./admin-core");

let bundled = null;
try {
  bundled = require("./inventory.json");
} catch (err) {
  // Written by `npm run build`; absent only if the build step was skipped.
}

const CACHE_MS = 20 * 1000;
let cache = null; // { at, data } of the last uploaded list we read

function clearCache() {
  cache = null;
}

function fallback(warning) {
  if (cache) return { ...cache.data, stale: true, warning };
  if (bundled) return { ...bundled, source: "bundled", ...(warning ? { warning } : {}) };
  return { items: [], source: "none", ...(warning ? { warning } : {}) };
}

async function getInventory(event) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  let record;
  try {
    record = await getListStore(event).get(CURRENT);
  } catch (err) {
    console.error("Could not read the uploaded equipment list:", err.message);
    return fallback("The saved equipment list couldn't be read.");
  }

  if (record && Array.isArray(record.items) && record.items.length) {
    const data = {
      generatedAt: record.generatedAt,
      filename: record.filename || "",
      items: record.items,
      source: "uploaded",
    };
    cache = { at: Date.now(), data };
    return data;
  }
  return fallback();
}

module.exports = { getInventory, clearCache };
