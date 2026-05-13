import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type Theme = 'light' | 'dark';
export type ModelChoice = 'gemini' | 'claude';

interface PersistedSettings {
  theme?: Theme;
  model?: ModelChoice;
  thinkMode?: boolean;
}

const STORAGE_KEY = 'aws-docubot.settings.v1';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly theme$ = new BehaviorSubject<Theme>('light');
  readonly model$ = new BehaviorSubject<ModelChoice>('claude');
  readonly thinkMode$ = new BehaviorSubject<boolean>(false);

  constructor() {
    this.load();
    // Apply theme to <html> immediately
    this.applyTheme(this.theme$.value);
    // React to future theme changes
    this.theme$.subscribe(t => this.applyTheme(t));
    // Persist on any change
    this.theme$.subscribe(() => this.save());
    this.model$.subscribe(() => this.save());
    this.thinkMode$.subscribe(() => this.save());
  }

  setTheme(theme: Theme) { this.theme$.next(theme); }
  toggleTheme() { this.setTheme(this.theme$.value === 'dark' ? 'light' : 'dark'); }
  setModel(model: ModelChoice) { this.model$.next(model); }
  setThinkMode(on: boolean) { this.thinkMode$.next(on); }

  private applyTheme(theme: Theme) {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: PersistedSettings = JSON.parse(raw);
      if (parsed.theme === 'light' || parsed.theme === 'dark') {
        this.theme$.next(parsed.theme);
      }
      if (parsed.model === 'gemini' || parsed.model === 'claude') {
        this.model$.next(parsed.model);
      }
      if (typeof parsed.thinkMode === 'boolean') {
        this.thinkMode$.next(parsed.thinkMode);
      }
    } catch {
      // ignore corrupt storage
    }
  }

  private save() {
    try {
      const data: PersistedSettings = {
        theme: this.theme$.value,
        model: this.model$.value,
        thinkMode: this.thinkMode$.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorage may be disabled (private mode); silently ignore
    }
  }
}
