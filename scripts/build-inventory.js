#!/usr/bin/env node
/*
 * Builds the bundled equipment list from data/inventory.csv (override with INVENTORY_CSV=path).
 *
 * This is the sample list shown until the first upload on the update page (public/admin.html).
 *
 * Output: public/inventory.json and netlify/lib/inventory.json
 */
const fs = require("fs");
const path = require("path");
const { buildInventory } = require("../netlify/lib/inventory-build");

const ROOT = path.join(__dirname, "..");
const SRC = process.env.INVENTORY_CSV || path.join(ROOT, "data", "inventory.csv");
const OUTPUTS = [
  path.join(ROOT, "public", "inventory.json"),
  path.join(ROOT, "netlify", "lib", "inventory.json"),
];

function fail(msg) {
  console.error(`\nInventory build failed: ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(SRC)) {
  fail(`${SRC} not found. Save your CheqRoom asset sheet as CSV at data/inventory.csv.`);
}

let result;
try {
  result = buildInventory(fs.readFileSync(SRC));
} catch (err) {
  fail(err.message);
}

const output = JSON.stringify({ generatedAt: new Date().toISOString(), items: result.items });
for (const file of OUTPUTS) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, output);
}

const { stats } = result;
const categories = new Set(result.items.filter((i) => i.type !== "kit").map((i) => i.category));
console.log(
  `Inventory built: ${stats.lines} items (${stats.units} units) in ${categories.size} categories, ` +
    `${stats.kits} kit(s). ${stats.skipped} row(s) skipped. Columns used: ${Object.entries(stats.columns)
      .map(([f, h]) => `${f}="${h}"`)
      .join(", ")}`
);
