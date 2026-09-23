using System.IO;
using System.Reflection;
using System.Xml;

namespace PIWebService.Global
{
   

    static class Settings
    {
        public static Config config = new Config();
        public static Wintouch wintouch = new Wintouch();

        public class Config
        {
            private readonly string appPath = Path.GetDirectoryName(Assembly.GetEntryAssembly().Location);

            public int port;
            public string store;
            public string domain;
         
            public string wintouchConfigPath;
            public string wintouchConfigSetting;

            public Config()
            {
                // Carrega o xml
                XmlDocument config = new XmlDocument();
                config.Load(Path.Combine(appPath, "pbordo.config"));
                // Le os valores dos nodes
                XmlNode portNode = config.DocumentElement.SelectSingleNode("/webService/port");
                XmlNode wintouchConfigPathNode = config.DocumentElement.SelectSingleNode("/webService/wintouchConfig/path");
                XmlNode wintouchConfigSettingNode = config.DocumentElement.SelectSingleNode("/webService/wintouchConfig/setting");

                XmlNode domainNode = config.DocumentElement.SelectSingleNode("/webService/domain");
                XmlNode storeNode = config.DocumentElement.SelectSingleNode("/webService/store");

                port = int.TryParse(portNode.Attributes["value"].Value, out port) ? port : 8080;
                store = storeNode.Attributes["name"].Value;
                domain = domainNode.Attributes["value"].Value;
                
                wintouchConfigPath = wintouchConfigPathNode.Attributes["value"].Value;
                wintouchConfigSetting = wintouchConfigSettingNode.Attributes["name"].Value;
            }
        }

        public class Wintouch
        {
            public Server server = new Server();

            public Wintouch()
            {
                // Carrega o xml
                XmlDocument config = new XmlDocument();
                config.Load(Path.Combine(Settings.config.wintouchConfigPath, "wintouch.config"));

                XmlNode serverNameNode = config.DocumentElement.SelectSingleNode("/wintouch/settings/setting[@name='" + Settings.config.wintouchConfigSetting + "']/server/name");
                XmlNode serverUserNode = config.DocumentElement.SelectSingleNode("/wintouch/settings/setting[@name='" + Settings.config.wintouchConfigSetting + "']/server/user");
                XmlNode serverPasswordNode = config.DocumentElement.SelectSingleNode("/wintouch/settings/setting[@name='" + Settings.config.wintouchConfigSetting + "']/server/password");
                XmlNode serverTimeoutNode = config.DocumentElement.SelectSingleNode("/wintouch/settings/setting[@name='" + Settings.config.wintouchConfigSetting + "']/server/timeout");
                XmlNode serverDatabaseNode = config.DocumentElement.SelectSingleNode("/wintouch/settings/setting[@name='" + Settings.config.wintouchConfigSetting + "']/server/database");

                server.name = serverNameNode.Attributes["value"].Value;
                server.user = serverUserNode.Attributes["value"].Value;
                server.password = serverPasswordNode.Attributes["value"].Value;
                server.timeout = int.TryParse(serverTimeoutNode.Attributes["value"].Value, out server.timeout) ? server.timeout : 120;
                server.database = serverDatabaseNode.Attributes["value"].Value;
            }

            public class Server
            {
                //public string setting;
                public string name;
                public string user;
                public string password;
                public int timeout;
                public string database;
            }

        }
    }

}
