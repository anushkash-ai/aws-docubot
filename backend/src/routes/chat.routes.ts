import { Router, Request, Response } from "express";
import { chat, chatStream } from "../agent/graph";
import { generateFollowUps } from "../agent/followups";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { getSession, getAllSessions, saveSession, deleteSession } from "../utils/database";

const router = Router();

// ── Pricing per 1M tokens (USD) ──────────────────────────────────────
const PRICING: Record<string, { input: number; output: number }> = {
  gemini: { input: 0.15,  output: 0.60  },
  claude: { input: 3.00,  output: 15.00 },
};

function calculateCost(model: string, input: number, output: number): number {
  const p = PRICING[model] || PRICING.gemini;
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

/**
 * contentToString — safely converts LangChain message content to a string.
 * LangChain can return content as a string OR as an array of content blocks.
 */
function contentToString(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
      .join("");
  }
  return String(content || "");
}

// ── Message serialization ─────────────────────────────────────────────
function serializeMessages(messages: BaseMessage[]): any[] {
  return messages.map((m) => ({
    type:         m._getType(),
    content:      contentToString(m.content),   // always store as string
    tool_calls:   (m as any).tool_calls   || [],
    tool_call_id: (m as any).tool_call_id || null,
  }));
}

function deserializeMessages(raw: any[]): BaseMessage[] {
  const { HumanMessage: HM, AIMessage: AIM, ToolMessage } =
    require("@langchain/core/messages");
  return raw.map((r) => {
    if (r.type === "human") return new HM(r.content);
    if (r.type === "tool")
      return new ToolMessage({ content: r.content, tool_call_id: r.tool_call_id || "unknown" });
    const msg = new AIM({ content: r.content });
    if (r.tool_calls?.length) (msg as any).tool_calls = r.tool_calls;
    return msg;
  });
}

/**
 * GET /api/sessions — list all sessions for sidebar
 */
router.get("/sessions", (_req: Request, res: Response) => {
  const sessions = getAllSessions();
  res.json({ sessions });
});

/**
 * GET /api/sessions/:sessionId — load a specific session's messages
 */
router.get("/sessions/:sessionId", (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const raw = getSession(sessionId);
  // Only return human + ai messages (skip internal tool messages)
  const messages = raw
    .filter((m: any) => m.type === "human" || m.type === "ai")
    .map((m: any) => ({
      ...m,
      content: contentToString(m.content),  // ensure string
    }));
  res.json({ messages });
});

/**
 * POST /api/chat
 */
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const { message, sessionId = "default", model = "claude", thinkMode = false } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required." });
    }

    // Load history from SQLite
    const rawHistory = getSession(sessionId);
    const isNewSession = rawHistory.length === 0;
    const history = deserializeMessages(rawHistory);

    // Run LangGraph agent
    const result = await chat(message, history, model, thinkMode);

    // Only use the FIRST user message as the session title
    // For subsequent messages, keep the existing title
    const title = isNewSession
      ? (message.length > 50 ? message.substring(0, 50) + "…" : message)
      : undefined;  // undefined = keep existing title in DB

    // Save to SQLite
    saveSession(sessionId, title, serializeMessages(result.messages), model);

    // Extract final AI response
    const allAiMessages = result.messages.filter(
      (m: BaseMessage) => m instanceof AIMessage
    ) as AIMessage[];

    const finalResponse = allAiMessages
      .filter(m => !m.tool_calls || m.tool_calls.length === 0)
      .at(-1);

    const toolsUsed = allAiMessages
      .filter(m => m.tool_calls?.length)
      .flatMap(m => m.tool_calls || [])
      .map(tc => ({ tool: tc.name, input: tc.args }));

    // Token usage
    let inputTokens = 0, outputTokens = 0;
    for (const msg of allAiMessages) {
      const usage = (msg as any).usage_metadata;
      if (usage) {
        inputTokens  += usage.input_tokens  || 0;
        outputTokens += usage.output_tokens || 0;
      }
    }

    // Generate follow-up question chips (best-effort, never fails the request)
    const responseText = contentToString(finalResponse?.content) || "I could not generate a response.";
    const followUps = await generateFollowUps(message, responseText, model);

    res.json({
      response:  responseText,
      toolsUsed,
      sources:   result.sources,
      followUps,
      sessionId,
      model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: calculateCost(model, inputTokens, outputTokens),
      },
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to process message." });
  }
});

/**
 * POST /api/chat/stream — Server-Sent Events streaming chat.
 *
 * Emits a sequence of `data: {...}\n\n` JSON event lines:
 *   { type: 'status',  stage: '...' }
 *   { type: 'tool',    tool: '...', input: {...} }
 *   { type: 'sources', sources: [...] }
 *   { type: 'token',   delta: '...' }
 *   { type: 'final',   followUps: [...], usage: {...} }
 *   { type: 'error',   message: '...' }
 */
router.post("/chat/stream", async (req: Request, res: Response) => {
  const { message, sessionId = "default", model = "claude" } = req.body || {};

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required." });
    return;
  }

  // SSE-style headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Ensure the response is flushed immediately
  (res as any).flushHeaders?.();

  const send = (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Detect client disconnect to abort the LangGraph stream early
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  let assembled = "";
  const collectedToolCalls: Array<{ tool: string; input: Record<string, any> }> = [];
  let collectedSources: any[] = [];

  try {
    const rawHistory = getSession(sessionId);
    const isNewSession = rawHistory.length === 0;
    const history = deserializeMessages(rawHistory);

    const stream = chatStream(message, history, model, abort.signal);

    for await (const evt of stream) {
      if (abort.signal.aborted) break;

      if (evt.type === "token") {
        assembled += evt.delta;
        send({ type: "token", delta: evt.delta });
      } else if (evt.type === "tool") {
        collectedToolCalls.push({ tool: evt.tool, input: evt.input });
        send(evt);
      } else if (evt.type === "sources") {
        collectedSources = evt.sources;
        send(evt);
      } else if (evt.type === "status") {
        send(evt);
      } else if (evt.type === "error") {
        send(evt);
        res.end();
        return;
      } else if (evt.type === "done") {
        // We finalize below outside the loop using `assembled`.
        collectedSources = evt.sources;
      }
    }

    if (abort.signal.aborted) {
      res.end();
      return;
    }

    // Generate follow-ups now that we have the full reply
    const followUps = await generateFollowUps(message, assembled, model);

    // Persist the new turn to SQLite (mirrors the non-streaming endpoint)
    try {
      const persistedMessages = [
        ...history,
        new HumanMessage(message),
        new AIMessage({ content: assembled }),
      ];
      const title = isNewSession
        ? (message.length > 50 ? message.substring(0, 50) + "…" : message)
        : undefined;
      saveSession(sessionId, title, serializeMessages(persistedMessages), model);
    } catch (persistErr) {
      console.error("Failed to persist streaming session:", persistErr);
    }

    send({
      type: "final",
      followUps,
      sessionId,
      model,
      toolsUsed: collectedToolCalls,
      sources: collectedSources,
    });
    res.end();
  } catch (err: any) {
    console.error("Stream error:", err);
    if (!res.writableEnded) {
      send({ type: "error", message: "Streaming failed" });
      res.end();
    }
  }
});

/**
 * POST /api/sessions/clear
 */
router.post("/sessions/clear", (req: Request, res: Response) => {
  const { sessionId = "default" } = req.body;
  deleteSession(sessionId);
  res.json({ success: true });
});

export default router;
