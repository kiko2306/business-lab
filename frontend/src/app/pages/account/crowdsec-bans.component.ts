import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { finalize } from 'rxjs';
import { extractErrorMessage } from '../../core/api';
import { CrowdsecBan } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { PanelComponent } from '../../components/panel/panel.component';

/**
 * CrowdSec's active bans with an Unban action (plan.md §540), on the Security
 * page (§546) — it started inside Settings' ntfy panel, where nobody looked
 * for it. The parent renders it only for `settings:manage`, which the API
 * behind it requires.
 */
@Component({
  selector: 'app-crowdsec-bans',
  standalone: true,
  imports: [CommonModule, PanelComponent],
  templateUrl: './crowdsec-bans.component.html',
})
export class CrowdsecBansComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);

  protected bans: CrowdsecBan[] | null = null;
  protected loading = false;
  protected unbanningIp: string | null = null;
  protected feedback: { type: 'success' | 'danger'; message: string } | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.feedback = null;
    this.settingsService
      .loadCrowdsecBans()
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (res) => (this.bans = res.bans),
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to list CrowdSec bans.') };
        },
      });
  }

  unban(ip: string): void {
    this.unbanningIp = ip;
    this.feedback = null;
    this.settingsService
      .unbanCrowdsecIp(ip)
      .pipe(finalize(() => (this.unbanningIp = null)))
      .subscribe({
        next: (res) => {
          this.bans = (this.bans ?? []).filter((ban) => ban.ip !== ip);
          this.feedback = { type: 'success', message: res.message };
        },
        error: (error) => {
          this.feedback = { type: 'danger', message: extractErrorMessage(error, 'Unable to unban that IP.') };
        },
      });
  }

  protected remaining(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
}
