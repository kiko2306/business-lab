using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace WHotWebService.IO
{
    internal class Writer
    {
        /// <summary>
        /// Write to log.
        /// </summary>
        /// <param name="message">Message to write in log file.</param>
        public static void Write(string message)
        {
            string dt = DateTime.Now.ToLongTimeString() + " -> ";

            #if DEBUG

            Console.WriteLine(dt + message);

            #else

            string fileName = DateTime.Now.ToShortDateString().Replace("/", string.Empty);

            string[] lines = new string[] { dt + message };

            File.AppendAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"LOGS\PortoInfInterop-" + fileName + ".txt"), lines);

            #endif
        }
    }
}
