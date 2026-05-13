import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchDocuments } from "../utils/vector-store";
import { recordSource } from "../utils/request-context";

/**
 * TOOL: suggest_service
 *
 * Purpose: Recommend the best AWS service for a given use case.
 * When Claude uses this: When the user describes a problem without naming specific services.
 */
// @ts-ignore - LangChain deep type inference
export const suggestService = tool(
  async ({ useCase, requirements }) => {
    const query = `${useCase} ${requirements || ""}`;

    // Search across ALL services (no filter)
    const results = await searchDocuments(query, 8);

    if (results.length === 0) {
      return "No relevant services found for this use case.";
    }

    results.forEach((r) =>
      recordSource({
        url: r.metadata.source,
        title: r.metadata.title,
        service: r.metadata.service,
      })
    );

    // Group results by service to show which service appears most
    const serviceHits: Record<string, { count: number; sample: string }> = {};
    results.forEach((r) => {
      const svc = r.metadata.service;
      if (!serviceHits[svc]) {
        serviceHits[svc] = { count: 0, sample: r.text.slice(0, 500) };
      }
      serviceHits[svc].count++;
    });

    const sorted = Object.entries(serviceHits).sort((a, b) => b[1].count - a[1].count);
    const formatted = sorted
      .map(([svc, data]) => `## ${svc} (${data.count} relevant matches)\n${data.sample}`)
      .join("\n\n---\n\n");

    return `Use case: ${useCase}\n\n${formatted}`;
  },
  {
    name: "suggest_service",
    description:
      "Suggest the best AWS service for a use case. Use when the user describes a problem without naming specific services.",
    schema: z.object({
      useCase: z.string().describe("Description of what the user wants to achieve"),
      requirements: z.string().optional().describe("Specific requirements like scale, budget, latency"),
    }),
  }
);
