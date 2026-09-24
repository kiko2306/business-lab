using System;
using System.IO;

namespace Hotel.Agent
{
    /// <summary>
    /// Always writes to the console (so running the binary directly for
    /// diagnostics, the same as tally's agent, just works) and appends to a
    /// daily log file beside the token store — a real Windows Service has no
    /// attached console, so that's the only place its output is otherwise
    /// visible at all.
    /// </summary>
    public static class Writer
    {
        private static readonly string LogDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "HotelAgent", "logs");

        public static void Write(string message)
        {
            var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} -> {message}";
            Console.WriteLine(line);
            try
            {
                Directory.CreateDirectory(LogDir);
                var path = Path.Combine(LogDir, $"hotel-agent-{DateTime.Now:yyyyMMdd}.log");
                File.AppendAllLines(path, new[] { line });
            }
            catch (IOException)
            {
                // The console line above already carries the message; a
                // locked or unwritable log file must not take a sync job down.
            }
        }
    }
}
