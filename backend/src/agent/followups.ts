import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { config } from "../config";

/**
 * Ask the LLM to suggest 3 short follow-up questions the user might want to
 * ask next. Returns an array of strings (max 3). Best-effort: if anything
 * fails, returns []. No tool calls — just a single fast LLM call.
 */

const FOLLOWUP_SYSTEM = `You generate concise follow-up questions a user might ask
after reading the assistant's reply about AWS services.

Rules:
- Output EXACTLY a JSON array of 3 short questions, no preamble, no code fences.
- Each question must be under 70 characters.
- Phrase from the user's perspective (first person), e.g. "How do I…", "What about…", "Compare … to …".
- Stay on topic with the most recent reply.
- Do NOT repeat questions the user already asked.
- If you cannot suggest meaningful follow-ups, return [].`;

function makeModel(modelChoice: string) {
  if (modelChoice === "claude") {
    return new ChatAnthropic({
      model: config.claudeModel,
      apiKey: config.anthropicApiKey,
      temperature: 0.4,
      maxTokens: 256,
    });
  }
  return new ChatGoogleGenerativeAI({
    model: config.geminiModel,
    apiKey: config.googleApiKey,
    temperature: 0.4,
    maxOutputTokens: 256,
  });
}

function contentToString(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
      .join("");
  }
  return String(content || "");
}

export async function generateFollowUps(
  userMessage: string,
  assistantReply: string,
  modelChoice: string = "gemini"
): Promise<string[]> {
  if (!assistantReply?.trim()) return [];

  try {
    const model = makeModel(modelChoice);
    const prompt: BaseMessage[] = [
      new SystemMessage(FOLLOWUP_SYSTEM),
      new HumanMessage(
        `User asked:\n"""${userMessage}"""\n\n` +
        `Assistant answered:\n"""${assistantReply.slice(0, 4000)}"""\n\n` +
        `Suggest 3 follow-up questions as a JSON array.`
      ),
    ];

    const res = (await model.invoke(prompt)) as AIMessage;
    const text = contentToString(res.content).trim();

    // Strip optional markdown fences and extract the first JSON array.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && q.length <= 140)
      .slice(0, 3);
  } catch {
    return [];
  }
}
