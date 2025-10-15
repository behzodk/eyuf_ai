// ingest-pdf.mjs
// ESM-friendly PDF ingestion using `unpdf` + OpenAI + Supabase
// deps: npm i dotenv unpdf openai @supabase/supabase-js

import * as dotenv from "dotenv";
dotenv.config();

import fs from "node:fs/promises";
import path from "node:path";
import { extractText } from "unpdf";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// ---------- Config ----------
const PDF_PATH = "./Basic Profile.pdf";           // put your PDF in project root or adjust the path
const DOC_PATH_LABEL = path.basename(PDF_PATH);   // used in citations
const CHUNK = 1200;
const OVERLAP = 200;

// ---------- Env guard ----------
function need(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

const openai = new OpenAI({ apiKey: need("OPENAI_API_KEY") });
const supabase = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE"));

// ---------- Helpers ----------
function chunkText(str, size = CHUNK, overlap = OVERLAP) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size - overlap) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

async function readPdfAsText(filePath) {
  const buf = await fs.readFile(filePath); // Buffer
  // unpdf/pdf.js want a Uint8Array, not Buffer
  const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const { text } = await extractText(uint8, { mergePages: true });
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Main ----------
async function run() {
  console.log("Reading PDF:", PDF_PATH);
  const fullText = await readPdfAsText(PDF_PATH);
  if (!fullText) throw new Error("PDF text was empty — check the file path or PDF content.");

  const chunks = chunkText(fullText);
  console.log(`Embedding ${chunks.length} chunk(s)…`);

  for (let i = 0; i < chunks.length; i++) {
    const input = chunks[i];

    const { data } = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input
    });
    const vector = data[0].embedding;

    const { error } = await supabase.from("docs").insert({
      path: DOC_PATH_LABEL,
      chunk_index: i,
      content: input,
      embedding: vector
    });
    if (error) {
      console.error(`Supabase insert failed on chunk ${i}:`, error);
      process.exit(1);
    }
    console.log(`Inserted chunk ${i + 1}/${chunks.length}`);
  }

  console.log("Done.");
}

run().catch((e) => {
  console.error("Error during ingestion:", e);
  process.exit(1);
});
