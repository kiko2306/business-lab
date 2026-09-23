import { Component, OnInit, OnDestroy } from '@angular/core'
import { ActivatedRoute } from '@angular/router'
import { DomainService } from 'src/app/services/domain.service'
import { CliLoginService } from 'src/app/services/cli-login.service'
import { Subscription } from 'rxjs'

@Component({
  selector: 'app-cli-login',
  templateUrl: './cli-login.component.html',
  styleUrls: ['./cli-login.component.css']
})
export class CliLoginComponent implements OnInit, OnDestroy {

  constructor(
    private activatedRoute: ActivatedRoute,
    private domainService: DomainService,
    private loginService: CliLoginService
  ) { }

  private subscriptions = new Subscription();
  public userLoggedIn: boolean = false;
  public saveLogin = false;

  username = '';
  password = '';

  ngOnInit(): void {
    const cli = this.activatedRoute.snapshot.paramMap.get('cli')

    if (!cli) {
      return
    }

    this.domainService.setSelected(cli)

    const lsData = localStorage.getItem('PBordoLogin')
    if (lsData) {
      const lsDataJSON = JSON.parse(lsData)
      this.username = lsDataJSON.username
      this.password = lsDataJSON.password
    }

    this.subscriptions.add(this.loginService.isLoggedIn.subscribe(result => {
      this.userLoggedIn = result
    }))

  }

  onLogin() {
    this.loginService.login(this.username, this.password)
    if (this.saveLogin) {
      localStorage.setItem('PBordoLogin', JSON.stringify({ username: this.username, password: this.password }))
    }
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe()
  }

}
