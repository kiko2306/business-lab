using WHotWebService.IO;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace WHotWebService
{
    internal class WHotel
    {
        public static bool Start()
        {
            try
            {
                Writer.Write("Starting WHotel");
                Wintouch.Core.Applications.ApplicationsManager.Start("whot");
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                return false;
            }

            try
            {
                Writer.Write("Login in");
                Wintouch.Core.Settings.Settings.SetCurrentUser(Config.WTUsername, Config.WTPassword);
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                return false;
            }

            try
            {
                Writer.Write("Db Setup : " + Config.WTDatabase);
                Wintouch.Core.Settings.Settings.SetDatabase(Config.WTDatabase);
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                return false;
            }

            try
            {
                Writer.Write("Load Lic");
                var app = Wintouch.Core.Applications.ApplicationsManager.InstalledApplications["whot"];
                Wintouch.Core.Applications.ApplicationsManager.SwitchContext(app, false, false);
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                return false;
            }

            try
            {
                Writer.Write("Load Settings");
                Wintouch.Manager.BusinessTier.Settings.ReloadSettings();
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                return false;
            }

            Writer.Write("Wintouch running...");

            return true;
        }
    }
}
