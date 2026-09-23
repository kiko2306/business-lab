using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PortoInf.Interop.DAO
{
    internal class PaymentHeader
    {
        [JsonProperty("id")] internal int Id { get; set; }

        [JsonProperty("reservation_id")] internal string ReservationId { get; set; }
        [JsonProperty("total")] internal decimal Total { get; set; }
        [JsonProperty("entity_code")] internal string EntityCode { get; set; }
        [JsonProperty("entity_type")] internal int EntityType { get; set; }
        [JsonProperty("name")] internal string Name { get; set; }
        [JsonProperty("last_name")] internal string LastName { get; set; }
        [JsonProperty("address")] internal string Address { get; set; }
        [JsonProperty("zip_code")] internal string ZipCode { get; set; }
        [JsonProperty("local")] internal string Local { get; set; }
        [JsonProperty("vat_number")] internal string VatNumber { get; set; }
        [JsonProperty("amount")] internal decimal Amount { get; set; }
        [JsonProperty("payment_datetime")] internal DateTime PaymentDateTime { get; set; }
        [JsonProperty("payment_method")] internal string PaymentMethod { get; set; }
        [JsonProperty("payment_row")] internal List<PaymentRow> PaymentRow { get; set; }

    }
}
