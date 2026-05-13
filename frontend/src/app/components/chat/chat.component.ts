import { Component, ViewChild, ElementRef, AfterViewChecked, OnInit, Output, EventEmitter } from '@angular/core';
import { ChatService } from '../../services/chat.service';
import { ExportService } from '../../services/export.service';
import { SettingsService, Theme } from '../../services/settings.service';
import { ChatMessage, ChatSession } from '../../models/message.model';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent implements AfterViewChecked, OnInit {
  @ViewChild('messageContainer') messageContainer!: ElementRef;
  @Output() messageSent = new EventEmitter<void>();

  messages: ChatMessage[] = [];
  userInput  = '';
  isLoading  = false;
  thinkMode  = false;

  theme: Theme = 'light';

  // Toast shown when the user switches model
  modelToast: { visible: boolean; model: 'gemini' | 'claude' } = { visible: false, model: 'gemini' };
  private modelToastTimer: any;

  // Generic toast shown for actions like "exported"
  toast: { visible: boolean; kind: 'success' | 'info' | 'error'; title: string; subtitle?: string } = {
    visible: false, kind: 'success', title: '',
  };
  private toastTimer: any;

  readonly modelLabels: Record<'gemini' | 'claude', string> = {
    gemini: 'Gemini 2.5 Flash',
    claude: 'Claude Sonnet',
  };

  isExporting = false;

  // Live status string (kept for compatibility with the message component input)
  streamingStatus = '';

  constructor(
    public chatService: ChatService,
    private exportService: ExportService,
    public settings: SettingsService,
  ) {}

  ngOnInit() {
    // Hydrate from persisted settings
    this.chatService.selectedModel = this.settings.model$.value;
    this.thinkMode = this.settings.thinkMode$.value;
    this.theme = this.settings.theme$.value;
    this.settings.theme$.subscribe(t => this.theme = t);
  }

  toggleTheme() {
    this.settings.toggleTheme();
  }

  onThinkModeChange(value: boolean) {
    this.thinkMode = value;
    this.settings.setThinkMode(value);
  }

  // ── Export current conversation to a Word (.docx) file ───────────
  async exportToWord() {
    const exportable = this.messages.filter(m => !m.isLoading && m.content?.trim());
    if (!exportable.length || this.isExporting) return;
    this.isExporting = true;
    try {
      const filename = await this.exportService.exportConversation(exportable, {
        model: this.chatService.selectedModel,
      });
      this.showToast('success', 'Conversation downloaded', filename || 'Saved as a Word (.docx) file');
    } catch (err) {
      this.showToast('error', 'Export failed', 'Please try again');
    } finally {
      this.isExporting = false;
    }
  }

  onCodeCopied() {
    this.showToast('success', 'Copied to clipboard');
  }

  showToast(kind: 'success' | 'info' | 'error', title: string, subtitle?: string) {
    this.toast = { visible: true, kind, title, subtitle };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = { ...this.toast, visible: false };
    }, 3200);
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  // ── Switch LLM model ─────────────────────────────────────────────
  selectModel(model: 'gemini' | 'claude') {
    if (this.chatService.selectedModel === model) return;
    this.chatService.selectedModel = model;
    this.settings.setModel(model);
    this.newChat();
    this.showModelToast(model);
  }

  private showModelToast(model: 'gemini' | 'claude') {
    this.modelToast = { visible: true, model };
    if (this.modelToastTimer) clearTimeout(this.modelToastTimer);
    this.modelToastTimer = setTimeout(() => {
      this.modelToast = { ...this.modelToast, visible: false };
    }, 2800);
  }

  // ── Start a new chat session ──────────────────────────────────────
  newChat() {
    this.chatService.newSession();
    this.messages = [];
  }

  // ── Load a past session from sidebar ─────────────────────────────
  loadSession(session: ChatSession) {
    this.chatService.sessionId     = session.session_id;
    this.chatService.selectedModel = session.model as 'gemini' | 'claude';
    this.messages = [];  // clear while loading

    this.chatService.loadSession(session.session_id).subscribe({
      next: (res) => {
        this.messages = res.messages
          .filter((m: any) => (m.type === 'human' || m.type === 'ai') && m.content)
          .map((m: any) => ({
            role:      (m.type === 'human' ? 'user' : 'assistant') as 'user' | 'assistant',
            content:   typeof m.content === 'string' ? m.content : String(m.content || ''),
            timestamp: new Date(),
            isLoading: false,
          }))
          .filter((m: any) => m.content.trim().length > 0);  // skip blank messages
      },
      error: () => { this.messages = []; }
    });
  }

  // Active subscription so the user can press "Stop"
  private currentRequest: { unsubscribe: () => void } | null = null;

  // ── Send message ──────────────────────────────────────────────────
  sendMessage() {
    const text = this.userInput.trim();
    if (!text || this.isLoading) return;

    this.messages.push({ role: 'user', content: text, timestamp: new Date() });
    const assistantIndex = this.messages.length;
    this.messages.push({
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    });

    this.userInput = '';
    this.isLoading = true;
    this.streamingStatus = '';

    if (this.thinkMode) {
      this.streamingStatus = '🧠 Thinking deeply...';
    }

    this.currentRequest = this.chatService.sendMessage(text, this.thinkMode).subscribe({
      next: (res) => {
        this.messages[assistantIndex] = {
          role:      'assistant',
          content:   res.response,
          toolsUsed: res.toolsUsed,
          sources:   res.sources,
          followUps: res.followUps,
          usage:     res.usage,
          model:     res.model,
          timestamp: new Date(),
          isLoading: false,
        };
        this.isLoading = false;
        this.streamingStatus = '';
        this.currentRequest = null;
        this.messageSent.emit();
      },
      error: () => {
        this.messages[assistantIndex] = {
          role:      'assistant',
          content:   'Sorry, something went wrong. Please try again.',
          timestamp: new Date(),
          isLoading: false,
        };
        this.isLoading = false;
        this.currentRequest = null;
      },
    });
  }

  /** Aborts the current in-flight request (Stop button). */
  stopGeneration() {
    if (!this.currentRequest) return;
    this.currentRequest.unsubscribe();
    this.currentRequest = null;
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === 'assistant') {
      this.messages[this.messages.length - 1] = {
        ...last,
        content: '_(stopped)_',
        isLoading: false,
      };
    }
    this.streamingStatus = '';
    this.isLoading = false;
  }

  askSuggestion(question: string) {
    this.userInput = question;
    this.sendMessage();
  }

  clearChat() {
    this.newChat();
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom() {
    if (this.messageContainer) {
      const el = this.messageContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }
}
