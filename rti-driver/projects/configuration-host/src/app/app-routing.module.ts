import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AppComponent } from './app.component';
import { PairingComponent } from './pairing/pairing.component';
import { WelcomeComponent } from './welcome/welcome.component';

const routes: Routes = [
  { 
    path: '', 
    component: WelcomeComponent,
  },
  {
    path: 'devices/:index',
    component: PairingComponent,
  }
];
@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})

export class AppRoutingModule { }
