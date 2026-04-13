import fs from "node:fs/promises";

const charmsPath = "merged_charms.txt";
const englishPath = "csgo_english.txt";
const outputPath = "../Database/charms_map.json";

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

function getBlockBody(text, blockName) {
  const key = `"${blockName}"`;
  const blockIndex = text.indexOf(key);

  if (blockIndex === -1) return null;

  const openBraceIndex = text.indexOf("{", blockIndex);
  if (openBraceIndex === -1) return null;

  const closeBraceIndex = findMatchingBrace(text, openBraceIndex);
  if (closeBraceIndex === -1) return null;

  return text.slice(openBraceIndex + 1, closeBraceIndex);
}

function getTranslation(englishText, token) {
  const cleanToken = token.startsWith("#") ? token.slice(1) : token;

  const translationRegex = new RegExp(
    `"${escapeRegex(cleanToken)}"\\s*"([^"]+)"`,
    "i",
  );

  const match = englishText.match(translationRegex);
  return match ? match[1] : null;
}

function parseEntries(blockBody) {
  const entries = [];
  const entryStartRegex = /"(\d+)"\s*\{/g;
  let match;

  while ((match = entryStartRegex.exec(blockBody)) !== null) {
    const id = Number(match[1]);
    const openBraceIndex = blockBody.indexOf("{", match.index);
    const closeBraceIndex = findMatchingBrace(blockBody, openBraceIndex);

    if (closeBraceIndex === -1) continue;

    const entryText = blockBody.slice(match.index, closeBraceIndex + 1);
    entries.push({ id, text: entryText });

    entryStartRegex.lastIndex = closeBraceIndex + 1;
  }

  return entries;
}

function extractField(text, fieldName) {
  const regex = new RegExp(`"${escapeRegex(fieldName)}"\\s*"([^"]+)"`);
  const match = text.match(regex);
  return match ? match[1] : null;
}

async function main() {
  const charmsText = await fs.readFile(charmsPath, "utf8");
  const englishText = await fs.readFile(englishPath, "utf8");

  const keychainBody = getBlockBody(charmsText, "keychain_definitions");
  const highlightBody = getBlockBody(charmsText, "highlight_reels");

  if (!keychainBody) {
    throw new Error('Could not find "keychain_definitions" block');
  }

  if (!highlightBody) {
    throw new Error('Could not find "highlight_reels" block');
  }

  const result = {
    charms: {},
    highlight_reels: {},
  };

  // normal charms
  const keychainEntries = parseEntries(keychainBody);

  for (const entry of keychainEntries) {
    const locName = extractField(entry.text, "loc_name");
    if (!locName) continue;

    const displayName = getTranslation(englishText, locName);
    if (!displayName) continue;

    const finalName = `Charm | ${displayName}`;

    result.charms[finalName] = {
      stickerid: entry.id,
    };
  }

  // highlight reels
  const highlightEntries = parseEntries(highlightBody);

  for (const entry of highlightEntries) {
    const reelId = extractField(entry.text, "id");
    if (!reelId) continue;

    const tournamentKey = reelId.split("_")[0];
    if (!tournamentKey) continue;

    const tournamentToken = `keychain_kc_${tournamentKey}`;
    const tournamentName = getTranslation(englishText, tournamentToken);
    if (!tournamentName) continue;

    const reelToken = `HighlightReel_${reelId}`;
    const reelName = getTranslation(englishText, reelToken);
    if (!reelName) continue;

    const finalName = `Souvenir Charm | ${tournamentName} | ${reelName}`;

    result.highlight_reels[finalName] = {
      stickerid: entry.id,
    };
  }

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

  console.log(`Saved ${Object.keys(result.charms).length} normal charms`);
  console.log(
    `Saved ${Object.keys(result.highlight_reels).length} highlight reels`,
  );
  console.log(`Output written to ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
