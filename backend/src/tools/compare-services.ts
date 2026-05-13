import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchDocuments } from "../utils/vector-store";
import { recordSource } from "../utils/request-context";

/**
 * TOOL: compare_services
 *
 * Purpose: Compare two AWS services by retrieving docs for both.
 * When Claude uses this: "X vs Y", "which is better", "difference between".
 */
// @ts-ignore - LangChain deep type inference
export const compareServices = tool(
  async ({ serviceA, serviceB, criteria }) => {
    const query = `${serviceA} vs ${serviceB} ${criteria || "features use cases"}`;

    const [resultsA, resultsB] = await Promise.all([
      searchDocuments(query, 3, { service: serviceA }),
      searchDocuments(query, 3, { service: serviceB }),
    ]);

    [...resultsA, ...resultsB].forEach((r) =>
      recordSource({
        url: r.metadata.source,
        title: r.metadata.title,
        service: r.metadata.service,
      })
    );

    const docsA = resultsA.map((r) => r.text).join("\n") || "No docs found.";
    const docsB = resultsB.map((r) => r.text).join("\n") || "No docs found.";

    return `## ${serviceA}:\n${docsA}\n\n## ${serviceB}:\n${docsB}`;
  },
  {
    name: "compare_services",
    description:
      "Compare two AWS services side by side. Use when the user asks about differences between services or which service to choose.",
    schema: z.object({
      serviceA: z.string().describe("First AWS service name"),
      serviceB: z.string().describe("Second AWS service name"),
      criteria: z.string().optional().describe("Comparison criteria like pricing, scalability, latency"),
    }),
  }
);
