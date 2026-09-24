using System.Diagnostics;
using System.Runtime.Versioning;
using System.Security.Principal;
using System.ServiceProcess;
using System.Xml.Linq;

namespace Tally.Agent;

/// <summary>
/// Setup, built into the agent's own exe so the download is one file (plan.md
/// §670): double-click it (or run `install`) and it asks for the site URL, the
/// enrolment code and the Wintouch folder, copies itself into Program Files,
/// enrols and registers the service.
///
/// A service is launched with no arguments and is not interactive, so "no
/// arguments, interactive" is unambiguous as "the user opened the setup";
/// running the agent in a console for diagnostics is the explicit `run` verb.
/// </summary>
internal static class Installer
{
    private const string ServiceName = "Tally.Agent";
    private const string DefaultWintouchDir = @"C:\wintouch\sgw";

    public static async Task<int> RunAsync()
    {
        var code = 1;
        try
        {
            code = OperatingSystem.IsWindows()
                ? await InstallAsync()
                : Fail("The setup is Windows-only. Use `run` to try the agent elsewhere.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Setup failed: {ex.Message}");
        }

        // A double-clicked console closes the instant we return, taking the
        // result with it.
        if (!Console.IsInputRedirected)
        {
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
        return code;
    }

    [SupportedOSPlatform("windows")]
    private static async Task<int> InstallAsync()
    {
        var self = Environment.ProcessPath ?? throw new InvalidOperationException("cannot locate this executable");

        // install.config beside the setup pre-answers any question; an empty or
        // missing value falls through to the prompt.
        var preset = ReadPresets(Path.Combine(Path.GetDirectoryName(self)!, "install.config"));
        var url = preset("url") ?? Ask("Tally site URL (e.g. https://tally.example.com)");
        var enrolCode = preset("code") ?? Ask("Enrolment code (from Tally: issue one, then paste it here)");
        // The default matches this repo's own dev machine and every install
        // seen so far (plan.md §629); Enter accepts it.
        var wintouchDir = preset("wintouchDir")
            ?? Ask($"Wintouch folder (the one holding wintouch.config) [{DefaultWintouchDir}]", DefaultWintouchDir);

        if (url.Length == 0 || enrolCode.Length == 0)
            return Fail("Both the site URL and the enrolment code are required.");
        if (!File.Exists(Path.Combine(wintouchDir, "wintouch.config")))
            return Fail($"No wintouch.config under {wintouchDir}. Run the setup again and enter the folder Wintouch is installed in.");

        // After the questions, before any change: everything above can be
        // checked without elevation, and everything below cannot happen without it.
        if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            return Fail("Run the setup as administrator (right-click, Run as administrator).");

        var installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tally");
        var installed = Path.Combine(installDir, "Tally.Agent.exe");

        using var service = new ServiceController(ServiceName);
        var registered = Exists(service);
        if (registered && service.Status != ServiceControllerStatus.Stopped)
        {
            // A running exe cannot be overwritten, which is what re-running the
            // setup over an installed agent has to do.
            Console.WriteLine("Stopping the running agent...");
            service.Stop();
            service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
        }

        Console.WriteLine($"Installing into {installDir}...");
        Directory.CreateDirectory(installDir);
        if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(installed), StringComparison.OrdinalIgnoreCase))
            File.Copy(self, installed, overwrite: true);

        // The same two settings tally.config.example documents — nothing else
        // in the file varies per install.
        new XDocument(new XElement("tallyAgent",
            new XElement("url", new XAttribute("value", url)),
            new XElement("wintouchConfig", new XAttribute("path", wintouchDir))))
            .Save(Path.Combine(installDir, "tally.config"));

        Console.WriteLine("Enrolling...");
        // The installed copy enrols, so it reads the tally.config just written
        // and stores the token where the service will look for it.
        var enrol = Process.Start(new ProcessStartInfo(installed) { ArgumentList = { "enrol", enrolCode }, UseShellExecute = false })!;
        await enrol.WaitForExitAsync();
        if (enrol.ExitCode != 0)
            return Fail("Enrolment failed. Check the code is current (it expires in minutes) and the URL is reachable, then run the setup again.");

        if (!registered)
        {
            Console.WriteLine("Registering the service...");
            Sc($"create {ServiceName} binPath= \"\\\"{installed}\\\"\" start= auto");
        }
        // Recovery, applied on every run so an install made before it existed
        // also gets it: restart after 5 s, 5 s, then 60 s, forgetting failures
        // after a day. failureflag makes a non-zero exit (an unhandled crash
        // in .NET) count, not just a kill.
        Sc($"failure {ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/60000");
        Sc($"failureflag {ServiceName} 1");

        // Re-enrolling replaced the token the server was tracking, so a fresh
        // start is what makes the service pick up the new one.
        service.Refresh();
        service.Start();
        Console.WriteLine($"Done. {ServiceName} is installed and running from {installDir}.");
        return 0;
    }

    /// <summary>A missing service makes ServiceController throw on any read.</summary>
    [SupportedOSPlatform("windows")]
    private static bool Exists(ServiceController service)
    {
        try { _ = service.Status; return true; }
        catch (InvalidOperationException) { return false; }
    }

    private static void Sc(string arguments)
    {
        using var p = Process.Start(new ProcessStartInfo("sc.exe", arguments)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
        })!;
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidOperationException($"sc.exe {arguments.Split(' ')[0]} failed: {output.Trim()}");
    }

    private static string Ask(string label, string fallback = "")
    {
        Console.Write($"{label}: ");
        var answer = Console.ReadLine()?.Trim();
        return string.IsNullOrEmpty(answer) ? fallback : answer;
    }

    private static Func<string, string?> ReadPresets(string path)
    {
        var root = File.Exists(path) ? XDocument.Load(path).Root : null;
        return key =>
        {
            var value = root?.Element(key)?.Attribute("value")?.Value.Trim();
            return string.IsNullOrEmpty(value) ? null : value;
        };
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}
