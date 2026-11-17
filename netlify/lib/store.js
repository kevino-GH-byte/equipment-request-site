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
  if (event && event.blobs) blobs.connectLambda(event);
  const store = blobs.getStore({ name: "equipment-list", consistency: "strong" });
  return {
    get: (key) => store.get(key, { type: "json" }),
    set: (key, value) => store.setJSON(key, value),
    delete: (key) => store.delete(key),
  };
}

module.exports = { getListStore };
