using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using PIWebService.Datacenter;
using PIWebService.Global;
using PIWebService.WsirDatacenter;
using System;
using System.Net;
using System.Net.Http;
using System.ServiceProcess;
using System.Text;
using System.Threading.Tasks;
using System.Timers;

namespace PIWebService
{
    public partial class WebService : ServiceBase
    {
        private readonly Timer timerIpUpdate = new Timer();
        private string WEBSERVER_URL = "http://+:" + Settings.config.port + "/";
        private readonly string API_URL = "https://pbordo-api.portoinf-dev.space/api/";
        private WebServer webServer;
        private string myIp;

        // Enter 128 e 255
        private enum Commands
        {
            Start = 128,
            ReStart = 200,
            Stop = 255
        }

        public WebService()
        {
            InitializeComponent();
        }

        public void OnDebug()
        {
            StartServer();
            while (true)
            {
                // Loop para manter o serviço a correr durante debug
            }
        }

        protected override void OnStart(string[] args)
        {
            StartServer();
        }

        private void StartServer()
        {
            // Inicia o webserver
            webServer = new WebServer(SendResponse, WEBSERVER_URL);
            webServer.Run();
            // Inicia o timer para actualizar o ip
            timerIpUpdate.Elapsed += new ElapsedEventHandler(OnTimedEvent);
            timerIpUpdate.Interval = 30000;
            timerIpUpdate.Enabled = true;
            OnTimedEvent(null, null);
        }

        private void OnTimedEvent(object source, ElapsedEventArgs e)
        {
            var oldIp = myIp;
            string tempIp;

            try
            {
                using (WebClient webClient = new WebClient())
                {
                    tempIp = webClient.DownloadString("https://api.ipify.org");
                }
            }
            catch
            {
                return;
            }

            if (oldIp == tempIp) return;

            Uri u = new Uri(API_URL + "store/set_ip");

            var payloadObj = new
            {
                ip = tempIp + ":" + Settings.config.port,
                Settings.config.store,
                Settings.config.domain
            };

            string payload = JsonConvert.SerializeObject(payloadObj);

            using (HttpContent c = new StringContent(payload, Encoding.UTF8, "application/json"))
            {
                var task = Task.Run(() => SendURI(u, c));

                if (task.Result == "OK") myIp = tempIp;
                //Console.WriteLine(task.Result);
            }
        }

        static async Task<string> SendURI(Uri u, HttpContent c)
        {
            var response = string.Empty;
            using (var client = new HttpClient())
            {
                HttpRequestMessage request = new HttpRequestMessage
                {
                    Method = HttpMethod.Post,
                    RequestUri = u,
                    Content = c
                };

                try
                {
                    HttpResponseMessage result = await client.SendAsync(request);
                    if (result.IsSuccessStatusCode)
                    {
                        response = result.StatusCode.ToString();
                    }
                }
                catch (Exception ex)
                {

                    Console.WriteLine(ex);
                }
                request.Dispose();
            }
            return response;
        }

        public static string SendResponse(HttpListenerRequest httpRequest)
        {
            var _request = httpRequest.RawUrl;


            object result;

            switch (_request)
            {
                case "/ping":
                    result = new { message = "Pong" };
                    break;
                case "/sold_items":
                    result = new SoldItems();
                    break;
                case "/tables":
                    result = new Tables();
                    break;
                case "/overview":
                    result = new Overview();
                    break;
                default:
                    result = new { error = "Comando desconhecido!" };
                    break;
            }


            var settings = new JsonSerializerSettings
            {
                ContractResolver = new LowercaseContractResolver()
            };

            var json = JsonConvert.SerializeObject(result, Formatting.Indented, settings);

            return json;
        }

        private void StopServer()
        {
            webServer.Stop();
            timerIpUpdate.Stop();
            timerIpUpdate.Dispose();
        }

        protected override void OnCustomCommand(int command)
        {
            base.OnCustomCommand(command);
            if (command == (int)Commands.Start)
            {
                StartServer();
            }

            if (command == (int)Commands.Stop)
            {
                StopServer();
            }
        }

        protected override void OnStop()
        {
            StopServer();
        }
    }
}
