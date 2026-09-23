import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { DomainService } from './domain.service'
import { environment } from 'src/environments/environment'
import { BehaviorSubject, Subject } from 'rxjs'

export interface IItem {
  quantidade: number
  descricao: string
  total: number
}

export interface ISoldItems {
  soldItems: IItem[]
  totalItemsSold: number
  totalValueSold: number
}

export interface ITableDetails {
  table_number: number
  vendor: string
  horainicial: Date
  numclientes: number
  total: number
}

export interface ITables {
  free: number
  ocuppied: number
  account: number
  details: ITableDetails[]
}

export interface IShop {
  id: string
  name: string
  ip: string
  isActive: boolean
  isOnline?: boolean
}

@Injectable({
  providedIn: 'root'
})
export class ShopService {

  constructor(
    private http: HttpClient,
    private domainService: DomainService
  ) { }

  private storeList = new BehaviorSubject<IShop[]>([]);
  storeListObs = this.storeList.asObservable();

  soldItems = new Subject<ISoldItems>();
  tables = new Subject<ITables>();

  list(user: string) {
    const domain = this.domainService.getSelected()

    this.http.get<IShop[]>(environment.apiURL + 'store/' + domain + '/' + user + '/list').subscribe(list => {
      this.storeList.next(list)
    })
  }

  getSoldItems(storeId: string) {
    const domain = this.domainService.getSelected()
    this.http.get<ISoldItems>(environment.apiURL + 'store/' + domain + '/' + storeId + '/sold_items').subscribe(soldItems => {
      this.soldItems.next(soldItems)
    })
  }

  getTables(storeId: string) {
    const domain = this.domainService.getSelected()
    this.http.get<ITables>(environment.apiURL + 'store/' + domain + '/' + storeId + '/tables').subscribe(tables => {
      this.tables.next(tables)
    })
  }


}
