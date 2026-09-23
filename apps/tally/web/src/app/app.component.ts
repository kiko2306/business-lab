import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { StoresComponent } from './stores/stores.component';

/**
 * One page, so no router: the whole admin surface is stores, who may see them,
 * and their agents. A route only earns its place when there is somewhere else
 * to go.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, StoresComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {}
