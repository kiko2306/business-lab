using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Hotel.Agent
{
    /// <summary>
    /// Where the agent's long-lived token lives (plan.md §627), same shape as
    /// tally's (apps/tally/agent/TokenStore.cs): DPAPI-encrypted at machine
    /// scope under %ProgramData%, never plaintext beside the executable the
    /// way the legacy's config files held every secret they had (§622).
    ///
    /// Windows-only here, unlike tally's — this agent only ever runs beside a
    /// real Wintouch install, which means a real Windows machine, so there is
    /// no development-on-Linux path to support.
    /// </summary>
    public sealed class TokenStore
    {
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Hotel.Agent.v1");

        private readonly string _path;

        public TokenStore(string? path = null)
        {
            _path = path ?? DefaultPath();
        }

        public string Path => _path;

        private static string DefaultPath()
        {
            // ProgramData, not the install directory: the token survives an
            // upgrade that replaces the program files.
            var root = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "HotelAgent");
            return System.IO.Path.Combine(root, "agent.token");
        }

        public string? Read()
        {
            if (!File.Exists(_path)) return null;
            var bytes = File.ReadAllBytes(_path);
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.LocalMachine));
        }

        public void Write(string token)
        {
            var dir = System.IO.Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.LocalMachine);
            File.WriteAllBytes(_path, bytes);
        }

        public void Clear()
        {
            if (File.Exists(_path)) File.Delete(_path);
        }
    }
}
