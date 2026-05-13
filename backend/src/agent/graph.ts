import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { AgentState } from "./state";
import { SYSTEM_PROMPT, THINK_PROMPT } from "./prompts";
import { searchAwsDocs, compareServices, suggestService } from "../tools";
import { config } from "../config";
import { withRequestContext, getCollectedSources, SourceRef } from "../utils/request-context";

/**
 * LANGGRAPH AGENT
 *
 * This is the core of the application. It creates a "state graph" with:
 *
 *   ┌──────────┐     tool call?     ┌──────────┐
 *   │  AGENT   │ ──── YES ────────→ │  TOOLS   │
 *   │  (LLM)   │                     │ (execute) │
 *   └────┬─────┘ ←──────────────── └──────────┘
 *        │
 *        NO (done)
 *        │
 *       END → return response
 *
 * The user can choose the LLM at runtime:
 *   - "gemini"  → Google Gemini 2.5 Flash (free tier)
 *   - "claude"  → Anthropic Claude Sonnet (paid)
 */

// ── Step 1: Define the tools ────────────────────────────────────────
const tools = [searchAwsDocs, compareServices, suggestService];

// ── Step 2: Create the Tool Node ────────────────────────────────────
// ToolNode automatically executes whatever tool the LLM asks for
// @ts-ignore - LangChain deep type inference
const toolNode = new ToolNode(tools);

/**
 * createModel — builds the LLM based on user's choice
 *   "gemini" → Google Gemini 2.5 Flash (free tier, no credit card)
 *   "claude" → Anthropic Claude Sonnet (requires API credits)
 */
function createModel(modelChoice: string) {
  if (modelChoice === "claude") {
    return new ChatAnthropic({
      model: config.claudeModel,          // claude-sonnet-4-5
      apiKey: config.anthropicApiKey,
      temperature: 0,
      maxTokens: 4096,
    }).bindTools(tools);
  }

  // Default: Gemini free tier
  return new ChatGoogleGenerativeAI({
    model: config.geminiModel,            // gemini-2.5-flash
    apiKey: config.googleApiKey,
    temperature: 0,
    maxOutputTokens: 4096,
  }).bindTools(tools);
}

// ── Step 3: Build a fresh graph for each request ────────────────────
// We build a new graph per request so the model choice is applied correctly
function buildGraph(modelChoice: string, thinkMode = false) {
  const model = createModel(modelChoice);

  // Agent node — LLM reads messages and decides what to do
  async function agentNode(state: typeof AgentState.State) {
    const prompt = thinkMode ? THINK_PROMPT : SYSTEM_PROMPT;
    const systemMessage = new SystemMessage(prompt);
    const response = await model.invoke([systemMessage, ...state.messages]);
    return { messages: [response] };
  }

  // Routing — did the LLM call a tool, or give a final answer?
  function shouldContinue(state: typeof AgentState.State): "tools" | typeof END {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return "tools";   // LLM wants to use a tool → go to tools node
    }
    return END;         // LLM gave a final answer → stop
  }

  // Build & compile the StateGraph
  return new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      [END]: END,
    })
    .addEdge("tools", "agent")
    .compile();
}

// ── Step 4: Run a chat turn with the selected model ─────────────────
export interface ChatTurnResult {
  messages: BaseMessage[];
  sources: SourceRef[];
}

export async function chat(
  userMessage: string,
  history: BaseMessage[] = [],
  modelChoice: string = "gemini",
  thinkMode: boolean = false
): Promise<ChatTurnResult> {
  const graph = buildGraph(modelChoice, thinkMode);
  return withRequestContext(async () => {
    const result = await graph.invoke({
      messages: [...history, new HumanMessage(userMessage)],
    });
    return { messages: result.messages, sources: getCollectedSources() };
  });
}

// ── Step 5: Streaming chat turn ──────────────────────────────────────
export type StreamEvent =
  | { type: "status";  stage: string }
  | { type: "tool";    tool: string; input: Record<string, any> }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "token";   delta: string }
  | { type: "done";    messages: BaseMessage[]; sources: SourceRef[] }
  | { type: "error";   message: string };

/**
 * Stream a chat turn as an async iterable of StreamEvents. The route
 * handler converts each event into a `data: {...}\n\n` SSE chunk.
 */
export async function* chatStream(
  userMessage: string,
  history: BaseMessage[] = [],
  modelChoice: string = "gemini",
  abortSignal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const graph = buildGraph(modelChoice);

  // We need to share the AsyncLocalStorage scope across the whole streaming
  // turn, but `withRequestContext` returns a Promise. We bridge by buffering
  // events through a queue and yielding them out of the generator.
  const queue: StreamEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  let pumpError: any = null;

  const wake = () => {
    if (resolveNext) { const fn = resolveNext; resolveNext = null; fn(); }
  };
  const push = (e: StreamEvent) => { queue.push(e); wake(); };

  const lastSentSources = new Set<string>();
  const emitSourcesIfNew = () => {
    const collected = getCollectedSources();
    const fresh = collected.filter(s => !lastSentSources.has(s.url));
    if (fresh.length) {
      fresh.forEach(s => lastSentSources.add(s.url));
      push({ type: "sources", sources: collected });
    }
  };

  const seenToolCallIds = new Set<string>();

  const pump = withRequestContext(async () => {
    try {
      push({ type: "status", stage: "Reading your question" });

      const stream = await graph.stream(
        { messages: [...history, new HumanMessage(userMessage)] },
        { streamMode: ["messages", "updates"] as any },
      );

      for await (const evt of stream as any) {
        if (abortSignal?.aborted) throw new Error("aborted");

        // streamMode: ['messages', 'updates'] yields tuples: [mode, payload]
        const [mode, payload] = Array.isArray(evt) ? evt : ["unknown", evt];

        if (mode === "messages") {
          // payload = [messageChunk, metadata]
          const [chunk] = Array.isArray(payload) ? payload : [payload];
          if (!chunk) continue;

          // Tool-call chunks → emit "tool" once per call id
          const tcChunks: any[] = (chunk as any).tool_call_chunks || [];
          for (const tc of tcChunks) {
            if (tc.id && !seenToolCallIds.has(tc.id) && tc.name) {
              seenToolCallIds.add(tc.id);
              push({ type: "tool", tool: tc.name, input: {} });
              push({ type: "status", stage: `Using ${friendly(tc.name)}` });
            }
          }

          // Streaming text content → emit token delta
          const content = (chunk as any).content;
          if (content) {
            const text = contentChunkToText(content);
            // Skip empty whitespace-only deltas to keep the stream tidy
            if (text) push({ type: "token", delta: text });
          }
        } else if (mode === "updates") {
          // payload looks like { nodeName: { messages: [...] } }
          if (payload && typeof payload === "object") {
            const nodes = Object.keys(payload);
            if (nodes.includes("tools")) {
              // A tool just finished — surface any new sources collected.
              emitSourcesIfNew();
              push({ type: "status", stage: "Composing the response" });
            } else if (nodes.includes("agent")) {
              // The agent node just produced a message
              emitSourcesIfNew();
            }
          }
        }
      }

      emitSourcesIfNew();
      // Final state: re-run a no-op invoke to grab full message history?
      // Simpler: caller doesn't need full messages here; we ship sources via 'done'.
      push({
        type: "done",
        messages: [],            // route handler doesn't currently use this
        sources: getCollectedSources(),
      });
    } catch (err: any) {
      pumpError = err;
      push({
        type: "error",
        message: err?.message === "aborted" ? "aborted" : "Streaming failed",
      });
    } finally {
      done = true;
      wake();
    }
  });

  // Bridge the buffered queue to the consumer
  while (true) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    if (done) break;
    await new Promise<void>((r) => { resolveNext = r; });
  }

  // Surface any error after the queue drains (already pushed as 'error' above)
  await pump;
  if (pumpError && pumpError.message !== "aborted") {
    // already emitted 'error'; nothing else to do
  }
}

function friendly(toolName: string): string {
  switch (toolName) {
    case "search_aws_docs":   return "AWS Docs Search";
    case "compare_services":  return "Service Comparison";
    case "suggest_service":   return "Service Recommender";
    default: return toolName;
  }
}

function contentChunkToText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
      .join("");
  }
  return "";
}
