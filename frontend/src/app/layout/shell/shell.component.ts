import { AsyncPipe, NgIf } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { OperationsService } from '../../core/operations.service';

/**
 * The authenticated app shell: one persistent header + footer around every
 * signed-in page (§131.1 slice 1). Before this, the dashboard route carried
 * its own header and the smaller pages each had a lone "Back to dashboard"
 * button; promoting that chrome here is what lets the dashboard's areas move
 * onto their own routes one slice at a time without each re-inventing a nav.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe, NgIf],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly operations = inject(OperationsService);

  protected readonly user$ = this.authService.user$;

  // Shown in the footer. Empty until the probe resolves so nothing flashes;
  // a failure just leaves it blank (the footer text is conditional on it).
  protected appVersion = '';

  ngOnInit(): void {
    this.operations.getAppVersion().subscribe({
      next: (response) => (this.appVersion = response.version),
      error: () => (this.appVersion = ''),
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
