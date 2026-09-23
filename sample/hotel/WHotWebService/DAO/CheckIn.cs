using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using WHotWebService.DAO;
using WHotWebService.IO;

namespace PortoInf.Interop.DAO
{
    internal class CheckIn
    {

        public static async Task UpdateLocal()
        {
            Writer.Write("Start: Update checkins");

            var ckinLst = await Reservation.GetNewCheckinsAsync();
            await Reservation.AddOrUpdateNewCheckInsAsync(ckinLst);

            Writer.Write("End: Update checkins");
        }

    }
}
