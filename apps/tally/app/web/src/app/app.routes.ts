import { Routes } from '@angular/router';
import { ShopComponent } from './shop/shop.component';
import { StoresComponent } from './stores/stores.component';
import { t } from './i18n';

export const routes: Routes = [
  // The page name first, so a tab or history entry says which page it is; the shop
  // page sets its own title from the shop's name once that is known.
  { path: '', component: StoresComponent, pathMatch: 'full', title: `${t('Shops')} · Tally` },
  { path: 'shops/:id', component: ShopComponent },
  // Anything else is a mistyped or stale link; the shop list is the only
  // sensible landing place.
  { path: '**', redirectTo: '' },
];
