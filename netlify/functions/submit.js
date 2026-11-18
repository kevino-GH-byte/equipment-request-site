"use strict";

const crypto = require("crypto");
const { validate, todayInLA } = require("../lib/validate");
const { buildPdf } = require("../lib/pdf");

const { getInventory } = require("../lib/inventory-source");

const MAX_BODY_BYTES = 100 * 1024;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

function makeRef() {
  return `ER-${todayInLA().replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  if (Buffer.byteLength(event.body || "", "utf8") > MAX_BODY_BYTES) {
    return json(413, { error: "That request is too large." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return json(400, { error: "Invalid request." });
  }

  // Honeypot: real people never fill this in. Pretend it worked.
  if (payload && typeof payload.website === "string" && payload.website.trim()) {
    return json(200, { ok: true });
  }

  // Quantities and names are checked against the current equipment list, not what the browser sent.
  let inventory = null;
  try {
    inventory = await getInventory(event);
  } catch (err) {
    console.error("Could not load inventory; skipping inventory checks:", err.message);
  }

  const { errors, clean } = validate(payload, inventory);
  if (errors.length) {
    return json(400, { error: "Please fix the following and try again.", errors });
  }

  try {
    // Editing a request re-sends the form with its earlier reference, so the new PDF replaces the old one.
    const ref = payload && typeof payload.ref === "string" && /^ER-\d{8}-[A-Z0-9]{4}$/.test(payload.ref) ? payload.ref : makeRef();
    const rev = payload && Number.isInteger(payload.revision) && payload.revision > 1 && payload.revision <= 50 ? payload.revision : 1;
    const data = { ...clean, ref, revision: rev, submittedAt: new Date() };
    const pdf = await buildPdf(data);
    return json(200, { ok: true, ref: data.ref, revision: rev, filename: rev > 1 ? `${data.ref}-rev${rev}.pdf` : `${data.ref}.pdf`, pdf: pdf.toString("base64") });
  } catch (err) {
    console.error("Request failed:", err);
    return json(500, { error: "We couldn't create the PDF. Try again, or let the equipment team know." });
  }
};
