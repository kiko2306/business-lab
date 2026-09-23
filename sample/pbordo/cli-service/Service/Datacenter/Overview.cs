using PIWebService.Datacenter;
using System.Data;

namespace PIWebService.WsirDatacenter
{

    class Overview
    {
        public DataTable wsir_vnd_pedidos;
        public DataTable wsir_vnd_vendas;
        public DataTable wsir_vnd_meiospagamento;
        public DataTable wgcvendedores;
        public DataTable wsir_mst_mesas;


        public Overview()
        {
            DAO dao = new DAO();

            wsir_vnd_pedidos = dao.GetWsirVndPedidos();
            wsir_vnd_vendas = dao.GetWsirVndVendas();
            wsir_vnd_meiospagamento = dao.GetWsirVndMeiosPagamento();
            wgcvendedores = dao.GetWgcVendedores();
            wsir_mst_mesas = dao.GetWsirMstMesas();
        }
    }

}
