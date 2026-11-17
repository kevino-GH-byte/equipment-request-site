"use strict";

/*
 * Where the uploaded equipment list is kept.
 *
 * On Netlify this is Netlify Blobs (built in, no setup). Setting LIST_STORE_DIR switches to
 * plain JSON files in that folder, which is how the tests run without a Netlify account.
 * Interface: get(key) -> object | null, set(key, object), delete(key).
 */
const fs = require("fs");
const path = require("path");

function fileStore(dir) {
  const file = (key) => path.join(dir, `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`);
  return {
    async get(key) {
      try {
        return JSON.parse(fs.readFileSync(file(key), "utf8"));
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },
    async set(key, value) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file(key), JSON.stringify(value));
    },
    async delete(key) {
      try {
        fs.unlinkSync(file(key));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    },
  };
}

function getListStore(event) {
  const dir = process.env.LIST_STORE_DIR;
  if (dir) return fileStore(dir);

  const blobs = require("@netlify/blobs");
  // Normally Netlify supplies the connection details with each request. If that ever isn't the
  // case, BLOBS_SITE_ID and BLOBS_TOKEN (a Netlify personal access token) connect it by hand.
  const manual = process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN
    ? { siteID: process.env.BLOBS_SITE_ID.trim(), token: process.env.BLOBS_TOKEN.trim() }
    : {};
  if (!manual.siteID && event && event.blobs) blobs.connectLambda(event);
  const strong = blobs.getStore({ name: "equipment-list", consistency: "strong", ...manual });
  const eventual = blobs.getStore({ name: "equipment-list", ...manual });
  // Reads right after a write should see the new value ("strong"). Some Netlify setups don't
  // support that and throw BlobsConsistencyError; then fall back to normal reads, which can lag
  // behind a write by up to a minute.
  let strongWorks = true;
  return {
    async get(key) {
      if (strongWorks) {
        try {
          return await strong.get(key, { type: "json" });
        } catch (err) {
          if (!err || err.name !== "BlobsConsistencyError") throw err;
          strongWorks = false;
        }
      }
      return eventual.get(key, { type: "json" });
    },
    set: (key, value) => eventual.setJSON(key, value),
    delete: (key) => eventual.delete(key),
  };
}

module.exports = { getListStore };
