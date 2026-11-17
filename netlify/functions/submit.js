"use strict";

const crypto = require("crypto");
const { validate, todayInLA } = require("../lib/validate");
const { buildPdf, fmtDate, daysOut } = require("../lib/pdf");

const { getInventory } = require("../lib/inventory-source");

const MAX_BODY_BYTES = 100 * 1024;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function makeRef() {
  return `ER-${todayInLA().replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function emailHtml(d) {
  const units = d.items.reduce((n, it) => n + it.qty, 0);
  const row = (label, value) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#5b6373;font-size:13px;white-space:nowrap">${esc(label)}</td>` +
    `<td style="padding:6px 0;font-size:14px;color:#0f1115">${esc(value)}</td></tr>`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f8fa">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f1115">
  <div style="border-top:6px solid #edbf26;background:#ffffff;border-radius:0 0 12px 12px;padding:28px 24px;border:1px solid #c5cad3;border-top:6px solid #edbf26">
    <h1 style="margin:0 0 8px;font-size:22px">Equipment request received</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#2a2f3a;line-height:1.5">
      Hi ${esc(d.main.first)}, your PDF copy is attached. Post it in the equipment Slack channel with your proposed dates so they can be approved.
    </p>
    <table role="presentation" style="border-collapse:collapse;margin:0 0 20px">
      ${row("Reference", d.ref)}
      ${d.project ? row("Project", d.project) : ""}
      ${row("Proposed shoot date", fmtDate(d.shootDate))}
      ${row("Pick-up", fmtDate(d.pickupDate))}
      ${row("Return", fmtDate(d.returnDate) + " (" + daysOut(d.pickupDate, d.returnDate) + " days out)")}
      ${row("Equipment", d.items.length + " item(s), " + units + " unit(s)")}
    </table>
    <p style="margin:0;font-size:12px;color:#5b6373;line-height:1.5">
      This is a request, not a confirmed reservation. The equipment manager creates the CheqRoom reservation after the dates are approved.
    </p>
  </div>
</div>
</body></html>`;
}

function emailText(d) {
  const units = d.items.reduce((n, it) => n + it.qty, 0);
  return [
    `Hi ${d.main.first},`,
    "",
    "Your equipment request PDF is attached. Post it in the equipment Slack channel with your proposed dates so they can be approved.",
    "",
    `Reference: ${d.ref}`,
    d.project ? `Project: ${d.project}` : null,
    `Proposed shoot date: ${fmtDate(d.shootDate)}`,
    `Pick-up: ${fmtDate(d.pickupDate)}`,
    `Return: ${fmtDate(d.returnDate)}`,
    `Equipment: ${d.items.length} item(s), ${units} unit(s)`,
    "",
    "This is a request, not a confirmed reservation.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Sends through Resend (https://resend.com). To use another provider, replace this function.
async function sendEmail({ to, cc, replyTo, subject, html, text, pdf, filename }) {
  const body = {
    from: process.env.FROM_EMAIL,
    to: [to],
    subject,
    html,
    text,
    attachments: [{ filename, content: pdf.toString("base64") }],
  };
  if (cc) body.cc = [cc];
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Email provider returned ${res.status}: ${await res.text()}`);
  }
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

  const missing = ["RESEND_API_KEY", "FROM_EMAIL"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    return json(500, { error: "Email isn't set up on the server yet. Let the equipment team know." });
  }

  try {
    const data = { ...clean, ref: makeRef(), submittedAt: new Date() };
    const pdf = await buildPdf(data);

    const manager = (process.env.EQUIPMENT_MANAGER_EMAIL || "").trim().toLowerCase();
    const subject =
      `Equipment request ${data.ref}: ${data.main.first} ${data.main.last}` +
      (data.project ? ` - ${data.project}` : "");

    await sendEmail({
      to: data.main.email,
      cc: manager && manager !== data.main.email ? manager : null,
      replyTo: manager || null,
      subject: subject.slice(0, 180),
      html: emailHtml(data),
      text: emailText(data),
      pdf,
      filename: `${data.ref}.pdf`,
    });

    return json(200, { ok: true, ref: data.ref, sentTo: data.main.email, filename: `${data.ref}.pdf`, pdf: pdf.toString("base64") });
  } catch (err) {
    console.error("Request failed:", err);
    return json(502, { error: "We couldn't send the email. Try again, or let the equipment team know." });
  }
};
