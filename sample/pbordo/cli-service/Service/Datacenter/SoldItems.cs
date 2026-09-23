using System;
using System.Data;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PIWebService.Datacenter
{
    class SoldItems
    {

        public DataTable soldItems;
        public int totalItemsSold;
        public decimal totalValueSold;

        public SoldItems()
        {
            DAO dao = new DAO();
            soldItems = dao.GetSoldItems();
            totalItemsSold = dao.GetTotalItemsSold();
            totalValueSold = dao.GetTotalValueSold();
        }



    }
}
