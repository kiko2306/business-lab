using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;
using Tally.Agent;

// Three ways in: `install` (or opening the exe) is the setup, `enrol <CODE>`
// runs once and exits, everything else runs the agent. Enrolment is a separate verb because it is a one-time human act —
// an installer prompt or an operator at a console — while the service must
// start unattended on every boot (plan.md §627).

// The setup runs before any config exists — it is what writes it — so it has
// to come ahead of the config check below.
if (args.FirstOrDefault()?.ToLowerInvariant() == "install"
    || (args.Length == 0 && Environment.UserInteractive))
{
    return await Installer.RunAsync();
}

var configPath = Environment.GetEnvironmentVariable("TALLY_CONFIG")
    ?? Path.Combine(AppContext.BaseDirectory, "tally.config");

if (!File.Exists(configPath))
{
    Console.Error.WriteLine($"No configuration at {configPath}. Copy tally.config.example and set the site URL.");
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

var builder = Host.CreateApplicationBuilder(args);
// A no-op when not launched by the service control manager, so the same binary
// runs as a console app for development and diagnostics.
builder.Services.AddWindowsService(o => o.ServiceName = "Tally.Agent");
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<TokenStore>(_ => new TokenStore());
builder.Services.AddSingleton(_ => new ShopReader(options.SqlConnectionString));
builder.Services.AddSingleton<AgentClient>();
builder.Services.AddHostedService<AgentWorker>();

var host = builder.Build();

if (args.Length >= 1 && args[0].Equals("enrol", StringComparison.OrdinalIgnoreCase))
{
    if (args.Length < 2)
    {
        Console.Error.WriteLine("Usage: Tally.Agent enrol <CODE>");
        return 1;
    }
    var client = host.Services.GetRequiredService<AgentClient>();
    return await client.EnrolAsync(args[1], CancellationToken.None) ? 0 : 1;
}

if (!OperatingSystem.IsWindows())
{
    host.Services.GetRequiredService<ILogger<Program>>()
        .LogWarning("Not running on Windows: the agent token is stored without DPAPI protection. Development only.");
}

await host.RunAsync();
// Not a literal 0: if the worker faults the host stops and sets ExitCode to 1,
// and returning 0 would hide that from the service manager's recovery actions.
return Environment.ExitCode;

/// <summary>Holds the outbound connection for the lifetime of the service.</summary>
internal sealed class AgentWorker(AgentClient client) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => client.RunAsync(stoppingToken);
}
