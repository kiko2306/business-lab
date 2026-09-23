using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PortoInf.Interop.DAO
{
    internal class InvoiceHeader
    {
        /// <summary>
        /// Reservation Id
        /// </summary>
        [JsonProperty("reservation_id")] internal string ReservationId { get; set; }

        /// <summary>
        /// Reservation Total
        /// </summary>
        [JsonProperty("total")] internal decimal Total { get; set; }

        [JsonProperty("payed_amount")] internal decimal PayedAmount { get; set; }
        
        [JsonProperty("payed_at")] internal DateTime PayedAt { get; set; }

        [JsonProperty("payment_method")] internal string PaymentMethod { get; set; }

    }
}
