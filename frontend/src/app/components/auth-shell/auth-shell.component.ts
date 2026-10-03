import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

/**
 * The card every sign-in page sits in (plan.md §827): login, setup,
 * set-password and recovery. Each used to carry its own copy of this markup,
 * and recovery a different design, so the four did not read as one flow.
 *
 *   <app-auth-shell kicker="Welcome" [title]="..." size="wide">
 *     <span auth-subtitle>…</span>   (optional, under the title)
 *     …the form…
 *     <a auth-footer>…</a>           (optional, last)
 *   </app-auth-shell>
 *
 * Owns the page's one <main> and one <h1>. The layout classes live in the
 * shared theme (`.auth-page`, `.auth-card`, `.auth-kicker`); the mirrored
 * markup in auth-layout.spec.ts measures that the card is centred.
 */
@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth-shell.component.html',
})
export class AuthShellComponent {
  @Input({ required: true }) kicker!: string;
  @Input({ required: true }) title!: string;
  /** `wide` for the pages with two password fields, `narrow` for sign-in. */
  @Input() size: 'narrow' | 'wide' = 'narrow';
}
