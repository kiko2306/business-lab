using System;
using System.IO;
using System.Threading.Tasks;
using System.Timers;

namespace Hotel.Agent
{
    /// <summary>
    /// The tick loop (plan.md §627), same shape as the legacy's
    /// ServiceManager: boot Wintouch once, then run the four jobs every five
    /// minutes. No ping first — unlike the legacy, every authenticated call
    /// already counts as liveness on the server (auth.ts's requireAgent), so
    /// a dead site simply fails the next push instead of a dedicated check.
    /// </summary>
    public sealed class ServiceManager
    {
        private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

        private readonly Timer _timer = new Timer(Interval.TotalMilliseconds) { AutoReset = false };
        private readonly AgentOptions _options;
        private readonly HotelSync _sync;

        public ServiceManager(AgentOptions options, HotelSync sync)
        {
            _options = options;
            _sync = sync;
            _timer.Elapsed += async (_, __) => await TickAsync().ConfigureAwait(false);
        }

        public void Start()
        {
            WintouchSession.Start(_options);
            Writer.Write("Wintouch running; starting sync loop");
            // Once now rather than waiting a full interval for the first
            // tick, then on the timer from there.
            _ = TickAsync();
        }

        public void Stop() => _timer.Stop();

        private async Task TickAsync()
        {
            try
            {
                Writer.Write("---- tick start ----");
                await _sync.SyncUnitsAsync().ConfigureAwait(false);
                await _sync.SyncGuestsAsync().ConfigureAwait(false);
                await _sync.SyncReservationsAsync().ConfigureAwait(false);
                await _sync.ProcessPendingCheckinsAsync().ConfigureAwait(false);
                Writer.Write("---- tick end ----");
            }
            catch (Exception ex)
            {
                // One bad tick must not take the service down; the next
                // timer fire tries again in full (every push is an upsert,
                // safe to repeat — plan.md §639).
                Writer.Write($"Tick failed: {ex}");
            }
            finally
            {
                _timer.Start();
            }
        }
    }
}
