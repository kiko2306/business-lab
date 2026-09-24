using System;
using System.IO;
using Topshelf;

namespace Hotel.Agent
{
    /// <summary>
    /// Two ways in, same as tally's agent: `enrol &lt;CODE&gt;` runs once and
    /// exits, everything else runs the service (plan.md §627). Topshelf
    /// hosts it, matching the legacy exactly (sample/hotel/WHotWebService/Program.cs)
    /// rather than tally's modern `Microsoft.Extensions.Hosting.WindowsServices`,
    /// which targets net6.0+ and has no net48 build.
    /// </summary>
    internal static class Program
    {
        private static int Main(string[] args)
        {
            var configPath = Environment.GetEnvironmentVariable("HOTEL_CONFIG")
                ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "hotel.config");

            if (!File.Exists(configPath))
            {
                Console.Error.WriteLine($"No configuration at {configPath}. Copy hotel.config.example and fill it in.");
                return 1;
            }

            AgentOptions options;
            try
            {
                options = AgentOptions.Load(configPath);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Could not read configuration: {ex.Message}");
                return 1;
            }

            var tokens = new TokenStore();
            var api = new ApiClient(options, tokens);

            if (args.Length >= 1 && args[0].Equals("enrol", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Length < 2)
                {
                    Console.Error.WriteLine("Usage: Hotel.Agent.exe enrol <CODE>");
                    return 1;
                }
                return api.EnrolAsync(args[1]).GetAwaiter().GetResult() ? 0 : 1;
            }

            var stateDir = Path.GetDirectoryName(tokens.Path)!;
            var sync = new HotelSync(api, stateDir);
            var manager = new ServiceManager(options, sync);

            try
            {
                var exitCode = HostFactory.Run(x =>
                {
                    x.Service<ServiceManager>(s =>
                    {
                        s.ConstructUsing(_ => manager);
                        s.WhenStarted(service => service.Start());
                        s.WhenStopped(service => service.Stop());
                    });
                    x.RunAsLocalSystem();
                    x.SetServiceName("Hotel.Agent");
                    x.SetDisplayName("Hotel.Agent");
                    x.SetDescription("Syncs units, guests, reservations and check-ins between hotel-core and Wintouch");
                });
                return (int)Convert.ChangeType(exitCode, exitCode.GetTypeCode());
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }
    }
}
