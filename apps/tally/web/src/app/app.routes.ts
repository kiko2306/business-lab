import { Routes } from '@angular/router';
import { ShopComponent } from './shop/shop.component';
import { StoresComponent } from './stores/stores.component';

export const routes: Routes = [
  { path: '', component: StoresComponent, pathMatch: 'full' },
  { path: 'shops/:id', component: ShopComponent },
  // Anything else is a mistyped or stale link; the shop list is the only
  // sensible landing place.
  { path: '**', redirectTo: '' },
];
