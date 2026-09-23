using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using WHotWebService.IO;

namespace WHotWebService.DAO
{
    internal class Ping
    {
        internal static async Task<bool> CheckAsync()
        {
            Writer.Write($"Ping server");
            var client = new HttpClient();

            var response = client.GetAsync(Config.API_URL + "/ping").Result;

            // Success / fail handler
            if (response.IsSuccessStatusCode)
            {
                await response.Content.ReadAsStringAsync();

                Writer.Write($"Success: Server {Config.API_URL} is online");

                return true;
            }
            else
            {
                Writer.Write($"Error: Serve is offline");
                return false;
            }
        }
    }
}
