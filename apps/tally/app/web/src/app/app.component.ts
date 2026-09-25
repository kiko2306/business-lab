import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Lang, TPipe, lang, setLang } from './i18n';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet, TPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  lang = lang;
  // Set before first paint by theme-init.js: saved choice, else the OS preference.
  theme = signal(document.documentElement.getAttribute('data-bs-theme') ?? 'dark');

  toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.setAttribute('data-bs-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Blocked storage: the choice applies to this page only.
    }
  }

  setLang(next: Lang): void {
    setLang(next);
  }
}
