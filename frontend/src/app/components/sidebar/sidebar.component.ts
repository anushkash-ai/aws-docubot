import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { ChatService } from '../../services/chat.service';
import { ChatSession } from '../../models/message.model';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  @Output() newChat       = new EventEmitter<void>();
  @Output() loadSession   = new EventEmitter<ChatSession>();

  sessions: ChatSession[] = [];
  showAbout = false;

  // AWS services indexed in our vector database
  services = [
    { name: 'Lambda',         icon: 'λ',   color: '#fbbf24', iconColor: '#111827' },
    { name: 'S3',             icon: 'S3',  color: '#22c55e' },
    { name: 'Bedrock',        icon: 'BR',  color: '#8b5cf6' },
    { name: 'SQS',            icon: 'SQS', color: '#f97316' },
    { name: 'Step Functions', icon: 'SF',  color: '#3b82f6' },
  ];

  constructor(public chatService: ChatService) {}

  ngOnInit() {
    this.loadSessions();
  }

  // Load sessions from backend
  loadSessions() {
    this.chatService.getSessions().subscribe({
      next: (res) => this.sessions = res.sessions,
      error: () => this.sessions = []
    });
  }

  // Called by parent after a new chat is sent
  refresh() {
    this.loadSessions();
  }

  onNewChat() {
    this.newChat.emit();
  }

  onLoadSession(session: ChatSession) {
    this.loadSession.emit(session);
  }

  // Show model badge label
  getModelLabel(model: string): string {
    return model === 'claude' ? 'Claude' : 'Gemini';
  }

  // Format relative time
  getRelativeTime(dateStr: string): string {
    // SQLite CURRENT_TIMESTAMP is UTC — append 'Z' so JS parses it correctly
    const utcStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
    const date   = new Date(utcStr);
    const now    = new Date();
    const diff   = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}
