import fs from "node:fs/promises";

const inputPath = "items_game.txt";
const outputPath = "merged_charms.txt";

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

function extractMergedBlock(text, blockName, options = {}) {
  const { skipIfContainsField = null } = options;

  const blockHeader = `"${blockName}"`;
  const entries = [];
  const seenIds = new Set();

  let searchIndex = 0;

  while (true) {
    const blockStart = text.indexOf(blockHeader, searchIndex);
    if (blockStart === -1) break;

    const openBraceIndex = text.indexOf("{", blockStart);
    if (openBraceIndex === -1) break;

    const closeBraceIndex = findMatchingBrace(text, openBraceIndex);
    if (closeBraceIndex === -1) break;

    const blockBody = text.slice(openBraceIndex + 1, closeBraceIndex);

    let entrySearchIndex = 0;

    while (true) {
      const idMatch = /"(\d+)"/g;
      idMatch.lastIndex = entrySearchIndex;
      const match = idMatch.exec(blockBody);

      if (!match) break;

      const id = match[1];
      const idStart = match.index;
      const openEntryBrace = blockBody.indexOf("{", idMatch.lastIndex);

      if (openEntryBrace === -1) break;

      const between = blockBody.slice(idMatch.lastIndex, openEntryBrace);

      if (between.trim() !== "") {
        entrySearchIndex = idMatch.lastIndex;
        continue;
      }

      const closeEntryBrace = findMatchingBrace(blockBody, openEntryBrace);
      if (closeEntryBrace === -1) {
        entrySearchIndex = openEntryBrace + 1;
        continue;
      }

      const entryText = blockBody.slice(idStart, closeEntryBrace + 1).trim();

      if (
        skipIfContainsField &&
        entryText.includes(`"${skipIfContainsField}"`)
      ) {
        entrySearchIndex = closeEntryBrace + 1;
        continue;
      }

      if (!seenIds.has(id)) {
        entries.push(entryText);
        seenIds.add(id);
      }

      entrySearchIndex = closeEntryBrace + 1;
    }

    searchIndex = closeBraceIndex + 1;
  }

  const indentedEntries = entries
    .map((entry) => "\t" + entry.replace(/\n/g, "\n\t"))
    .join("\n");

  const blockText = `"${blockName}"\n{\n${indentedEntries}\n}\n`;

  return {
    blockText,
    count: entries.length,
  };
}

async function main() {
  const text = await fs.readFile(inputPath, "utf8");

  const keychains = extractMergedBlock(text, "keychain_definitions", {
    skipIfContainsField: "tags",
  });

  const highlights = extractMergedBlock(text, "highlight_reels");

  const output = `${keychains.blockText}\n${highlights.blockText}`;

  await fs.writeFile(outputPath, output, "utf8");

  console.log(
    `Merged ${keychains.count} unique keychain entries into keychain_definitions`,
  );
  console.log(
    `Merged ${highlights.count} unique highlight entries into highlight_reels`,
  );
  console.log(`Saved to ${outputPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
