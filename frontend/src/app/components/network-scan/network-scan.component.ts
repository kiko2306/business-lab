import { NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { PanelComponent } from '../panel/panel.component';
import { DiscoveredHost } from '../../core/models';
import { OperationsService } from '../../core/operations.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

type ScanState = 'idle' | 'scanning' | 'done' | 'failed';

/**
 * The one-off LAN device scan, moved from the Utils page into Settings
 * (plan.md §841 fix 2). Not run on load: a sweep takes ~10s and sends
 * traffic to every device on the network, so it runs only when asked for.
 */
@Component({
  selector: 'app-network-scan',
  standalone: true,
  imports: [NgFor, NgIf, PanelComponent, TranslatePipe],
  templateUrl: './network-scan.component.html',
})
export class NetworkScanComponent {
  private readonly operations = inject(OperationsService);
  protected readonly translate = inject(TranslateService);

  protected state: ScanState = 'idle';
  protected hosts: DiscoveredHost[] = [];

  protected scan(): void {
    // The button stays focusable while scanning (aria-disabled, not `disabled`,
    // which would drop keyboard focus to <body>), so the click must guard itself.
    if (this.state === 'scanning') {
      return;
    }
    this.state = 'scanning';
    this.operations.scanNetwork().subscribe({
      next: ({ hosts }) => {
        this.hosts = hosts;
        this.state = 'done';
      },
      error: () => (this.state = 'failed'),
    });
  }

  private static recognised(host: DiscoveredHost): boolean {
    return !!(host.hostname || host.type);
  }

  /** This server, then devices with a name or maker, then the rest; each group keeps the scan's address order. */
  protected get sorted(): DiscoveredHost[] {
    const rank = (h: DiscoveredHost) => (h.isServer ? 0 : NetworkScanComponent.recognised(h) ? 1 : 2);
    return [...this.hosts].sort((a, b) => rank(a) - rank(b));
  }

  protected get firstUnrecognised(): DiscoveredHost | undefined {
    return this.sorted.find((h) => !h.isServer && !NetworkScanComponent.recognised(h));
  }

  /** One sentence for the live region: what is happening, or what came back and what to try. */
  protected get statusText(): string {
    switch (this.state) {
      case 'scanning':
        return this.translate.t('settings.networkScan.scanning');
      case 'done':
        return this.hosts.length
          ? this.translate.t(this.hosts.length === 1 ? 'settings.networkScan.foundOne' : 'settings.networkScan.foundMany', { count: this.hosts.length })
          : this.translate.t('settings.networkScan.none');
      default:
        return '';
    }
  }
}
