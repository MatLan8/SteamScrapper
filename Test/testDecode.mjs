import { decodeLink } from "@csfloat/cs2-inspect-serializer";

const inspectLink = process.argv[2];

if (!inspectLink) {
  console.log("Usage: node test.js <inspect_link>");
  process.exit(1);
}

const data = decodeLink(inspectLink);
console.log(data);
