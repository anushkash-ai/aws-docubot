import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import hljs from 'highlight.js/lib/common';

/**
 * MarkdownPipe
 *
 * Converts markdown to HTML, including:
 *   - Headers, bold, italic, lists, links, tables, paragraphs
 *   - Inline code  → <code>
 *   - Fenced code  → <div class="code-block" data-lang="..."> ... </div>
 *                    with syntax highlighting via highlight.js,
 *                    a language label and a "Copy" button.
 *
 * The "Copy" button has a `data-copy-code` attribute; the message
 * component listens for clicks on it and copies the surrounding code.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {

  constructor(private sanitizer: DomSanitizer) {}

  transform(text: string): SafeHtml {
    if (!text) return '';

    const codeBlocks: string[] = [];
    let html = text.replace(
      /```([\w+-]*)\n?([\s\S]*?)```/g,
      (_full, lang: string, code: string) => {
        codeBlocks.push(this.renderCodeBlock(lang || '', code));
        return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
      }
    );

    html = html.replace(/(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)*)/g, (table) => {
      const rows = table.trim().split('\n');
      const headers = rows[0].split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const body = rows.slice(2).map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
    });

    html = html
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Group consecutive <li> rows (with possibly multiple blank lines
      // between them) into a single <ul>. The previous regex only allowed
      // one optional newline, which left orphan list items.
      .replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, '<br>');

    html = `<p>${html}</p>`;

    html = html
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<h[123]>)/g, '$1').replace(/(<\/h[123]>)<\/p>/g, '$1')
      .replace(/<p>(<div class="code-block")/g, '$1').replace(/(<\/div>)<\/p>/g, '$1')
      .replace(/<p>(<ul>)/g,    '$1').replace(/(<\/ul>)<\/p>/g,    '$1')
      .replace(/<p>(<table>)/g, '$1').replace(/(<\/table>)<\/p>/g, '$1')
      // Strip stray <br> tags that ended up between list items
      .replace(/<\/li>\s*<br\s*\/?>\s*<li>/g, '</li><li>')
      .replace(/<ul>\s*<br\s*\/?>\s*/g, '<ul>')
      .replace(/\s*<br\s*\/?>\s*<\/ul>/g, '</ul>');

    codeBlocks.forEach((block, i) => {
      html = html.replace(`%%CODEBLOCK_${i}%%`, block);
    });

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  // ── Code block rendering with highlight.js ──────────────────────────
  private renderCodeBlock(lang: string, rawCode: string): string {
    const code = rawCode.replace(/\n+$/, '');
    const normalizedLang = (lang || '').trim().toLowerCase();
    const aliases: Record<string, string> = {
      sh: 'bash', shell: 'bash', zsh: 'bash',
      js: 'javascript', ts: 'typescript',
      py: 'python', yml: 'yaml',
    };
    const langName = aliases[normalizedLang] || normalizedLang;

    let highlighted = '';
    let detectedLang = langName || 'text';

    try {
      if (langName && hljs.getLanguage(langName)) {
        highlighted = hljs.highlight(code, { language: langName, ignoreIllegals: true }).value;
      } else {
        const auto = hljs.highlightAuto(code);
        highlighted = auto.value;
        if (auto.language) detectedLang = auto.language;
      }
    } catch {
      highlighted = this.escapeHtml(code);
    }

    const labelText = (detectedLang === 'plaintext' || detectedLang === 'text')
      ? 'CODE'
      : detectedLang.toUpperCase();

    // The encoded code lives in a data attribute so the click handler
    // can read it back without DOM-walking.
    const encoded = encodeURIComponent(code);

    return (
      `<div class="code-block" data-lang="${this.escapeAttr(detectedLang)}">`
      + `<div class="code-block-header">`
      +   `<span class="code-block-lang">${this.escapeHtml(labelText)}</span>`
      +   `<button type="button" class="code-block-copy" data-copy-code="${encoded}" title="Copy code">`
      +     `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" aria-hidden="true">`
      +       `<rect x="4.5" y="4.5" width="8.5" height="9.5" rx="1.6" stroke="currentColor" stroke-width="1.3" fill="none"/>`
      +       `<rect x="2.5" y="2" width="8.5" height="9.5" rx="1.6" stroke="currentColor" stroke-width="1.3" fill="#ffffff"/>`
      +     `</svg>`
      +     `<span class="code-block-copy-label">Copy</span>`
      +   `</button>`
      + `</div>`
      + `<pre><code class="hljs language-${this.escapeAttr(detectedLang)}">${highlighted}</code></pre>`
      + `</div>`
    );
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, '&quot;');
  }
}
