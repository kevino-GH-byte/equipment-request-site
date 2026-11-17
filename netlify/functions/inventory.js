"use strict";

const { getInventory } = require("../lib/inventory-source");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache" };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed." }) };
  }
  try {
    return { statusCode: 200, headers, body: JSON.stringify(await getInventory(event)) };
  } catch (err) {
    console.error("Inventory request failed:", err.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: "The equipment list isn't available right now." }) };
  }
};
