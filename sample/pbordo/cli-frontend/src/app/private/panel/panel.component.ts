import { Component, OnInit, OnDestroy } from '@angular/core'
import { ShopService, IShop } from 'src/app/services/shop.service'
import { Subscription } from 'rxjs'
import { CliLoginService } from 'src/app/services/cli-login.service'
import { OverviewService, IOverview, IWsirVndPedidos, IWsirMstMesas, IWsirVndMeiosPagamento, IWgcVendedores, IWsirVndVendas } from 'src/app/services/overview.service'

@Component({
  selector: 'app-panel',
  templateUrl: './panel.component.html',
  styleUrls: ['./panel.component.css']
})
export class PanelComponent implements OnInit, OnDestroy {

  constructor(
    private shopService: ShopService,
    private loginService: CliLoginService,
    private overviewService: OverviewService
  ) { }

  private subscriptions = new Subscription();
  storeList: IShop[] = []

  selectedStoreName: string = ""
  selectedStoreID: string = ""

  overview: IOverview | null = null

  isLoading: boolean = false

  ngOnInit(): void {

    this.isLoading = true

    this.subscriptions.add(this.shopService.storeListObs.subscribe(list => {
      this.storeList = list
      this.isLoading = false
    }))

    this.shopService.list(this.loginService.getLogedUser())

    this.subscriptions.add(this.overviewService.overviewObs.subscribe(overview => {
      if (!overview) { return }
      this.overview = overview
      this.isLoading = false
    }))
  }

  getTotalDone() {
    let total = 0

    if (this.overview === null) {
      return total.toFixed(2)
    }

    this.overview.wsir_vnd_vendas.forEach(element => {

      // Remove canceled and internal consumption sales from total
      if (element.Anulado !== 1 && element.documento !== "CONSINTR") {
        total += element.total
      }
    })

    return total.toFixed(2)
  }

  getTotalOpen(): string {
    let total = 0

    if (this.overview === null) {
      return total.toFixed(2)
    }

    this.overview.wsir_vnd_pedidos.forEach(element => {
      total += (element.total)
    })

    return total.toFixed(2)
  }

  getPreview() {
    const d = this.getTotalDone()
    const o = this.getTotalOpen()

    return (Number.parseFloat(d) + Number.parseFloat(o)).toFixed(2)
  }

  getSoldItemsQt() {
    let total = 0

    if (this.overview === null) {
      return total.toFixed(2)
    }

    this.overview.wsir_vnd_vendas.forEach(element => {
      if (element.Anulado !== 1 && element.tipolinha !== 'C') {
        total += element.quantidade
      }
    })

    return total.toFixed(2)
  }

  getSoldItemsList(): IWsirVndVendas[] {
    const itemsList: IWsirVndVendas[] = []

    if (this.overview === null) {
      return itemsList
    }

    this.overview.wsir_vnd_vendas.forEach(element => {
      const item = itemsList.find(i => i.descricao === element.descricao)

      if (element.tipolinha === 'C' || element.Anulado === 1) {
        return
      }

      if (item) {
        item.quantidade += element.quantidade
        item.total += element.total
      } else {
        itemsList.push({ ...element })
      }
    })

    return itemsList
  }

  getOccupiedTables(): IWsirMstMesas[] {

    if (this.overview === null) {
      return []
    }

    const oTables = this.overview.wsir_mst_mesas.filter(t => t.estado === 1)

    return oTables
  }

  getFreeTablesTotal(): number {

    if (this.overview === null) {
      return 0
    }

    const freeTables = this.overview.wsir_mst_mesas.filter(t => t.estado === 0)

    return freeTables.length
  }

  getEndTable(): IWsirMstMesas[] {

    if (this.overview === null) {
      return []
    }

    const endTable = this.overview.wsir_mst_mesas.filter(t => t.estado === 2)

    return endTable
  }

  getTableTotal(table: number): string {

    if (this.overview === null) {
      return "0.00"
    }

    const t = this.overview.wsir_vnd_pedidos.filter(tab => tab.mesa === table)
    let total = 0
    t.forEach(element => {
      total += element.total
    })

    return total.toFixed(2)
  }

  getTableContent(tableNumber: number): IWsirVndPedidos[] {
    const content = this.overview?.wsir_vnd_pedidos.filter(m => m.mesa === tableNumber) || []

    return content
  }

  getEmployeeName(code: string): string {

    if (this.overview === null) {
      return ""
    }

    const emp = this.overview.wgcvendedores.find(f => f.codigo === code)

    return emp?.nome || ""
  }

  getDistinctMeioPag(): IWsirVndMeiosPagamento[] {
    const mPag: IWsirVndMeiosPagamento[] = []

    this.overview?.wsir_vnd_meiospagamento.forEach(element => {
      const i = mPag.find(mpg => mpg.meiospagamento === element.meiospagamento)

      if (!i) {
        mPag.push({ ...element })
      }
    })

    return mPag
  }

  getTotalByMeioPag(mPag: string): string {

    const movs = this.overview?.wsir_vnd_meiospagamento.filter(m => m.meiospagamento === mPag)
    let tot = 0

    movs?.forEach(element => {
      const linhasDoc = this.overview?.wsir_vnd_vendas.find(doc => doc.documento === element.documento && doc.numdoc === element.numdoc)
      if (linhasDoc?.Anulado === 0) {
        tot += element.total
      }

    })

    return tot.toFixed(2)
  }

  getDistinctFunc() {
    const funcs: IWgcVendedores[] = []

    this.overview?.wsir_vnd_meiospagamento.forEach(element => {
      const i = funcs.find(f => f.codigo === element.funcionario)

      if (!i) {
        const funcAux = this.overview?.wgcvendedores.find(f => f.codigo === element.funcionario)
        const func: IWgcVendedores = { codigo: element.funcionario, nome: funcAux?.nome || "" }
        funcs.push(func)
      }

    })

    return funcs
  }

  getFuncValue(func: string) {
    const sells = this.overview?.wsir_vnd_vendas.filter(v => v.funcionario === func && v.Anulado === 0 && v.tipolinha === 'P')
    let tot = 0

    sells?.forEach(element => {
      // Remove internal consumption sales from total
      if (element.documento !== "CONSINTR") {
        tot += element.total
      }
    })

    return tot.toFixed(2)
  }

  getData(storeId: string, storeName: string) {
    this.isLoading = true
    this.selectedStoreName = storeName
    this.overviewService.getOverview(storeId)
  }

  back() {
    this.selectedStoreName = ""
    this.selectedStoreID = ""
    this.overview = null
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe()
  }

}
