import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <h1>Homelab Manager</h1>
    <p>Welcome to the homelab management system.</p>
  `,
})
export class AppComponent {
  title = 'homelab-frontend';
}
