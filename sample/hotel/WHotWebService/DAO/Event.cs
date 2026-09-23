using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace WHotWebService.DAO
{
    internal class Event
    {
        [JsonProperty("name")]
        internal string Name { get; set; }

        [JsonProperty("slug")]
        internal string Slug { get; set; }

        [JsonProperty("hours")]
        internal int? Hours { get; set; }

        [JsonProperty("days_offset")]
        internal int? Offset { get; set; }

        [JsonProperty("active")]
        internal bool Active { get; set; }
    }
}
