using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Data;

namespace PIWebService.Datacenter
{

       class Tables
    {
        public int free;
        public int ocuppied;
        public int account;
        public DataTable details;

        public Tables()
        {

            DAO dao = new DAO();
            free = dao.GetTablesFree();
            ocuppied = dao.GetTablesOccupied();
            account = dao.GetTablesCheckout();
            details = dao.GetTablesList();
        }
    }
}
