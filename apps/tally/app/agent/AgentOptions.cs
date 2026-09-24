using System.Xml.Linq;

namespace Tally.Agent;

/// <summary>
/// Everything the agent is configured with: the site it reports to, and where
/// Wintouch's own config lives. The shop it serves is not here — the enrolment
/// code binds that, and the server tells the agent which shop it is
/// (plan.md §627).
/// </summary>
public sealed record AgentOptions(string BaseUrl, string SqlConnectionString)
{
    public Uri EnrolUri => new(new Uri(BaseUrl), "/agent/enrol");

    /// <summary>ws:// or wss:// mirroring the site's own scheme.</summary>
    public Uri SocketUri
    {
        get
        {
            var builder = new UriBuilder(new Uri(new Uri(BaseUrl), "/agent/connect"))
            {
                Scheme = new Uri(BaseUrl).Scheme == "https" ? "wss" : "ws",
            };
            return builder.Uri;
        }
    }

    public static AgentOptions Load(string configPath)
    {
        var doc = XDocument.Load(configPath);
        var root = doc.Root ?? throw new InvalidOperationException($"{configPath} is empty");

        var baseUrl = Value(root.Element("url"))
            ?? throw new InvalidOperationException($"{configPath} has no <url value=\"...\" />");
        var wintouchPath = root.Element("wintouchConfig")?.Attribute("path")?.Value
            ?? throw new InvalidOperationException($"{configPath} has no <wintouchConfig path=\"...\" />");

        return new AgentOptions(baseUrl.TrimEnd('/'), ReadWintouchConnectionString(wintouchPath));
    }

    /// <summary>
    /// Reads SQL Server credentials from Wintouch's own configuration.
    ///
    /// This is the point §627 turns on: the credentials are obtained locally
    /// from the installed product, never handed down from the cloud the way the
    /// hotel system's <c>GET /api/config</c> did (§620). Nothing sends them
    /// anywhere.
    /// </summary>
    private static string ReadWintouchConnectionString(string wintouchDir)
    {
        var path = Path.Combine(wintouchDir, "wintouch.config");
        var doc = XDocument.Load(path);
        var server = doc.Descendants("server").FirstOrDefault()
            ?? throw new InvalidOperationException($"{path} has no <server> block");

        var name = Value(server.Element("name")) ?? throw new InvalidOperationException("no server name");
        var database = Value(server.Element("database")) ?? throw new InvalidOperationException("no database");
        // Wintouch's own timeout is for interactive use and is typically 120s.
        // The dashboard gives up on an agent after 20s (plan.md §634), so a
        // connect that takes longer can only ever surface as a silent timeout
        // with nothing said about why. Capped so a database problem comes back
        // as a reportable error instead.
        var configured = int.TryParse(Value(server.Element("timeout")), out var t) ? t : 120;
        var timeout = Math.Min(configured, 8);
        var trusted = Value(server.Element("trustedlogin")) == "1";

        var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder
        {
            DataSource = name,
            InitialCatalog = database,
            ConnectTimeout = timeout,
            // Wintouch installs use a local instance with the product's own
            // certificate, which is not one a CA signed.
            TrustServerCertificate = true,
            // Read-only workload: this agent never writes to Wintouch.
            ApplicationName = "Tally.Agent",
        };

        if (trusted)
        {
            builder.IntegratedSecurity = true;
        }
        else
        {
            builder.UserID = Value(server.Element("user")) ?? throw new InvalidOperationException("no user");
            builder.Password = Value(server.Element("password")) ?? string.Empty;
        }

        return builder.ConnectionString;
    }

    private static string? Value(XElement? element) => element?.Attribute("value")?.Value;
}
