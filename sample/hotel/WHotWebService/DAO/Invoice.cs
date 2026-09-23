using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PortoInf.Interop.DAO
{
    internal class Invoice
    {
        // TODO: move data to reservation class
        [JsonProperty("header")] internal InvoiceHeader InvoiceHeader { get; set; }

        [JsonProperty("rows")] internal List<InvoiceRow> InvoiceRows { get; set; }

        internal Invoice()
        {
            InvoiceHeader = new InvoiceHeader();
            InvoiceRows = new List<InvoiceRow>();
        }

        internal void AddInvoiceHeader(decimal total)
        {
            this.InvoiceHeader.Total = total;
        }

        internal void AddInvoiceRow(int line, string item_code, string item_name, decimal item_qt, decimal unit_price)
        {
            InvoiceRows.Add(
                new InvoiceRow
                {
                    ItemLine = line,
                    ItemCode = item_code,
                    ItemName = item_name,
                    ItemQt = item_qt,
                    UnitPrice = unit_price
                }
            );
        }
    }
}
