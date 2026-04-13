import fs from "node:fs/promises";

const stickerKitsPath = "merged_sticker_kits.txt";
const englishPath = "csgo_english.txt";
const outputPath = "sticker_map.json";

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
      if (depth === 0) return i;
    }
  }

  return -1;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const stickerText = await fs.readFile(stickerKitsPath, "utf8");
  const englishText = await fs.readFile(englishPath, "utf8");

  const entryStartRegex = /"(\d+)"\s*\{/g;

  const result = {};
  let match;

  while ((match = entryStartRegex.exec(stickerText)) !== null) {
    const stickerId = Number(match[1]);

    const openBraceIndex = stickerText.indexOf("{", match.index);
    const closeBraceIndex = findMatchingBrace(stickerText, openBraceIndex);

    if (closeBraceIndex === -1) continue;

    const block = stickerText.slice(match.index, closeBraceIndex + 1);

    const itemNameMatch = block.match(/"item_name"\s*"([^"]+)"/);
    if (!itemNameMatch) continue;

    const rawToken = itemNameMatch[1];
    const token = rawToken.startsWith("#") ? rawToken.slice(1) : rawToken;

    const translationRegex = new RegExp(
      `"${escapeRegex(token)}"\\s*"([^"]+)"`,
      "i",
    );

    const translationMatch = englishText.match(translationRegex);
    if (!translationMatch) continue;

    const displayName = translationMatch[1];

    const finalName = `Sticker | ${displayName}`;

    if (result[finalName]) {
      console.log(
        `Duplicate name overwrite: ${finalName} | old=${result[finalName].stickerid} new=${stickerId}`,
      );
    }

    result[finalName] = {
      stickerid: stickerId,
    };

    entryStartRegex.lastIndex = closeBraceIndex + 1;
  }

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

  console.log(`Saved ${Object.keys(result).length} stickers to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
