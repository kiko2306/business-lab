import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { DomainService } from './domain.service';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CliLoginService {

  constructor(
    private http: HttpClient,
    private domainService: DomainService
  ) { }

  public isLoggedIn = new Subject<boolean>();
  private loggedUser: string;

  login(username: string, password: string) {
    this.http.post(environment.apiURL + 'login/user', { domain: this.domainService.getSelected(), username, password })
      .subscribe(result => {
        this.loggedUser = username;
        this.isLoggedIn.next(true);
      }, err => {
        this.isLoggedIn.next(false);
      });
  }

  getLogedUser(): string {
    return this.loggedUser;
  }

}
