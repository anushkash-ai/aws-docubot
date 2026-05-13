import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ChatResponse, ChatSession, SourceRef, ToolCall, TokenUsage } from '../models/message.model';

export type StreamEvent =
  | { type: 'status';  stage: string }
  | { type: 'tool';    tool: string; input: Record<string, any> }
  | { type: 'sources'; sources: SourceRef[] }
  | { type: 'token';   delta: string }
  | { type: 'final';   followUps: string[]; sessionId: string; model: string; toolsUsed: ToolCall[]; sources: SourceRef[]; usage?: TokenUsage }
  | { type: 'error';   message: string };

export interface StreamHandle {
  /** Aborts the streaming request */
  abort(): void;
  /** Resolves when the stream completes (success or error) */
  done: Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private apiUrl = 'http://localhost:3000/api';

  // Current active session ID
  sessionId = 'session-' + Date.now();

  // Active model choice
  selectedModel: 'gemini' | 'claude' = 'claude';

  constructor(private http: HttpClient) {}

  // Send a message to the agent (non-streaming, kept for fallback/back-compat)
  sendMessage(message: string, thinkMode = false): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.apiUrl}/chat`, {
      message,
      sessionId: this.sessionId,
      model: this.selectedModel,
      thinkMode,
    });
  }

  /**
   * Stream a chat reply via the SSE-style /chat/stream endpoint.
   * Calls `onEvent` for each parsed event. Returns a handle the caller
   * can use to abort the stream (e.g. when the user clicks "Stop").
   */
  sendMessageStream(message: string, onEvent: (e: StreamEvent) => void): StreamHandle {
    const controller = new AbortController();

    const done = (async () => {
      try {
        const res = await fetch(`${this.apiUrl}/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify({
            message,
            sessionId: this.sessionId,
            model: this.selectedModel,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onEvent({ type: 'error', message: `Stream HTTP ${res.status}` });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) break;
          buffer += decoder.decode(value, { stream: true });

          // Split on the SSE event delimiter (\n\n)
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = rawEvent
              .split('\n')
              .find(l => l.startsWith('data:'));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json) continue;
            try {
              const evt = JSON.parse(json) as StreamEvent;
              onEvent(evt);
            } catch {
              // ignore malformed event
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // user-initiated stop
        onEvent({ type: 'error', message: err?.message || 'Network error' });
      }
    })();

    return {
      abort: () => controller.abort(),
      done,
    };
  }

  // Get all sessions for sidebar history
  getSessions(): Observable<{ sessions: ChatSession[] }> {
    return this.http.get<{ sessions: ChatSession[] }>(`${this.apiUrl}/sessions`);
  }

  // Load messages of a specific session
  loadSession(sessionId: string): Observable<{ messages: any[] }> {
    return this.http.get<{ messages: any[] }>(`${this.apiUrl}/sessions/${sessionId}`);
  }

  // Start a brand new session
  newSession(): void {
    this.sessionId = 'session-' + Date.now();
  }

  // Clear a session from DB
  clearSession(sessionId?: string): Observable<any> {
    const id = sessionId || this.sessionId;
    return this.http.post(`${this.apiUrl}/sessions/clear`, { sessionId: id });
  }
}
