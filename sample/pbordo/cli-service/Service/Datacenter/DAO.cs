using PIWebService.Global;
using System;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Reflection;

namespace PIWebService.Datacenter
{
    class DAO
    {
        private readonly SqlConnection mConnection;
        private SqlCommand mCommand;

        public DAO()
        {
            mConnection = new SqlConnection
            {
                ConnectionString = "server=" + Settings.wintouch.server.name +
                    ";uid=" + Settings.wintouch.server.user +
                    ";pwd=" + Settings.wintouch.server.password +
                    ";database=" + Settings.wintouch.server.database +
                    ";Connect Timeout = " + Settings.wintouch.server.timeout
            };
        }

        internal DataTable GetWsirMstMesas()
        {
            return RunQueryDataTable("getWsirMstMesas");
        }

        internal DataTable GetWsirVndMeiosPagamento()
        {
            return RunQueryDataTable("getWsirVndMeiosPagamento");
        }

        internal DataTable GetWgcVendedores()
        {
            return RunQueryDataTable("getWgcVendedores");
        }

        internal DataTable GetWsirVndVendas()
        {
            return RunQueryDataTable("getWsirVndVendas");
        }

        internal decimal GetTotalValueSold()
        {
            return (decimal)RunQueryScalar("getTotalValueSold");
        }

        internal int GetTotalItemsSold()
        {
         return (int)RunQueryScalar("getTotalItemsSold");
        }

        internal DataTable GetSoldItems()
        {
            return RunQueryDataTable("getSoldItems");
        }

        internal DataTable GetWsirVndPedidos()
        {
            return RunQueryDataTable("wsir_vnd_pedidos");
        }

        #region Clientes
        internal int GetClientsDone()
        {
            return (int)RunQueryScalar("clients_done_count");
        }

        internal int GetClientsPresent()
        {
            return (int)RunQueryScalar("clients_present_count");
        }
        #endregion

        #region Mesas
        internal int GetTablesCheckout()
        {
            return (int)RunQueryScalar("tables_checkout_count"); ;
        }

        internal int GetTablesOccupied()
        {
            return (int)RunQueryScalar("tables_occupied_count");
        }

        internal int GetTablesFree()
        {
            return (int)RunQueryScalar("tables_free_count");
        }

        internal DataTable GetTablesList()
        {
            return RunQueryDataTable("tables_list");
        }
        #endregion

        #region Totais
        internal decimal GetTotalCredit()
        {
            return (decimal)RunQueryScalar("total_credit");
        }

        internal decimal GetTotalOpen()
        {
            return (decimal)RunQueryScalar("total_open");
        }

        internal decimal GetTotalDay()
        {
            return (decimal)RunQueryScalar("total_day");
        }
        internal DataTable GetTotalDetails()
        {
            return RunQueryDataTable("total_details");
        }

        internal DataTable GetTotalOpenDetails()
        {
            return RunQueryDataTable("total_open_details");
        }
        internal DataTable GetWeekComp()
        {
            return RunQueryDataTable("total_week_comp");
        }
        #endregion


        private string LoadSqlStatment(string sqlFileName)
        {
            string sqlStatement = string.Empty;
            string namespacePart = "PIWebService.Datacenter.Querys";
            string resourceName = namespacePart + "." + sqlFileName + ".sql";

            using (Stream stm = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (stm != null)
                {
                    sqlStatement = new StreamReader(stm).ReadToEnd();
                }
            }

            return sqlStatement;
        }

        private object RunQueryScalar(string queryName)
        {
            mCommand = new SqlCommand
            {
                Connection = mConnection,
                CommandText = LoadSqlStatment(queryName),
                CommandType = CommandType.Text,
                CommandTimeout = Settings.wintouch.server.timeout
            };

            mConnection.Open();
            var result = mCommand.ExecuteScalar();
            mConnection.Close();
            return result;
        }

        private DataTable RunQueryDataTable(string queryName)
        {
            mCommand = new SqlCommand
            {
                Connection = mConnection,
                CommandText = LoadSqlStatment(queryName),
                CommandType = CommandType.Text,
                CommandTimeout = Settings.wintouch.server.timeout
            };

            mConnection.Open();
            var dataTable = new DataTable();
            var result = mCommand.ExecuteReader();
            dataTable.Load(result);
            mConnection.Close();
            return dataTable;
        }
    }
}
