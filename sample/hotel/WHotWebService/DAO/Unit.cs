using Newtonsoft.Json;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using WHotWebService.IO;

namespace WHotWebService.DAO
{
    public class Unit
    {
        /// <summary>
        /// Gets or sets unit.
        /// </summary>
        [JsonProperty("code")] public string Code { get; set; }

        /// <summary>
        /// Gets or sets name.
        /// </summary>
        [JsonProperty("name")] public string Name { get; set; }

        internal static async Task UpdateRemote()
        {
            Writer.Write("Start: Updating units");
            var units = Unit.LoadUnits();

            await Unit.Send(units);
            Writer.Write("End: Updating units");
        }

        /// <summary>
        /// Load available units from wintouch
        /// </summary>
        /// <returns></returns>
        private static List<Unit> LoadUnits()
        {
            // Get all units from wintouch
            var units = Wintouch.Hotel.Businesstier.Unidades.Unidades;

            // Cache the items to avoid multiple lookups
            var unitsDictionary = units.ToDictionary(unit => unit, unit => Wintouch.Hotel.Businesstier.Unidades.GetItem(unit).descricao);

            // Return a list of units
            var retLst = new List<Unit>(units.Count);
            foreach (var unit in units)
            {
                retLst.Add(new Unit
                {
                    Code = unit,
                    Name = unitsDictionary[unit],
                });
            }

            Writer.Write($"Found {retLst.Count} units");

            // Return the list
            return retLst;
        }

        /// <summary>
        /// This method sends a list of units to a remote API using HTTP POST.
        /// </summary>
        /// <param name="units"></param>
        /// <returns></returns>
        private static async Task Send(List<Unit> units)
        {
            // Create an HttpClient to send HTTP requests.
            using (var client = new HttpClient())
            {
                // Serialize the list of units to JSON data.
                var data = JsonConvert.SerializeObject(units);

                // Create a request body with the JSON data and set the content type.
                var body = new StringContent(data, Encoding.UTF8, "application/json");

                // Send an asynchronous POST request to the specified API URL.
                var response = await client.PostAsync(Config.API_URL + "/units", body).ConfigureAwait(false);

                // Read the response content as a string.
                var responseStr = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                // Deserialize the JSON response into an anonymous type containing a "message" field.
                var responseMessage = JsonConvert.DeserializeAnonymousType(responseStr, new { message = string.Empty });

                // Check if the response indicates a successful operation (HTTP status code 2xx).
                if (response.IsSuccessStatusCode)
                {
                    // Log a success message along with the API response message.
                    Writer.Write($"Response message: {responseMessage.message} ");
                }
                else
                {
                    // Log an error message along with the API response message in case of failure.
                    Writer.Write($"Error message: {responseMessage.message}");
                }
            }
        }

    }
}
