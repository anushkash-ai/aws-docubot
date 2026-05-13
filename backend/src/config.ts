import dotenv from "dotenv";
import path from "path";
dotenv.config();

export const config = {
  // ── LLM Options (user can pick one at runtime) ──────────────────────
  // Google Gemini (free tier — 15 RPM, 1M tokens/day)
  geminiModel: "gemini-2.5-flash",
  googleApiKey: process.env.GOOGLE_API_KEY || "",

  // Anthropic Claude (paid — requires API credits)
  claudeModel: "claude-sonnet-4-5",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  // ── AWS Bedrock — Titan Embeddings V2 (for RAG vector embeddings) ───
  awsRegion: process.env.AWS_REGION || "us-east-1",
  embeddingModel: "amazon.titan-embed-text-v2:0",

  // ── Server ───────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT || "3000", 10),

  // ── Vector Store (local JSON file) ───────────────────────────────────
  vectorStorePath: path.join(__dirname, "..", "data", "vector-store.json"),
  collectionName: "aws_docs",

  // ── RAG settings ─────────────────────────────────────────────────────
  chunkSize: 1000,     // characters per chunk
  chunkOverlap: 200,   // overlap between chunks
  topK: 5,             // number of results to retrieve
};
