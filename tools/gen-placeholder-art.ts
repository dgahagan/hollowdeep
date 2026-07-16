import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// `gen-placeholder-art` — generate reproducible placeholder SVGs for all artIds
// in an adventure module.
//
// This script reads locations.json, items.json, and creatures.json from a
// module directory, collects every distinct artId, and generates a minimal SVG
// for each one, labelled with the entity's own name. The set is reproducible
// and deterministic — running it twice produces byte-identical files, so the
// placeholder art can be regenerated when the module grows.
//
// Usage: npx tsx tools/gen-placeholder-art.ts [moduleDir]
//   moduleDir defaults to 'adventures/test-cave'
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Parses a JSON file defensively, returning unknown. The caller narrows it. */
async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Escapes XML special characters so labels can safely embed in SVG.
 * Handles `&`, `<`, `>`, `"`, `'` (all five required by XML spec).
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates a minimal placeholder SVG for a single artId, with the label
 * overlaid on a muted background. The viewBox is 512x288 (16:9-ish).
 * Includes a `<title>` element and `role="img"` for accessibility (NFR-5).
 */
function generateSvg(label: string): string {
  const escapedLabel = escapeXml(label);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 288" width="512" height="288" role="img">
  <title>${escapedLabel}</title>
  <rect width="512" height="288" fill="#2b2b33"/>
  <rect x="8" y="8" width="496" height="272" fill="none" stroke="#4a4a57" stroke-width="2"/>
  <text x="256" y="150" font-family="Georgia, serif" font-size="26" fill="#c9c4b4" text-anchor="middle">${escapedLabel}</text>
</svg>
`;
}

/**
 * Collects all artIds from locations, items, and creatures, and builds a map
 * of artId to its preferred label (the entity's own name).
 *
 * Narrowing is strict: we skip any entry that doesn't have the required fields
 * or has a wrong type. This is robust against partial or corrupted JSON.
 */
async function collectArtIds(moduleDir: string): Promise<Map<string, string>> {
  const artIdToLabel = new Map<string, string>();

  // Read locations.json and extract all locations' artIds with their names
  const locationsPath = path.join(moduleDir, 'locations.json');
  const locationsJson = await readJson(locationsPath);
  if (isArray(locationsJson)) {
    for (const loc of locationsJson) {
      if (isRecord(loc) && isString(loc.artId) && isString(loc.name)) {
        // For locations, use the `name` field (e.g., "End of Road", "Tin Shed")
        artIdToLabel.set(loc.artId, loc.name);
      }
    }
  }

  // Read items.json and extract all items' artIds with their first name
  const itemsPath = path.join(moduleDir, 'items.json');
  const itemsJson = await readJson(itemsPath);
  if (isArray(itemsJson)) {
    for (const item of itemsJson) {
      if (isRecord(item) && isString(item.artId) && isArray(item.names)) {
        // For items, use the first entry in the `names` array
        const firstName = item.names[0];
        if (isString(firstName)) {
          artIdToLabel.set(item.artId, firstName);
        }
      }
    }
  }

  // Read creatures.json and extract all creatures' artIds with their first name
  const creaturesPath = path.join(moduleDir, 'creatures.json');
  const creaturesJson = await readJson(creaturesPath);
  if (isArray(creaturesJson)) {
    for (const creature of creaturesJson) {
      if (isRecord(creature) && isString(creature.artId) && isArray(creature.names)) {
        // For creatures, use the first entry in the `names` array
        const firstName = creature.names[0];
        if (isString(firstName)) {
          artIdToLabel.set(creature.artId, firstName);
        }
      }
    }
  }

  return artIdToLabel;
}

async function main(): Promise<void> {
  // Accept module directory as argv[2], default to 'adventures/test-cave'
  const moduleDir = process.argv[2] ?? 'adventures/test-cave';
  const artDir = path.join(moduleDir, 'art');

  // Collect all artIds and their labels from the module's documents
  const artIdToLabel = await collectArtIds(moduleDir);

  if (artIdToLabel.size === 0) {
    console.log('no artIds found in module');
    return;
  }

  // Ensure the art directory exists
  await mkdir(artDir, { recursive: true });

  // Generate and write an SVG for each artId, in sorted order for determinism
  const sortedArtIds = Array.from(artIdToLabel.keys()).sort();
  for (const artId of sortedArtIds) {
    const label = artIdToLabel.get(artId);
    if (label === undefined) {
      // This should not happen (Map.get on a key we just sorted from), but TS
      // requires us to narrow it anyway under noUncheckedIndexedAccess.
      continue;
    }
    const filePath = path.join(artDir, `${artId}.svg`);
    const svg = generateSvg(label);
    await writeFile(filePath, svg, 'utf-8');
  }

  console.log(`wrote ${artIdToLabel.size} placeholder SVGs to ${artDir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
