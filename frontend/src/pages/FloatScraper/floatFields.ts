import type { FieldConfig } from "@/types";

/** Required first, then defaults, then optional caps, then cookie + toggles */
export const MULTI_BROWSER_FIELDS: FieldConfig[] = [
  {
    name: "wear",
    label: "Wear",
    type: "select",
    required: true,
    options: [
      { value: "fn", label: "Factory New (fn)" },
      { value: "bs", label: "Battle-Scarred (bs)" },
    ],
    defaultValue: "fn",
  },
  {
    name: "mode",
    label: "Float mode",
    type: "select",
    required: true,
    options: [
      { value: "lowest", label: "Lowest float" },
      { value: "highest", label: "Highest float" },
    ],
    defaultValue: "lowest",
  },
  {
    name: "quality",
    label: "Quality",
    type: "select",
    options: [
      { value: "normal", label: "Normal" },
      { value: "st", label: "StatTrak" },
      { value: "sv", label: "Souvenir" },
    ],
    defaultValue: "normal",
  },
  {
    name: "top",
    label: "Top per skin",
    type: "number",
    helpText:
      "How many top floats to keep per weapon skin before global merge.",
    defaultValue: 10,
  },
  {
    name: "workers",
    label: "Workers",
    type: "number",
    defaultValue: 3,
  },
  {
    name: "waitMs",
    label: "Wait (ms)",
    type: "number",
    defaultValue: 1500,
  },
  {
    name: "maxSkins",
    label: "Max skins (optional)",
    type: "number",
    helpText: "Cap how many skins to scan.",
  },
  {
    name: "maxListingsPerSkin",
    label: "Max listings per skin (optional)",
    type: "number",
  },
  {
    name: "maxPrice",
    label: "Max price (optional)",
    type: "number",
    helpText: "Max skin price in EUR",
  },
  {
    name: "cookie",
    label: "Steam cookie (optional)",
    type: "textarea",
    placeholder: "Raw Cookie header for authenticated requests",
  },
  {
    name: "headful",
    label: "Headful browser",
    type: "checkbox",
    helpText: "Show Chromium windows.",
    defaultValue: false,
  },
  {
    name: "debug",
    label: "Debug logging",
    type: "checkbox",
    defaultValue: false,
  },
];

export const SINGLE_ENDPOINT_FIELDS: FieldConfig[] = [
  {
    name: "url",
    label: "Listing URL",
    type: "text",
    required: true,
    placeholder: "https://steamcommunity.com/market/listings/730/...",
  },
  {
    name: "mode",
    label: "Float mode",
    type: "select",
    options: [
      { value: "lowest", label: "Lowest float" },
      { value: "highest", label: "Highest float" },
    ],
    defaultValue: "lowest",
  },
  {
    name: "top",
    label: "Top results",
    type: "number",
    defaultValue: 10,
  },
  {
    name: "maxWindows",
    label: "Workers",
    type: "number",
    helpText: "Parallel workers (HTTP).",
    defaultValue: 10,
  },
  {
    name: "waitMs",
    label: "Wait (ms)",
    type: "number",
    defaultValue: 1500,
  },
  {
    name: "currency",
    label: "Steam currency ID",
    type: "number",
    helpText: "3 = EUR (default).",
    defaultValue: 3,
  },
  {
    name: "maxPrice",
    label: "Max price (optional)",
    type: "number",
    helpText: "Max skin price in EUR",
  },
  {
    name: "cookie",
    label: "Steam cookie (optional)",
    type: "textarea",
  },
  {
    name: "debug",
    label: "Debug logging",
    type: "checkbox",
    defaultValue: false,
  },
];

export const SINGLE_PLAYWRIGHT_FIELDS: FieldConfig[] = [
  {
    name: "url",
    label: "Listing URL",
    type: "text",
    required: true,
    placeholder: "https://steamcommunity.com/market/listings/730/...",
  },
  {
    name: "mode",
    label: "Float mode",
    type: "select",
    options: [
      { value: "lowest", label: "Lowest float" },
      { value: "highest", label: "Highest float" },
    ],
    defaultValue: "lowest",
  },
  {
    name: "top",
    label: "Top results",
    type: "number",
    defaultValue: 10,
  },
  {
    name: "maxWindows",
    label: "Workers",
    type: "number",
    defaultValue: 10,
  },
  {
    name: "waitMs",
    label: "Wait (ms)",
    type: "number",
    defaultValue: 1500,
  },
  {
    name: "maxPrice",
    label: "Max price (optional)",
    type: "number",
    helpText: "Max skin price in EUR",
  },
  {
    name: "cookie",
    label: "Steam cookie (optional)",
    type: "textarea",
  },
  {
    name: "headful",
    label: "Headful browser",
    type: "checkbox",
    helpText: "Show Chromium windows.",
    defaultValue: false,
  },
  {
    name: "debug",
    label: "Debug logging",
    type: "checkbox",
    defaultValue: false,
  },
];

export function defaultsFromFields(
  fields: FieldConfig[],
): Record<string, string | number | boolean> {
  const o: Record<string, string | number | boolean> = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined) o[f.name] = f.defaultValue;
    else if (f.type === "checkbox") o[f.name] = false;
    else if (f.type === "number") o[f.name] = "";
    else o[f.name] = "";
  }
  return o;
}
