import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { environment } from 'src/environments/environment'
import { DomainService } from './domain.service'
import { BehaviorSubject } from 'rxjs'

export interface IWgcVendedores {
  codigo: string
  nome: string
}

export interface IWsirVndPedidos {
  mesa: number
  quantidade: number
  descricao: string
  total: number
}

export interface IWsirMstMesas {
  mesa: number
  estado: number
  numclientes: number
  funcionario: string
}

export interface IWsirVndMeiosPagamento {
  funcionario: string
  meiospagamento: string
  total: number
  documento: string
  numdoc: number
}

export interface IWsirVndVendas {
  Anulado: number
  descricao: string
  funcionario: string
  mesa: string
  horai: Date
  horaf: Date
  documento: string
  numdoc: number
  quantidade: number
  tipolinha: string
  total: number
}

export interface IOverview {
  wgcvendedores: IWgcVendedores[]
  wsir_vnd_pedidos: IWsirVndPedidos[]
  wsir_mst_mesas: IWsirMstMesas[]
  wsir_vnd_meiospagamento: IWsirVndMeiosPagamento[]
  wsir_vnd_vendas: IWsirVndVendas[]
}


@Injectable({
  providedIn: 'root'
})
export class OverviewService {

  constructor(
    private http: HttpClient,
    private domainService: DomainService
  ) { }

  private overview = new BehaviorSubject<IOverview | null>(null);
  overviewObs = this.overview.asObservable();

  getOverview(storeId: string) {
    const domain = this.domainService.getSelected()

    this.http.get<IOverview>(environment.apiURL + 'store/' + domain + '/' + storeId + '/overview')
      .subscribe(overview => {

        // TODO: remove before production
        console.log(overview)

        this.overview.next(overview)
      })
  }
}