using System;
using System.IO;
using System.Linq;
using System.Xml.Linq;

namespace Hotel.Agent
{
    /// <summary>
    /// Everything the agent is configured with (plan.md §627): the site it
    /// reports to, and the local Wintouch install to boot into. No domain and
    /// no unit list — the agent iterates every unit itself (§620, §638, unlike
    /// tally, which is one agent per shop), so there is nothing to bind.
    ///
    /// The Wintouch *application* user is asked for here rather than derived,
    /// unlike tally's SQL Server login (AgentOptions in apps/tally/agent):
    /// `SetCurrentUser` needs a Wintouch operator account, which has no
    /// equivalent sitting in Wintouch's own config for this code to read.
    /// Still entered once, locally, and never transmitted (§627) — this
    /// closes the same README item tally's local-SQL-credentials read did.
    /// </summary>
    public sealed class AgentOptions
    {
        public string BaseUrl { get; }
        public string WintouchUser { get; }
        public string WintouchPassword { get; }
        public string WintouchDatabase { get; }

        private AgentOptions(string baseUrl, string wintouchUser, string wintouchPassword, string wintouchDatabase)
        {
            BaseUrl = baseUrl;
            WintouchUser = wintouchUser;
            WintouchPassword = wintouchPassword;
            WintouchDatabase = wintouchDatabase;
        }

        public Uri EnrolUri => new Uri(new Uri(BaseUrl), "/agent/enrol");
        public Uri UnitsUri => new Uri(new Uri(BaseUrl), "/agent/units");
        public Uri PushUnitsUri => new Uri(new Uri(BaseUrl), "/agent/units");
        public Uri PushGuestsUri => new Uri(new Uri(BaseUrl), "/agent/guests");
        public Uri PushReservationsUri => new Uri(new Uri(BaseUrl), "/agent/reservations");
        public Uri PendingCheckinsUri => new Uri(new Uri(BaseUrl), "/agent/checkins/pending");
        public Uri AckCheckinUri(string token) => new Uri(new Uri(BaseUrl), $"/agent/checkins/{token}/ack");

        public static AgentOptions Load(string configPath)
        {
            var doc = XDocument.Load(configPath);
            var root = doc.Root ?? throw new InvalidOperationException($"{configPath} is empty");

            var baseUrl = Value(root.Element("url"))
                ?? throw new InvalidOperationException($"{configPath} has no <url value=\"...\" />");
            var wintouchDir = root.Element("wintouchConfig")?.Attribute("path")?.Value
                ?? throw new InvalidOperationException($"{configPath} has no <wintouchConfig path=\"...\" />");
            var userElement = root.Element("wintouchUser")
                ?? throw new InvalidOperationException($"{configPath} has no <wintouchUser value=\"...\" password=\"...\" />");
            var user = userElement.Attribute("value")?.Value;
            var password = userElement.Attribute("password")?.Value;
            if (string.IsNullOrEmpty(user))
            {
                throw new InvalidOperationException($"{configPath}'s <wintouchUser> has no value (Wintouch operator username)");
            }

            return new AgentOptions(baseUrl.TrimEnd('/'), user!, password ?? string.Empty, ReadWintouchDatabase(wintouchDir));
        }

        /// <summary>
        /// The Wintouch database name, for `SetDatabase` (WintouchSession.cs).
        /// Read from Wintouch's own config, the same file and element tally's
        /// AgentOptions reads the SQL Server login from — but this agent has
        /// no SQL connection of its own, so only the database name is used.
        /// </summary>
        private static string ReadWintouchDatabase(string wintouchDir)
        {
            var path = Path.Combine(wintouchDir, "Wintouch.config");
            var doc = XDocument.Load(path);
            var server = doc.Descendants("server").FirstOrDefault()
                ?? throw new InvalidOperationException($"{path} has no <server> block");
            return Value(server.Element("database"))
                ?? throw new InvalidOperationException($"{path}'s <server> has no <database value=\"...\" />");
        }

        private static string? Value(XElement? element) => element?.Attribute("value")?.Value;
    }
}
