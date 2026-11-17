"use strict";

/*
 * Backs public/admin.html. Every request must carry the passcode in the x-admin-passcode
 * header; it is compared with the ADMIN_PASSCODE environment variable. Five wrong
 * guesses lock the page for 15 minutes.
 */
const crypto = require("crypto");
const { getListStore } = require("../lib/store");
const { run } = require("../lib/admin-core");
const { clearCache } = require("../lib/inventory-source");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const MAX_BODY = 4 * 1024 * 1024;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const LOCK_KEY = "lockout";

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const passcodeMatches = (given, expected) => crypto.timingSafeEqual(digest(given), digest(expected));

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    return json(503, { error: "The update page isn't set up yet. Add the ADMIN_PASSCODE setting in Netlify and redeploy." });
  }

  let store;
  try {
    store = getListStore(event);
  } catch (err) {
    console.error("Store unavailable:", err.message);
    return json(503, { error: "Storage isn't available right now." });
  }

  try {
    const lock = (await store.get(LOCK_KEY)) || { fails: 0, until: 0 };
    if (lock.until && lock.until > Date.now()) {
      const mins = Math.ceil((lock.until - Date.now()) / 60000);
      return json(429, { error: `Too many wrong passcodes. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.` });
    }

    const given = (event.headers && (event.headers["x-admin-passcode"] || event.headers["X-Admin-Passcode"])) || "";
    if (!given || !passcodeMatches(given, expected)) {
      const fails = (lock.until ? 0 : lock.fails) + 1;
      await store.set(LOCK_KEY, fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MS } : { fails, until: 0 });
      return json(401, { error: "That passcode isn't right." });
    }
    if (lock.fails || lock.until) await store.set(LOCK_KEY, { fails: 0, until: 0 });

    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    if (Buffer.byteLength(raw) > MAX_BODY) {
      return json(413, { error: "That file is too large. The limit is about 4 MB." });
    }
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch (err) {
      return json(400, { error: "Bad request." });
    }

    const result = await run(body.action, body, store);
    if (result.status === 200 && (body.action === "publish" || body.action === "restore")) clearCache();
    return json(result.status, result.data);
  } catch (err) {
    console.error("Update page request failed:", err && err.name, err && err.message);
    if (err && err.name === "MissingBlobsEnvironmentError") {
      return json(500, { error: "Storage isn't connected to this site (Netlify Blobs). See the README section on storage, or add BLOBS_SITE_ID and BLOBS_TOKEN." });
    }
    return json(500, { error: `Something went wrong saving the list (${(err && err.name) || "error"}). Try again, and check the function log in Netlify if it keeps happening.` });
  }
};
