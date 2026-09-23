using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PortoInf.Interop.DAO
{
    internal class InvoiceRow
    {
        [JsonProperty("original_number")] public int ItemLine { get; set; }

        /// <summary>
        /// item Code
        /// </summary>
        [JsonProperty("item_code")] internal string ItemCode { get; set; }

        /// <summary>
        /// Item Name
        /// </summary>
        [JsonProperty("item_name")] internal string ItemName { get; set; }

        /// <summary>
        /// Item Quantity
        /// </summary>
        [JsonProperty("item_qt")] internal decimal ItemQt { get; set;}

        /// <summary>
        /// Item price
        /// </summary>
        [JsonProperty("unit_price")] internal decimal UnitPrice { get; set; }
    }
}
