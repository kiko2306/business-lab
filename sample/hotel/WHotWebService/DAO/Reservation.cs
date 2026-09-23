using Newtonsoft.Json;
using WHotWebService.IO;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using PortoInf.Interop.DAO;
using WHotWebService.Extentions;
//using Wintouch.Hotel.Businesstier;
using System.Linq;

namespace WHotWebService.DAO
{
    internal class Reservation
    {
        [JsonProperty("unit")] public Unit Unit { get; set; }

        [JsonProperty("number")] public string Number { get; set; }

        [JsonProperty("line")] public int Line { get; set; }

        [JsonProperty("guest")] public Guest Guest { get; set; }

        [JsonProperty("company")] public Guest Company { get; set; }

        [JsonProperty("room_code")] public string RoomCode { get; set; }

        [JsonProperty("room_name")] public string RoomName { get; set; }

        [JsonProperty("adults")] public int Adults { get; set; }

        [JsonProperty("children")] public int Children { get; set; }

        [JsonProperty("babies")] public int Babies { get; set; }

        [JsonProperty("checkin")] public DateTime CheckIn { get; set; }

        [JsonProperty("checkout")] public DateTime CheckOut { get; set; }

        [JsonProperty("status")] public string Status { get; set; }

        [JsonProperty("channel")] public string Channel { get; set; }

        [JsonProperty("extras")] public List<Guest> Extras { get; set; }

        [JsonProperty("uuid")] public string UUID { get; set; }

        [JsonProperty("account")] public Invoice Invoice { get; set; }

        [JsonProperty("invoice_header")] internal InvoiceHeader InvoiceHeader { get; set; }

        [JsonProperty("payment_header")] internal List<PaymentHeader> PaymentHeader { get; set; }

        internal static async Task UpdateRemote()
        {
            Writer.Write("Start: Update reservations");

            var reservations = GetList();

            var splitLst = ListExtensions.ChunkBy(reservations, 100);

            foreach (var reservation in splitLst)
            {
                await Reservation.SendReservationsAsync(reservation);
            }

            Writer.Write("End: Update reservations");
        }

        private static List<Reservation> GetList()
        {
            var retLst = new List<Reservation>();

            var checkinStartDate = DateTime.Now.Date;
            var checkinEndDate = DateTime.Now.AddDays(7.0).Date;

            var unitLst = Wintouch.Hotel.Businesstier.Unidades.Unidades;

            foreach (var unit in unitLst)
            {
                Writer.Write($"Search for Check in from {checkinStartDate} to {checkinEndDate} : {unit}");

                Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(unit);

                Wintouch.Hotel.Businesstier.Reservas.Filtro.Reset();
                Wintouch.Hotel.Businesstier.Reservas.Filtro.AddFilterRow("checkin", checkinStartDate, Wintouch.Core.Data.enumfilteropers.GreaterOrEqual);
                Wintouch.Hotel.Businesstier.Reservas.Filtro.AddFilterRow("checkin", checkinEndDate, Wintouch.Core.Data.enumfilteropers.LessOrEqual);
                var res = Wintouch.Hotel.Businesstier.Reservas.GetList();

                foreach (Wintouch.Hotel.DataTier.DsReservas.whotreservasRow reservation in res.whotreservas.Rows)
                {
                    retLst.Add(new Reservation
                    {
                        Unit = new Unit { Code = reservation.unidade },
                        Number = reservation.codigo,
                        Line = reservation.linhareserva,
                        Guest = new Guest { Code = reservation.codigohospede },
                        Company = new Guest { Code = reservation.codigoempresa },
                        RoomCode = reservation.quarto,
                        RoomName = Room.GetName(reservation.quarto),
                        Adults = reservation.nradultos,
                        Children = reservation.nrcriancas,
                        Babies = reservation.nrbercos,
                        CheckIn = reservation.checkin,
                        CheckOut = reservation.checkout,
                        Status = reservation.tiporeserva,
                        Channel = reservation.canaldistrib,
                        Extras = GetExtras(reservation.unidade, reservation.codigo, reservation.linhareserva),
                    });
                }
            }

            var checkoutStartDate = DateTime.Now.Date.AddDays(-7.0).Date;
            var checkoutEndDate = DateTime.Now.Date.AddDays(1).Date;

            foreach (var unit in unitLst)
            {
                Writer.Write($"Search for Check out from {checkoutStartDate} to {checkoutEndDate} : {unit}");

                Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(unit);

                Wintouch.Hotel.Businesstier.Reservas.Filtro.Reset();
                Wintouch.Hotel.Businesstier.Reservas.Filtro.AddFilterRow("checkout", checkoutStartDate, Wintouch.Core.Data.enumfilteropers.GreaterOrEqual);
                Wintouch.Hotel.Businesstier.Reservas.Filtro.AddFilterRow("checkout", checkoutEndDate, Wintouch.Core.Data.enumfilteropers.LessOrEqual);
                var res = Wintouch.Hotel.Businesstier.Reservas.GetList();

                foreach (Wintouch.Hotel.DataTier.DsReservas.whotreservasRow reservation in res.whotreservas.Rows)
                {
                    var reservationToAdd = new Reservation
                    {
                        Unit = new Unit { Code = reservation.unidade },
                        Number = reservation.codigo,
                        Line = reservation.linhareserva,
                        Guest = new Guest { Code = reservation.codigohospede },
                        Company = new Guest { Code = reservation.codigoempresa },
                        RoomCode = reservation.quarto,
                        RoomName = Room.GetName(reservation.quarto),
                        Adults = reservation.nradultos,
                        Children = reservation.nrcriancas,
                        Babies = reservation.nrbercos,
                        CheckIn = reservation.checkin,
                        CheckOut = reservation.checkout,
                        Status = reservation.tiporeserva,
                        Channel = reservation.canaldistrib,
                        Extras = GetExtras(reservation.unidade, reservation.codigo, reservation.linhareserva),
                    };

                    if (!retLst.Exists(x => x.Unit.Code == reservationToAdd.Unit.Code && x.Number == reservationToAdd.Number && x.Line == reservationToAdd.Line))
                    {
                        retLst.Add(reservationToAdd);
                    }

                }
            }

            return retLst;
        }

        /// <summary>
        /// Sends a list of reservations to API
        /// </summary>
        /// <param name="reservations"></param>
        /// <returns></returns>
        private static async Task SendReservationsAsync(List<Reservation> reservations)
        {
            try
            {
                Writer.Write($"Sending {reservations.Count} reservations");

                using (var client = new HttpClient())
                {
                    var data = JsonConvert.SerializeObject(reservations);
                    var content = new StringContent(data, Encoding.UTF8, "application/json");

                    var response = await client.PostAsync(Config.API_URL + "/reservations", content);

                    // Success / fail handler
                    if (response.IsSuccessStatusCode)
                    {
                        await response.Content.ReadAsStringAsync();
                        Writer.Write($"Success: {reservations.Count} reservations updated");
                    }
                    else
                    {
                        Writer.Write($"Error: Sending reservations - {response.StatusCode} {response.ReasonPhrase}");
                    }
                }
            }
            catch (HttpRequestException ex)
            {
                Writer.Write($"Error: {ex.Message}");
            }
        }


        private static List<Guest> GetExtras(string unidade, string codigo, int linhareserva)
        {
            var retList = new List<Guest>();

            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.Reset();
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("unidade", unidade);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("codigoreserva", codigo);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("linhareserva", linhareserva);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("tipo", 0);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("ishospedeprincipal", 0);

            var extras = Wintouch.Hotel.Businesstier.ReservasEntidades.GetList();

            foreach (Wintouch.Hotel.DataTier.DsReservasEntidades.whotreservasentidadesRow extra in extras.whotreservasentidades.Rows)
            {
                retList.Add(new Guest
                {
                    Code = extra.codigo,
                });
            }

            return retList;
        }

        internal static async Task<List<Reservation>> GetNewCheckinsAsync()
        {
            Writer.Write("Get Checkins list");

            var client = new HttpClient();

            var response = client.GetAsync(Config.API_URL + "/checkin-complete").Result;

            var responseStr = await response.Content.ReadAsStringAsync();

            var responseObj = JsonConvert.DeserializeObject<List<Reservation>>(responseStr);

            Writer.Write($"Found {responseObj.Count} new checkins");

            return responseObj;
        }

        internal static async Task AddOrUpdateNewCheckInsAsync(List<Reservation> resLst)
        {
            Writer.Write("Updating local check-ins");

            foreach (var reservation in resLst)
            {
                var guestToSave = new List<Guest>();

                // setup api response
                var data = JsonConvert.SerializeObject(new
                {
                    uuid = reservation.UUID,
                });

                var body = new StringContent(data, Encoding.UTF8, "application/json");
                var client = new HttpClient();

                // skip tests
                if (int.Parse(reservation.Number) < 0)
                {
                    var response = client.PostAsync(Config.API_URL + "/checkin/success", body).Result;
                    await response.Content.ReadAsStringAsync();
                    Writer.Write($"Test Check-in ignored {reservation.Number}");
                    continue;
                }

                // add primary guest to list
                guestToSave.Add(reservation.Guest);

                // add extra guests to list
                foreach (var extra in reservation.Extras)
                {
                    guestToSave.Add(extra);
                }

                try
                {
                    // save data
                    foreach (var guest in guestToSave)
                    {
                        guest.SaveOrUpdate();

                        // chenge unit
                        Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(reservation.Unit.Code);

                        // filter
                        Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.Reset();
                        Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("unidade", reservation.Unit.Code);
                        Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("codigoreserva", reservation.Number);
                        Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("linhareserva", reservation.Line);
                        Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("tipo", 0);

                        // get data
                        var lst = Wintouch.Hotel.Businesstier.ReservasEntidades.GetList();

                        // create empty data row
                        Wintouch.Hotel.DataTier.DsReservasEntidades.whotreservasentidadesRow newLine = null;

                        // check if line exists
                        foreach (Wintouch.Hotel.DataTier.DsReservasEntidades.whotreservasentidadesRow line in lst.whotreservasentidades.Rows)
                        {
                            if (line.codigo == guest.Code)
                            {
                                newLine = line;
                            }
                        }

                        if (newLine == null)
                        {
                            // insert extra
                            using (Wintouch.Hotel.DataTier.DsReservasEntidades dsReservasEntidades = new Wintouch.Hotel.DataTier.DsReservasEntidades())
                            {
                                newLine = dsReservasEntidades.CreateNewRow();
                                dsReservasEntidades.whotreservasentidades.Rows.Add(newLine);
                                newLine.unidade = reservation.Unit.Code;
                                newLine.codigoreserva = reservation.Number;
                                newLine.linhareserva = reservation.Line;
                                newLine.codigo = guest.Code;
                            }
                        }

                        newLine.GrupoEtario = byte.Parse(guest.Type.ToString());

                        Wintouch.Hotel.Businesstier.ReservasEntidades.Save(ref newLine);
                    }

                    // Update checkin obs
                    UpdateCheckInObs(reservation.Unit.Code, reservation.Number, reservation.Line, reservation.Extras.Count + 1);

                    // send success
                    var response = client.PostAsync(Config.API_URL + "/checkin/success", body).Result;
                    var responseStr = await response.Content.ReadAsStringAsync();
                }
                catch
                {
                    // send error
                    var response = client.PostAsync(Config.API_URL + "/checkin/fail", body).Result;
                    //var responseStr = await response.Content.ReadAsStringAsync();
                }
            }

            Writer.Write("Updating local check-ins END");
        }

        private static void UpdateCheckInObs(string uni, string code, int lres, int count)
        {
            var reservation = Wintouch.Hotel.Businesstier.Reservas.GetItem(code, lres, uni);
            var oldText = reservation.observacoes;
            reservation.observacoes = "***** Checkin Online efectuado *****"
                + Environment.NewLine
                + "Numero de Hospedes: " + count
                + Environment.NewLine
                + Environment.NewLine
                + oldText;
            reservation.AvisarObservacoes = 1;

            Wintouch.Hotel.Businesstier.Reservas.Save(ref reservation);
        }

        public static void UpdateCheckOutObs(string uni, string code, int lres, Reservation _reservation)
        {
            var reservationOri = Wintouch.Hotel.Businesstier.Reservas.GetItem(code, lres, uni);
            var oldText = reservationOri.observacoes;

            foreach (var payment in _reservation.PaymentHeader)
            {
                var type = "";

                switch (payment.EntityType)
                {
                    case 0:
                        type = "Empresa";
                        break;
                    case 1:
                        type = "Hóspede";
                        break;
                    case 2:
                        type = "Consumidor Final";
                        break;
                    default:
                        break;
                }

                reservationOri.observacoes = "***** Pagamento Online efectuado *****"
                    + Environment.NewLine
                    + "Valor Pago: " + payment.Total + " €"
                    + Environment.NewLine
                    + "Meio Pagamento: " + payment.PaymentMethod
                    + Environment.NewLine
                    + "Data Pagamento: " + payment.PaymentDateTime.ToString()
                    + Environment.NewLine
                    + "Dados de Facturação: " + type + " " + payment.EntityCode
                     + Environment.NewLine
                    + "................................."
                    + Environment.NewLine
                    + oldText;



                reservationOri.AvisarObservacoes = 1;

                Wintouch.Hotel.Businesstier.Reservas.Save(ref reservationOri);
            }

        }

        internal static async Task SetPaymentIntegrated(Reservation payment)
        {
            var client = new HttpClient();

            List<object> payedIds = new List<object>();
            foreach (var paymentSuccess in payment.PaymentHeader)
            {
                payedIds.Add(new
                {
                    id = paymentSuccess.Id,
                });
            }

            var data = JsonConvert.SerializeObject(payedIds);

            var body = new StringContent(data, Encoding.UTF8, "application/json");

            var response = client.PostAsync(Config.API_URL + "/checkout/set-integrated", body).Result;

            // Success / fail handler
            if (response.IsSuccessStatusCode)
            {
                await response.Content.ReadAsStringAsync();

                Writer.Write($"Success:  Reservation {payment.Number} | {payment.Line} set as payed");

            }
            else
            {
                Writer.Write($"Error: Reservation {payment.Number} | {payment.Line} not set as payed");
            }
        }

        internal static void UpdateEntityInLines(string code, string number, int line, Reservation reservation)
        {
            // test

            /**
             * update entity from data collected from server
             * select * from guests
             * let * from guests with all info 
             */

        }

        internal static void ChangeInvoiceAccount(Guest guest, Reservation reservation)
        {
            var dsContas = Wintouch.Hotel.Businesstier.Contas.GetListContasAbertas(DateTime.Now, reservation.Number, reservation.Line);


            var cnt = dsContas.whotcontas.FirstOrDefault(item => item.entidade == guest.Code);

            if (cnt == null)
            {
                var res = Wintouch.Hotel.Businesstier.Reservas.GetItem(reservation.Number, reservation.Line);
                res.codigoempresa = guest.Code;
                Wintouch.Hotel.Businesstier.Reservas.Save(ref res);

                Wintouch.Hotel.Businesstier.Contas.CriaConta(guest.Code, reservation.Number, reservation.Line);
                dsContas = Wintouch.Hotel.Businesstier.Contas.GetListContasAbertas(DateTime.Now, reservation.Number, reservation.Line);

                cnt = dsContas.whotcontas.FirstOrDefault(item => item.entidade == guest.Code);
            }


            Wintouch.Hotel.DataTier.DsContasLinhas dsContasLinhas = Wintouch.Hotel.Businesstier.Contas.GetListLinhasByReserva(reservation.Number, reservation.Line);

            var lst = new List<Wintouch.Hotel.Businesstier.ContasLinhas.DestinoTransferencia>
            {
                new Wintouch.Hotel.Businesstier.ContasLinhas.DestinoTransferencia
                {
                    DestinyReservationCode = reservation.Number,
                    DestinyReservationLine = reservation.Line,
                    HotelUnit = reservation.Unit.Code,
                    TipoDoc = cnt.tipodoc,
                    NumDoc = cnt.numdoc,
                    Serie = cnt.linhareserva,
                    Percentagem = 100,
                }
            };


            var done = Wintouch.Hotel.Businesstier.ContasLinhas.TransfereLinhas(dsContasLinhas, "teste", lst);

            Console.WriteLine("done: " + done);
        }
    }
}
