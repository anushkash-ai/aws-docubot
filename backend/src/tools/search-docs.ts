import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchDocuments } from "../utils/vector-store";
import { recordSource } from "../utils/request-context";

/**
 * TOOL: search_aws_docs
 *
 * Purpose: Search the AWS documentation vector store.
 * How it works:
 *   1. Takes the user's query
 *   2. Converts it to an embedding vector (using Titan)
 *   3. Finds the most similar document chunks
 *   4. Returns the matching text with source URLs
 *
 * When Claude uses this: When the user asks about any AWS service.
 */
// @ts-ignore - LangChain deep type inference
export const searchAwsDocs = tool(
  async ({ query, service }) => {
    const results = await searchDocuments(
      query,
      5,
      service ? { service } : undefined
    );

    if (results.length === 0) {
      return "No relevant AWS documentation found for this query.";
    }

    results.forEach((r) =>
      recordSource({
        url: r.metadata.source,
        title: r.metadata.title,
        service: r.metadata.service,
      })
    );

    const formatted = results.map(
      (r) => `[${r.metadata.service} - ${r.metadata.title}](${r.metadata.source})\n${r.text}`
    );

    return formatted.join("\n\n---\n\n");
  },
  {
    name: "search_aws_docs",
    description:
      "Search the AWS documentation knowledge base using semantic search. Use this when users ask about specific AWS services, features, configurations, or best practices.",
    schema: z.object({
      query: z.string().describe("The search query about AWS services"),
      service: z
        .string()
        .optional()
        .describe("Optional: filter by service name (Lambda, S3, Bedrock, SQS, StepFunctions)"),
    }),
  }
);
