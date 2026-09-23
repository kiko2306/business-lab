using WHotWebService.DAO;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Xml;
using Newtonsoft.Json;
using System.Net.Http;
using WHotWebService.IO;

namespace WHotWebService
{
    internal class Config
    {
        /// <summary>
        /// Gets or sets site URL
        /// </summary>
        public static string API_URL { get; set; }

        /// <summary>
        /// Gets or sets wintouch Username.
        /// </summary>
        [JsonProperty("user")]
        public static string WTUsername { get; set; }

        /// <summary>
        /// Gets or sets wintouch password.
        /// </summary>
        [JsonProperty("password")]
        public static string WTPassword { get; set; }

        /// <summary>
        /// Gets or sets wintouch database.
        /// </summary>
        [JsonProperty("database")]
        public static string WTDatabase { get; set; }

        /// <summary>
        /// Gets or sets Events.
        /// </summary>
        internal static List<Event> Events { get; set; }

        /// <summary>
        /// Gets or sets a value indicating whether is the First Connection to the service.
        /// </summary>
        [JsonProperty("firstConnection")]
        internal static bool FirstConnection { get; set; }

        /// <summary>
        /// Loads Local and remote settings
        /// </summary>
        /// <returns>true if remote and local settings are loaded</returns>
        public static async Task<bool> LoadAsync()
        {
            bool is_loaded = LoadLoacalSettings();

            if (is_loaded)
            {
                is_loaded = await LoadRemoteSettingsAsync();
            }

            return is_loaded;
        }

        /// <summary>
        /// Load local settings
        /// </summary>
        /// <returns>true if local settings are loaded</returns>
        private static bool LoadLoacalSettings()
        {
            XmlDocument document = new XmlDocument();
            string filePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"WHotelWebService.config");

            try
            {
                document.Load(filePath);
                XmlNode node = document.DocumentElement.SelectSingleNode("//WHotelWebService/URL");
                API_URL = node.Attributes["value"].Value + "/api";
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Load settings from website
        /// </summary>
        /// <returns>true if data is valid and site has responded</returns>
        private static async Task<bool> LoadRemoteSettingsAsync()
        {
            Writer.Write("Get Remote Config");

            var client = new HttpClient();

            try
            {
                var response = client.GetAsync(Config.API_URL + "/config").Result;

                var responseStr = await response.Content.ReadAsStringAsync();

                var settings = new JsonSerializerSettings
                {
                    // Forcing Newtonsoft to look at static members during population
                    ContractResolver = new Newtonsoft.Json.Serialization.DefaultContractResolver
                    {
                        SerializeCompilerGeneratedMembers = true
                    }
                };

                //JsonConvert.DeserializeObject<Config>(responseStr);

                // 1. Parse into a Linq-to-JSON token array to extract the inner object
                var jsonToken = Newtonsoft.Json.Linq.JObject.Parse(responseStr);
                var innerJson = jsonToken["config"]?.ToString();

                if (!string.IsNullOrEmpty(innerJson))
                {
                    // 2. Instantiate a dummy target so it isn't a null argument 
                    Config dummyTarget = new Config();

                    // 3. Populate using the extracted flat JSON string
                    JsonConvert.PopulateObject(innerJson, dummyTarget, settings);
                }
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                return false;
            }
            Writer.Write($"First connection: {Config.FirstConnection}");
            Writer.Write($"Wintouch User {Config.WTUsername}");
            Writer.Write($"Wintouch Database {Config.WTDatabase}");

            return true;
        }
    }
}
