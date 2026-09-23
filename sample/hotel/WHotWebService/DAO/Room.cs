using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace WHotWebService.DAO
{
    internal class Room
    {
        internal static string GetName(string _room)
        {
            var room = Wintouch.Hotel.Businesstier.Alojamento.GetAlojamentoInfo(_room);

            if (room == null)
            {
                return null;
            }

            return room.descricao;
        }
    }
}
