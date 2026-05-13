import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

/**
 * AGENT STATE
 *
 * This defines what data flows through the LangGraph agent.
 * Think of it as the "memory" of a single conversation turn.
 *
 * messages: The full conversation history — user messages, AI responses,
 *           tool calls, and tool results. LangGraph uses a "reducer"
 *           to append new messages to existing ones (not replace).
 */
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // Reducer: new messages get APPENDED to existing messages
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});
