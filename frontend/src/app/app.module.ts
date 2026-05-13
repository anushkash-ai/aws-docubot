import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ChatComponent } from './components/chat/chat.component';
import { MessageComponent } from './components/message/message.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { MarkdownPipe } from './pipes/markdown.pipe';

@NgModule({
  declarations: [
    AppComponent,
    ChatComponent,
    MessageComponent,
    SidebarComponent,
    MarkdownPipe
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,   // For API calls to backend
    FormsModule         // For ngModel two-way binding
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
