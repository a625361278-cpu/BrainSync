import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve("node_modules/chinese-idiom-chengyu/src/data/idiom.json");
const outputPath = resolve("src/server/data/idioms.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const aliases = new Map([["发愤图强", ["发奋图强"]]]);

const idioms = [];
const seen = new Set();

for (const item of source) {
  if (!item.word || !item.pinyin) {
    continue;
  }
  if (!/^[\u4e00-\u9fff]{4}$/.test(item.word)) {
    continue;
  }
  if (seen.has(item.word)) {
    continue;
  }
  const pinyin = item.pinyin.split(/\s+/).map(stripTone);
  if (pinyin.length !== [...item.word].length || pinyin.some((syllable) => !/^[a-z]+$/.test(syllable))) {
    continue;
  }
  seen.add(item.word);
  const entry = { text: item.word, pinyin };
  const entryAliases = aliases.get(item.word);
  if (entryAliases) {
    entry.aliases = entryAliases;
  }
  idioms.push(entry);
}

ensureManualEntry(idioms, seen, {
  text: "发愤图强",
  pinyin: ["fa", "fen", "tu", "qiang"],
  aliases: ["发奋图强"]
});

writeFileSync(outputPath, `${JSON.stringify(idioms, null, 2)}\n`, "utf8");
console.log(`Generated ${idioms.length} idioms -> ${outputPath}`);

function stripTone(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ü/g, "v")
    .replace(/Ü/g, "v")
    .toLowerCase();
}

function ensureManualEntry(idioms, seen, entry) {
  if (seen.has(entry.text)) {
    const existing = idioms.find((idiom) => idiom.text === entry.text);
    existing.aliases = entry.aliases;
    return;
  }
  idioms.unshift(entry);
  seen.add(entry.text);
}
