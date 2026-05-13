// TypeScript interfaces for the chat application

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: ToolCall[];
  sources?: SourceRef[];
  followUps?: string[];
  usage?: TokenUsage;
  model?: string;
  timestamp: Date;
  isLoading?: boolean;
}

export interface ToolCall {
  tool: string;
  input: Record<string, any>;
}

export interface SourceRef {
  url: string;
  title: string;
  service: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ChatResponse {
  response: string;
  toolsUsed: ToolCall[];
  sources?: SourceRef[];
  followUps?: string[];
  sessionId: string;
  model: string;
  usage?: TokenUsage;
}

export interface ChatSession {
  session_id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}
