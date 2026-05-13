import { config } from "../config";
import { addDocuments, clearStore } from "../utils/vector-store";

/**
 * INGESTION PIPELINE
 *
 * This script does 4 things:
 * 1. Fetches AWS documentation pages (HTML)
 * 2. Extracts clean text from them
 * 3. Splits text into small chunks (for better search accuracy)
 * 4. Embeds chunks using Titan Embeddings and stores locally
 *
 * Run once: npm run ingest
 */

// ── AWS Documentation URLs ──────────────────────────────────────────
const AWS_DOCS: { service: string; url: string; title: string }[] = [
  // Lambda
  { service: "Lambda", title: "What is Lambda", url: "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html" },
  { service: "Lambda", title: "Getting Started", url: "https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html" },
  { service: "Lambda", title: "Lambda Functions", url: "https://docs.aws.amazon.com/lambda/latest/dg/lambda-functions.html" },
  // S3
  { service: "S3", title: "What is S3", url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html" },
  { service: "S3", title: "Getting Started", url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/GetStartedWithS3.html" },
  // Bedrock
  { service: "Bedrock", title: "What is Bedrock", url: "https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html" },
  { service: "Bedrock", title: "Getting Started", url: "https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started.html" },
  // SQS
  { service: "SQS", title: "What is SQS", url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html" },
  // Step Functions
  { service: "StepFunctions", title: "What is Step Functions", url: "https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html" },
];

// ── Step 1: Fetch a web page and extract text ───────────────────────
async function fetchPageText(url: string): Promise<string> {
  console.log(`  Fetching: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();

  // Simple HTML to text: remove tags, scripts, styles
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

// ── Step 2: Split text into chunks ──────────────────────────────────
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + config.chunkSize, text.length);
    const chunk = text.slice(start, end).trim();

    if (chunk.length > 50) {
      chunks.push(chunk);
    }
    start += config.chunkSize - config.chunkOverlap;
  }

  return chunks;
}

// ── Step 3: Embed and store ─────────────────────────────────────────
async function ingest() {
  console.log("=== AWS Documentation Ingestion Pipeline ===\n");

  // Clear old data
  clearStore();
  console.log("Cleared old data.\n");

  let totalChunks = 0;

  for (const doc of AWS_DOCS) {
    try {
      const text = await fetchPageText(doc.url);
      const chunks = chunkText(text);
      console.log(`  > ${doc.service} - ${doc.title}: ${chunks.length} chunks`);

      // Embed and store chunks (in batches of 10 to avoid rate limits)
      for (let i = 0; i < chunks.length; i += 10) {
        const batch = chunks.slice(i, i + 10);
        const metadatas = batch.map(() => ({
          service: doc.service,
          title: doc.title,
          source: doc.url,
        }));
        await addDocuments(batch, metadatas);
      }

      totalChunks += chunks.length;
    } catch (err) {
      console.log(`  X Failed: ${doc.title} - ${(err as Error).message}`);
    }
  }

  console.log(`\n=== Done! Ingested ${totalChunks} chunks from ${AWS_DOCS.length} pages ===`);
}

ingest().catch(console.error);
