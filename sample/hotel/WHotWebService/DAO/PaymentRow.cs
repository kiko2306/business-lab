using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PortoInf.Interop.DAO
{
    internal class PaymentRow
    {
        [JsonProperty("invoice_row")] internal InvoiceRow InvoiceRows { get; set; }
    }
}
