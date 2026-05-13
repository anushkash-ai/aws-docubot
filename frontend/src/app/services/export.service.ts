import { Injectable } from '@angular/core';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ShadingType,
  BorderStyle,
} from 'docx';
import { ChatMessage } from '../models/message.model';

@Injectable({ providedIn: 'root' })
export class ExportService {
  /**
   * Build a Word document from the current conversation and trigger a download.
   * Markdown formatting in assistant replies (bold, headings, bullet lists, inline code,
   * code fences) is preserved best-effort.
   */
  async exportConversation(
    messages: ChatMessage[],
    options: { model?: string } = {}
  ): Promise<string> {
    if (!messages.length) return '';

    const children: Paragraph[] = [];

    // ── Document title ────────────────────────────────────────────────
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: 'AWS DocuBot Conversation',
            bold: true,
            size: 36,
            color: '111827',
          }),
        ],
      })
    );

    const subtitleParts: string[] = [
      new Date().toLocaleString(),
    ];
    if (options.model) {
      subtitleParts.push(
        `Model: ${options.model === 'gemini' ? 'Gemini 2.5 Flash' : 'Claude Sonnet'}`
      );
    }
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
        children: [
          new TextRun({
            text: subtitleParts.join('   •   '),
            italics: true,
            size: 20,
            color: '6b7280',
          }),
        ],
      })
    );

    // ── Each message ──────────────────────────────────────────────────
    for (const msg of messages) {
      if (msg.isLoading || !msg.content?.trim()) continue;

      children.push(this.roleHeading(msg));
      children.push(...this.renderMarkdownAsParagraphs(msg.content));

      if (msg.role === 'assistant' && msg.usage && msg.usage.totalTokens > 0) {
        children.push(
          new Paragraph({
            spacing: { before: 60, after: 240 },
            children: [
              new TextRun({
                text: `Tokens: ${msg.usage.totalTokens.toLocaleString()} ` +
                      `(in ${msg.usage.inputTokens.toLocaleString()}, ` +
                      `out ${msg.usage.outputTokens.toLocaleString()})  •  ` +
                      `~$${msg.usage.estimatedCostUsd.toFixed(6)}`,
                italics: true,
                size: 16,
                color: '9ca3af',
              }),
            ],
          })
        );
      } else {
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
      }
    }

    const doc = new Document({
      creator: 'AWS DocuBot',
      title: 'AWS DocuBot Conversation',
      styles: {
        default: {
          document: {
            run: { font: 'Calibri', size: 22 },
          },
        },
      },
      sections: [{ children }],
    });

    const blob = await Packer.toBlob(doc);
    const filename = this.buildFilename();
    this.triggerDownload(blob, filename);
    return filename;
  }

  // ── Per-message role banner ─────────────────────────────────────────
  private roleHeading(msg: ChatMessage): Paragraph {
    const isUser = msg.role === 'user';
    return new Paragraph({
      spacing: { before: 120, after: 80 },
      shading: {
        type: ShadingType.SOLID,
        color: isUser ? '1a2421' : 'eef9f3',
        fill: isUser ? '1a2421' : 'eef9f3',
      },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 18,
          color: isUser ? '111827' : '6ee7b7',
          space: 6,
        },
      },
      children: [
        new TextRun({
          text: isUser ? 'YOU' : 'AWS DOCUBOT',
          bold: true,
          size: 18,
          color: isUser ? 'ffffff' : '0f5132',
        }),
        new TextRun({
          text: `   ${msg.timestamp instanceof Date
            ? msg.timestamp.toLocaleTimeString()
            : new Date(msg.timestamp).toLocaleTimeString()}`,
          size: 16,
          color: isUser ? 'cbd5e1' : '6b7280',
        }),
      ],
    });
  }

  // ── Minimal markdown → docx Paragraph[] ─────────────────────────────
  private renderMarkdownAsParagraphs(markdown: string): Paragraph[] {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const paragraphs: Paragraph[] = [];
    let inCodeFence = false;
    let codeBuffer: string[] = [];

    const flushCode = () => {
      if (!codeBuffer.length) return;
      paragraphs.push(
        new Paragraph({
          spacing: { before: 80, after: 120 },
          shading: { type: ShadingType.SOLID, color: 'f7f8fa', fill: 'f7f8fa' },
          children: [
            new TextRun({
              text: codeBuffer.join('\n'),
              font: 'Consolas',
              size: 18,
              color: '3a3a52',
            }),
          ],
        })
      );
      codeBuffer = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      if (line.trim().startsWith('```')) {
        if (inCodeFence) {
          flushCode();
          inCodeFence = false;
        } else {
          inCodeFence = true;
        }
        continue;
      }
      if (inCodeFence) {
        codeBuffer.push(rawLine);
        continue;
      }

      if (!line.trim()) {
        paragraphs.push(new Paragraph({ children: [], spacing: { after: 80 } }));
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        paragraphs.push(
          new Paragraph({
            heading:
              level === 1
                ? HeadingLevel.HEADING_1
                : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 80 },
            children: this.parseInline(heading[2]),
          })
        );
        continue;
      }

      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        paragraphs.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60 },
            children: this.parseInline(bullet[1]),
          })
        );
        continue;
      }

      const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (numbered) {
        paragraphs.push(
          new Paragraph({
            numbering: { reference: 'default-numbering', level: 0 },
            spacing: { after: 60 },
            children: this.parseInline(numbered[1]),
          })
        );
        continue;
      }

      paragraphs.push(
        new Paragraph({
          spacing: { after: 100 },
          children: this.parseInline(line),
        })
      );
    }

    if (inCodeFence) flushCode();
    return paragraphs;
  }

  // ── Inline parser: **bold**, *italic*, `code` ───────────────────────
  private parseInline(text: string): TextRun[] {
    const tokens: TextRun[] = [];
    // Match **bold**, *italic*, _italic_, `code`. Order matters.
    const regex = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
      }
      if (match[2] !== undefined) {
        tokens.push(new TextRun({ text: match[2], bold: true }));
      } else if (match[3] !== undefined) {
        tokens.push(
          new TextRun({
            text: match[3],
            font: 'Consolas',
            color: '3d8f6a',
            shading: { type: ShadingType.SOLID, color: 'f0f2f5', fill: 'f0f2f5' },
          })
        );
      } else if (match[4] !== undefined) {
        tokens.push(new TextRun({ text: match[4], italics: true }));
      } else if (match[5] !== undefined) {
        tokens.push(new TextRun({ text: match[5], italics: true }));
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      tokens.push(new TextRun({ text: text.slice(lastIndex) }));
    }
    if (!tokens.length) tokens.push(new TextRun({ text }));
    return tokens;
  }

  // ── Download helpers ────────────────────────────────────────────────
  private buildFilename(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `aws-docubot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.docx`;
  }

  private triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
