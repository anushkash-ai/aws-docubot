import { Component, ViewChild } from '@angular/core';
import { ChatComponent } from './components/chat/chat.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ChatSession } from './models/message.model';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  @ViewChild('chatComponent') chatComponent!: ChatComponent;
  @ViewChild('sidebarComponent') sidebarComponent!: SidebarComponent;

  // Start a new empty chat
  onNewChat() {
    this.chatComponent.newChat();
    setTimeout(() => this.sidebarComponent.refresh(), 300);
  }

  // Load a past session from sidebar click
  onLoadSession(session: ChatSession) {
    this.chatComponent.loadSession(session);
  }

  // Refresh sidebar after a message is sent
  onMessageSent() {
    this.sidebarComponent.refresh();
  }
}
