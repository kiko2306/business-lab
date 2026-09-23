
namespace WHotWebService
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Text;
    using System.Threading.Tasks;
    using Topshelf;

    
    internal class Program
    {
        static void Main(string[] args)
        {
            try
            {
                var exitCode = HostFactory.Run(x =>
                {
                    x.Service<ServiceManager>(s =>
                    {
                        s.ConstructUsing(service => new ServiceManager());

                        s.WhenStarted(service => service.Start());
                        s.WhenStopped(service => service.Stop());

                    });
                    x.RunAsLocalSystem();
                    x.SetServiceName("PortoInf.Interop");
                    x.SetDisplayName("PortoInf.Interop");
                    x.SetDescription("This service connects web apps to Wintouch");
                });
                int exitCodeValue = (int)Convert.ChangeType(exitCode, exitCode.GetTypeCode());
                Environment.ExitCode = exitCodeValue;
            }
            catch (Exception e)
            {
                Console.WriteLine(e.Message);
                Environment.Exit(-1);
            }
        }
    }
}
