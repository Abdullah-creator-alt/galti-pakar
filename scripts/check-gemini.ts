/**
 * Verifies Gemini access. Run: npm run check:gemini
 * (loads .env.local via node --env-file)
 */
import { deflateSync } from "node:zlib";
import { EMBEDDING_DIMENSIONS, GEMINI_EMBEDDING_MODEL, GEMINI_TEXT_MODEL, GEMINI_VISION_MODEL } from "../lib/config.ts";
import { embed, generateJson, generateText, listModels } from "../lib/gemini.ts";

/** Builds a 64x64 PNG: white background with a solid red square. No dependencies. */
function testPng(): string {
  const size = 64;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const red = x >= 16 && x < 48 && y >= 16 && y < 48;
      const o = row + 1 + x * 3;
      raw[o] = 255;
      raw[o + 1] = red ? 0 : 255;
      raw[o + 2] = red ? 0 : 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

let failed = 0;
async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`PASS  ${name}: ${await fn()}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${(e as Error).message}`);
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.");
    process.exit(1);
  }

  let names: string[] = [];
  await step("list models", async () => {
    const models = await listModels();
    names = models.map((m) => m.name.replace("models/", ""));
    const flash = names.filter((n) => /flash/.test(n) && !/(image|tts|live|audio|thinking|exp)/.test(n));
    const emb = models.filter((m) => m.supportedGenerationMethods?.includes("embedContent")).map((m) => m.name.replace("models/", ""));
    console.log(`      flash-class: ${flash.join(", ") || "none"}`);
    console.log(`      embedding:   ${emb.join(", ") || "none"}`);
    return `${models.length} models`;
  });

  const has = (m: string) => names.length === 0 || names.includes(m);
  if (!has(GEMINI_TEXT_MODEL)) console.log(`WARN  ${GEMINI_TEXT_MODEL} not in the list; update lib/config.ts`);
  if (!has(GEMINI_EMBEDDING_MODEL)) console.log(`WARN  ${GEMINI_EMBEDDING_MODEL} not in the list; update lib/config.ts`);

  await step(`text JSON (${GEMINI_TEXT_MODEL})`, async () => {
    const r = await generateJson<{ capital?: string }>({
      model: GEMINI_TEXT_MODEL,
      prompt: 'Return JSON {"capital": "..."} for the capital of Pakistan.',
    });
    if (!/islamabad/i.test(r.capital ?? "")) throw new Error(`unexpected answer ${JSON.stringify(r)}`);
    return JSON.stringify(r);
  });

  await step(`vision (${GEMINI_VISION_MODEL})`, async () => {
    const t = await generateText({
      model: GEMINI_VISION_MODEL,
      prompt: "What colour is the square in this image? Answer with one word.",
      images: [{ mimeType: "image/png", data: testPng() }],
    });
    if (!/red/i.test(t)) throw new Error(`expected "red", got "${t.trim()}"`);
    return t.trim();
  });

  await step(`embedding (${GEMINI_EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS}d)`, async () => {
    const [v] = await embed(GEMINI_EMBEDDING_MODEL, ["climate change and Pakistan's economy"]);
    if (v?.length !== EMBEDDING_DIMENSIONS) throw new Error(`expected ${EMBEDDING_DIMENSIONS} dims, got ${v?.length}`);
    return `${v.length} dimensions`;
  });

  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
