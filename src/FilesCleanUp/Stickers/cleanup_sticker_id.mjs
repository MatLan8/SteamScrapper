import fs from "node:fs/promises";

const inputPath = "items_game.txt";
const outputPath = "merged_sticker_kits.txt";

function findMatchingBrace(text, openBraceIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

async function main() {
  const text = await fs.readFile(inputPath, "utf8");

  const regex = /"sticker_kits"\s*\{/g;
  const entryRegex = /^\s*"(\d+)"\s*\n?\s*\{[\s\S]*?^\s*\}/gm;

  const entries = [];
  const seenIds = new Set();
  let skippedGraffiti = 0;
  let skippedPatches = 0;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const blockStart = match.index;
    const openBraceIndex = text.indexOf("{", blockStart);
    const closeBraceIndex = findMatchingBrace(text, openBraceIndex);

    if (closeBraceIndex === -1) continue;

    const blockBody = text.slice(openBraceIndex + 1, closeBraceIndex);

    let entryMatch;
    while ((entryMatch = entryRegex.exec(blockBody)) !== null) {
      const entryText = entryMatch[0];

      const idMatch = entryText.match(/^\s*"(\d+)"/m);
      if (!idMatch) continue;

      const id = idMatch[1];
      if (seenIds.has(id)) continue;

      const nameMatch = entryText.match(/"name"\s*"([^"]+)"/);
      if (!nameMatch) continue;

      const internalName = nameMatch[1];

      if (
        internalName.startsWith("spray_") ||
        internalName.endsWith("_graffiti")
      ) {
        skippedGraffiti += 1;
        continue;
      }

      if (/"patch_material"\s*"/.test(entryText)) {
        skippedPatches += 1;
        continue;
      }

      seenIds.add(id);
      entries.push(entryText.trim());
    }
  }

  const output =
    `"sticker_kits"\n{\n` +
    entries.map((e) => "\t" + e.replace(/\n/g, "\n\t")).join("\n") +
    `\n}\n`;

  await fs.writeFile(outputPath, output, "utf8");

  console.log(`Merged ${entries.length} unique sticker entries`);
  console.log(`Skipped graffiti/sprays: ${skippedGraffiti}`);
  console.log(`Skipped patches: ${skippedPatches}`);
  console.log(`Saved to ${outputPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
