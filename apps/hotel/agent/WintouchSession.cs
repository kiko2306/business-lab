using System;

namespace Hotel.Agent
{
    /// <summary>
    /// Boots Wintouch in-process, the same four calls the legacy's
    /// WHotel.Start() makes (sample/hotel/WHotWebService/WHotel.cs) —
    /// ApplicationsManager.Start, SetCurrentUser, SetDatabase, SwitchContext,
    /// then Wintouch.Manager.Businesstier.Settings.ReloadSettings(). The only
    /// change from the legacy is where the credentials come from: local
    /// config (AgentOptions) rather than a remote GET /api/config (§627).
    ///
    /// There is no network protocol between this agent and Wintouch — once
    /// booted, `Wintouch.Hotel.Businesstier.*` calls run against the loaded
    /// assemblies directly, in-process, the same as any other Wintouch
    /// front-end.
    /// </summary>
    public sealed class WintouchSession
    {
        private const string AppKey = "whot";

        public static void Start(AgentOptions options)
        {
            Wintouch.Core.Applications.ApplicationsManager.Start(AppKey);
            Wintouch.Core.Settings.Settings.SetCurrentUser(options.WintouchUser, options.WintouchPassword);
            Wintouch.Core.Settings.Settings.SetDatabase(options.WintouchDatabase);

            var app = Wintouch.Core.Applications.ApplicationsManager.InstalledApplications[AppKey];
            Wintouch.Core.Applications.ApplicationsManager.SwitchContext(app, false, false);

            Wintouch.Manager.BusinessTier.Settings.ReloadSettings();
        }
    }
}
