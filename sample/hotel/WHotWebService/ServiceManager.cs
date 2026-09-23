using PortoInf.Interop.DAO;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Timers;
using Topshelf.Options;
using WHotWebService.DAO;
using WHotWebService.Extentions;
using WHotWebService.IO;

namespace WHotWebService
{
    internal class ServiceManager
    {
        private Timer _timer;
        private int _delay = 1000;

        public ServiceManager()
        {
            ServicePointManager.Expect100Continue = true;
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Init();
        }

        private async void Init()
        {

            if (await Config.LoadAsync() && WHotel.Start())
            {
                // Every 5 minute
                _timer = new Timer(_delay)
                {
                    AutoReset = true
                };

                _timer.Elapsed += ExecuteEvent;

            }
            else
            {
                Writer.Write("Error: Can't start Wintouch");
            }

        }


        private async void ExecuteEvent(object sender, ElapsedEventArgs e)
        {
            _timer.Stop();
            _delay = 60000 *5;
            _timer.Interval = _delay;

            try
            {
                if (await Ping.CheckAsync())
                {
                    Writer.Write("----------------------------------------------------------------------");
                    await Unit.UpdateRemote();
                    Writer.Write("----------------------------------------------------------------------");
                    await Guest.UpdateRemote();
                    Writer.Write("----------------------------------------------------------------------");
                    await Reservation.UpdateRemote();
                    Writer.Write("----------------------------------------------------------------------");
                    await CheckIn.UpdateLocal();
                    Writer.Write("----------------------------------------------------------------------");
                    //await CheckOut.UpdateLocal();
                    //Writer.Write("----------------------------------------------------------------------");
                    //await CheckOut.UpdateRemote();
                    //Writer.Write("----------------------------------------------------------------------");
                    Writer.Write("All jobs ended.");
                }
                else
                {
                    Writer.Write("Server is offline");
                }
            }
            catch (Exception ex)
            {
                Writer.Write("Error: " + ex.Message);
            }

            _timer.Start();
        }


        // done plz check
        private async void GetCheckIns()
        {
            List<Reservation> resLst = await Reservation.GetNewCheckinsAsync();
            await Reservation.AddOrUpdateNewCheckInsAsync(resLst);
        }

        /// <summary>
        /// Post new Checkouts
        /// </summary>
        /// <returns></returns>
        private async Task PostCheckOutsToPayAsync()
        {
            Writer.Write("Start: PostCheckOutsToPayAsync Job");

            // Get reservations with no accounts
            List<Reservation> resNoInvoice = await CheckOut.GetReservationsNoInvoiceAsync();

            // Check if there is any reservation with no account
            if (resNoInvoice.Count > 0)
            {
                // Run nightAudit for reservations
                List<Reservation> reservationsWithInvoices = CheckOut.NightAudit(resNoInvoice);
                // Send Accounts
                await CheckOut.SendInvoicesAsync(reservationsWithInvoices);
            }

            Writer.Write("End: PostCheckOutsToPayAsync Job");
        }

        private async Task GetCheckOutsPayedAsync()
        {
            List<Reservation> payedReservations = await CheckOut.GetPayedReservations();

            if (payedReservations.Count > 0)
            {
                foreach (Reservation reservation in payedReservations)
                {
                    Reservation.UpdateCheckOutObs(reservation.Unit.Code, reservation.Number, reservation.Line, reservation);
                    Reservation.UpdateEntityInLines(reservation.Unit.Code, reservation.Number, reservation.Line, reservation);

                    await Reservation.SetPaymentIntegrated(reservation);
                }
            }
        }


        public void Stop()
        {
            _timer.Stop();
        }
        public void Start()
        {
            _timer.Start();
        }
    }
}
