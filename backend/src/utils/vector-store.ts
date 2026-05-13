import fs from "fs";
import path from "path";
import { config } from "../config";
import { embeddings } from "./embeddings";

/**
 * SIMPLE VECTOR STORE
 *
 * A lightweight vector store that saves embeddings to a local JSON file.
 * No Docker or external database needed.
 *
 * How it works:
 * - Documents are embedded (converted to number arrays) using Bedrock Titan
 * - Stored in a JSON file with their text and metadata
 * - Search uses "cosine similarity" to find the closest matches
 *
 * In production, this would be replaced with:
 * - Amazon OpenSearch Serverless (managed vector search)
 * - or Pinecone / pgvector on RDS
 */

interface StoredDocument {
  text: string;
  embedding: number[];
  metadata: Record<string, string>;
}

interface VectorStoreData {
  documents: StoredDocument[];
}

// ── In-memory cache (loaded once, reused) ───────────────────────────
let cachedStore: VectorStoreData | null = null;

function loadStore(): VectorStoreData {
  if (cachedStore) return cachedStore;

  if (fs.existsSync(config.vectorStorePath)) {
    const raw = fs.readFileSync(config.vectorStorePath, "utf-8");
    cachedStore = JSON.parse(raw);
    return cachedStore!;
  }
  return { documents: [] };
}

function saveStore(data: VectorStoreData): void {
  const dir = path.dirname(config.vectorStorePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(config.vectorStorePath, JSON.stringify(data));
  cachedStore = data;  // Update cache
}

// ── Cosine Similarity ───────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Add documents ───────────────────────────────────────────────────
export async function addDocuments(
  texts: string[],
  metadatas: Record<string, string>[]
): Promise<void> {
  const store = loadStore();
  const vectors = await embeddings.embedDocuments(texts);

  for (let i = 0; i < texts.length; i++) {
    store.documents.push({
      text: texts[i],
      embedding: vectors[i],
      metadata: metadatas[i],
    });
  }
  saveStore(store);
}

// ── Search for similar documents ────────────────────────────────────
export async function searchDocuments(
  query: string,
  topK: number = config.topK,
  filter?: { service: string }
): Promise<{ text: string; metadata: Record<string, string>; score: number }[]> {
  const store = loadStore();

  if (store.documents.length === 0) return [];

  const queryVector = await embeddings.embedQuery(query);

  let results = store.documents.map((doc) => ({
    text: doc.text,
    metadata: doc.metadata,
    score: cosineSimilarity(queryVector, doc.embedding),
  }));

  if (filter?.service) {
    results = results.filter((r) => r.metadata.service === filter.service);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ── Clear store ─────────────────────────────────────────────────────
export function clearStore(): void {
  cachedStore = null;
  saveStore({ documents: [] });
}
