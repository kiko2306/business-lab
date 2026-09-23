using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;

namespace Tally.Agent;

/// <summary>
/// Where the agent's long-lived token lives (plan.md §627).
///
/// On Windows it is encrypted with DPAPI at machine scope, so the file is
/// useless if copied to another machine, and it is never in plaintext beside
/// the executable — which is exactly what the legacy config files did with
/// every secret they held (§622).
///
/// Off Windows there is no DPAPI, so the token is written with owner-only
/// permissions and the agent says so loudly. That path exists for development
/// on Linux; a shop runs Windows.
/// </summary>
public sealed class TokenStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Tally.Agent.v1");

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
        var root = OperatingSystem.IsWindows()
            ? System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Tally")
            : System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "tally-agent");
        return System.IO.Path.Combine(root, "agent.token");
    }

    public string? Read()
    {
        if (!File.Exists(_path)) return null;
        var bytes = File.ReadAllBytes(_path);
        return OperatingSystem.IsWindows() ? UnprotectWindows(bytes) : Encoding.UTF8.GetString(bytes);
    }

    public void Write(string token)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(_path)!);
        var bytes = OperatingSystem.IsWindows()
            ? ProtectWindows(token)
            : Encoding.UTF8.GetBytes(token);
        File.WriteAllBytes(_path, bytes);
        if (!OperatingSystem.IsWindows()) RestrictToOwner(_path);
    }

    public void Clear()
    {
        if (File.Exists(_path)) File.Delete(_path);
    }

    [SupportedOSPlatform("windows")]
    private static byte[] ProtectWindows(string token) =>
        ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.LocalMachine);

    [SupportedOSPlatform("windows")]
    private static string UnprotectWindows(byte[] bytes) =>
        Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.LocalMachine));

    private static void RestrictToOwner(string path)
    {
        // The analyser cannot see that callers already checked, so the guard is
        // restated here rather than suppressed.
        if (OperatingSystem.IsWindows()) return;
        try
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        catch (PlatformNotSupportedException)
        {
            // Nothing to tighten; the caller already warned that this is the
            // development path.
        }
    }
}
