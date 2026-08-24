import { AsyncPipe, CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ServiceCardComponent } from '../../components/service-card/service-card.component';
import { SettingsPanelComponent } from '../../components/settings-panel/settings-panel.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, AsyncPipe, ServiceCardComponent, SettingsPanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  protected readonly serviceState = inject(ServiceStateService);

  protected readonly user$ = this.authService.user$;

  ngOnInit(): void {
    this.serviceState.startPolling();
  }

  ngOnDestroy(): void {
    this.serviceState.stopPolling();
  }

  logout(): void {
    this.authService.logout();
  }

  refresh(): void {
    this.serviceState.refresh();
  }

  handleAction(serviceName: string, action: 'start' | 'stop'): void {
    if (action === 'start') {
      this.serviceState.startService(serviceName);
      return;
    }

    this.serviceState.stopService(serviceName);
  }

  trackByService(_index: number, service: { name: string }): string {
    return service.name;
  }
}
