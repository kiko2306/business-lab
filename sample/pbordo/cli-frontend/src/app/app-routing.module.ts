import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { IndexComponent } from './public/index/index.component';
import { CliLoginComponent } from './public/cli-login/cli-login.component';
import { LoginComponent } from './admin/login/login.component';
import { DomainSelectionComponent } from './public/domain-selection/domain-selection.component';


const routes: Routes = [
  { path: '', component: DomainSelectionComponent, pathMatch: 'full' },
  { path: 'help', component: IndexComponent, pathMatch: 'full' },
  { path: 'cli/:cli', component: CliLoginComponent, pathMatch: 'full' },
  { path: 'admin', component: LoginComponent },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
