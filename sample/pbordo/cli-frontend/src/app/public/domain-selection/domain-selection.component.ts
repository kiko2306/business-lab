import { Component, OnInit } from '@angular/core'
import { Router } from '@angular/router'

import { environment } from 'src/environments/environment'

@Component({
  selector: 'app-domain-selection',
  templateUrl: './domain-selection.component.html',
  styleUrls: ['./domain-selection.component.css']
})
export class DomainSelectionComponent implements OnInit {

  constructor(
    private router: Router
  ) { }

  domain = '';
  error: string = '';
  env = environment.apiURL;

  ngOnInit(): void {
  }

  onRedirect() {
    if (this.domain !== '') {
      this.router.navigate(['cli/' + this.domain])
    }
  }

}
