import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { ChatMessage } from '../../models/message.model';

@Component({
  selector: 'app-message',
  templateUrl: './message.component.html',
  styleUrls: ['./message.component.scss']
})
export class MessageComponent implements OnChanges, OnDestroy {
  @Input() message!: ChatMessage;
  @Input() liveStatus = '';
  @Output() codeCopied = new EventEmitter<void>();
  @Output() followUpClicked = new EventEmitter<string>();

  showTools = false;

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  // Event-delegated handler for the per-codeblock "Copy" button
  // (the button is rendered as raw HTML by the markdown pipe).
  onContentClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest('button[data-copy-code]') as HTMLButtonElement | null;
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const encoded = btn.getAttribute('data-copy-code') || '';
    let code = '';
    try { code = decodeURIComponent(encoded); } catch { code = encoded; }
    this.copyToClipboard(code).then(() => {
      const label = btn.querySelector('.code-block-copy-label');
      if (label) {
        const original = label.textContent || 'Copy';
        label.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          label.textContent = original;
          btn.classList.remove('copied');
        }, 1500);
      }
      this.codeCopied.emit();
    });
  }

  private async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  }

  // Rotating status messages shown while the assistant is generating a reply.
  // They cycle every ~2.2s so the user gets a sense of progress.
  readonly loadingStages: string[] = [
    'Reading your question',
    'Searching AWS documentation',
    'Analyzing relevant services',
    'Reasoning through the answer',
    'Composing the response',
  ];

  readonly thinkingStages: string[] = [
    '🧠 Breaking down the question',
    '🔍 Searching AWS documentation',
    '⚙️ Reasoning step by step',
    '🔗 Connecting concepts',
    '✍️ Composing detailed response',
  ];
  loadingStageIndex = 0;
  private loadingTimer: any;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['message']) {
      if (this.message?.isLoading) {
        this.startLoadingRotation();
      } else {
        this.stopLoadingRotation();
      }
    }
  }

  ngOnDestroy() {
    this.stopLoadingRotation();
  }

  get activeStages(): string[] {
    return this.liveStatus?.startsWith('🧠') ? this.thinkingStages : this.loadingStages;
  }

  private startLoadingRotation() {
    this.stopLoadingRotation();
    this.loadingStageIndex = 0;
    this.loadingTimer = setInterval(() => {
      if (this.loadingStageIndex < this.activeStages.length - 1) {
        this.loadingStageIndex++;
      }
    }, 2200);
  }

  private stopLoadingRotation() {
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
  }

  toggleTools() {
    this.showTools = !this.showTools;
  }

  getToolDisplayName(toolName: string): string {
    const names: Record<string, string> = {
      search_aws_docs: 'Searched AWS Docs',
      compare_services: 'Compared Services',
      suggest_service: 'Suggested Service'
    };
    return names[toolName] || toolName;
  }
}
