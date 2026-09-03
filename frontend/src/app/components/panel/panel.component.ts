import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { SectionCollapseService } from '../../core/section-collapse.service';

/**
 * A titled, collapsible data card — the standard container for a page's
 * content. Header carries the title, an optional one-line subtitle, and a
 * chevron; the whole header toggles. Collapsed by default (see
 * `SectionCollapseService`), remembering an explicit open/close per `key`.
 *
 * Project into `[panel-actions]` for header-level buttons (they hide while
 * collapsed); everything else is the body.
 *
 *   <app-panel key="users:list" title="Accounts" subtitle="Every admin user">
 *     <button panel-actions class="btn btn-sm btn-primary">Add</button>
 *     …table…
 *   </app-panel>
 */
@Component({
  selector: 'app-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './panel.component.html',
  styleUrl: './panel.component.css',
})
export class PanelComponent {
  @Input({ required: true }) key!: string;
  @Input({ required: true }) title!: string;
  @Input() subtitle?: string;
  /** Optional `id` on the card, for in-page `#anchor` links. */
  @Input() anchor?: string;

  protected readonly collapse = inject(SectionCollapseService);

  get collapsed(): boolean {
    return this.collapse.isCollapsed(this.key);
  }

  toggle(): void {
    this.collapse.toggle(this.key);
  }
}
