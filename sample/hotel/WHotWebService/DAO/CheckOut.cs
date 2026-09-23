using Newtonsoft.Json;
using PortoInf.Interop.DAO;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using WHotWebService.IO;

namespace WHotWebService.DAO
{
    internal class CheckOut
    {

        internal static async Task UpdateRemote()
        {
            Writer.Write("Start: Update Check Outs");

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

            Writer.Write("End: Update Check Outs");
        }

        internal static async Task UpdateLocal()
        {
            Writer.Write("Start: Update Payments");

            // Get a list of paid reservations
            List<Reservation> payedReservations = await CheckOut.GetPayedReservations();

            if (payedReservations.Count > 0)
            {
                // Process each paid reservation
                foreach (Reservation reservation in payedReservations)
                {
                    // Change the unit to the reservation's unit code
                    Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(reservation.Unit.Code);

                    foreach (var paymentHeader in reservation.PaymentHeader)
                    {

                        Guest invoiceGuest = null;

                        switch (paymentHeader.EntityType)
                        {
                            case 0:
                                // Entity Type: Company
                                Writer.Write("Entity Type: Company");

                                // Load the guest based on the entity code
                                invoiceGuest = Guest.LoadGuestByCode(paymentHeader.EntityCode, true);

                                // Update the guest's NIF (VAT number)
                                invoiceGuest.NIF = paymentHeader.VatNumber;

                                // Save or update the guest
                                invoiceGuest.SaveOrUpdate(true);
                                break;
                            case 1:
                                // Entity Type: Guest
                                Writer.Write("Entity Type: Guest");

                                // Load the guest based on the entity code
                                invoiceGuest = Guest.LoadGuestByCode(paymentHeader.EntityCode, false);

                                // Update the guest's NIF (VAT number)
                                invoiceGuest.NIF = paymentHeader.VatNumber;

                                // Save or update the guest
                                invoiceGuest.SaveOrUpdate(false);
                                break;
                            case 2:
                                // Entity Type: Final Consumer
                                Writer.Write("Entity Type: Final Consumer");

                                // Load the guest based on the entity code
                                invoiceGuest = Guest.LoadGuestByCode(paymentHeader.EntityCode, false);
                                break;
                            case 3:
                                // Entity Type: New Company
                                Writer.Write("Entity Type: ?New Company");

                                // Get the third-party based on the entity code
                                var terceiro = Wintouch.Hotel.Businesstier.Terceiros.GetItem(paymentHeader.EntityCode);

                                if (terceiro == null)
                                {
                                    Writer.Write("Entity Type: New Company");
                                    
                                    // Create a new guest
                                    Guest newGuest = new Guest()
                                    {
                                        Name = paymentHeader.Name,
                                        Address1 = paymentHeader.Address,
                                        ZipCode = paymentHeader.ZipCode,
                                        City = paymentHeader.Local,
                                        NIF = paymentHeader.VatNumber.Replace(" ", "")
                                    };

                                    // Create a new guest
                                    newGuest.SaveOrUpdate(true);

                                    // Assign the new guest to invoiceGuest
                                    invoiceGuest = Guest.LoadGuestByCode(newGuest.Code, true); ;
                                }
                                else
                                {
                                    Writer.Write("Entity Type: Existing Company");

                                    // Assign the existing guest to invoiceGuest
                                    invoiceGuest = Guest.LoadGuestByCode(invoiceGuest.Code, true);
                                }
                                break;
                        }

                        // Change the invoice account for the reservation
                        Reservation.ChangeInvoiceAccount(invoiceGuest, reservation);

                        // Update the checkout observation for the reservation
                        Reservation.UpdateCheckOutObs(reservation.Unit.Code, reservation.Number, reservation.Line, reservation);

                        // Set the payment as integrated for the reservation
                        await Reservation.SetPaymentIntegrated(reservation);
                    }

                }
            }
        
            Writer.Write("End: Update Payments");
        }

        internal static void SendReservationInfo(string unit, string reservation_code, int reservation_line)
        {
            // Change unit
            Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(unit);

            // Get reservation
            var reservation = Wintouch.Hotel.Businesstier.Reservas.GetItem(reservation_code, reservation_line);

            // Run Night Audit
            Wintouch.Hotel.Businesstier.NightAudit.ProcessaNightAudit(reservation.codigo, reservation.linhareserva, reservation.checkin, reservation.checkout, true, Wintouch.Hotel.Businesstier.ContasLinhas.NightAuditEnum.NightAuditEspecial);

            // Load Reservation accounting
            var reservation_rows = Wintouch.Hotel.Businesstier.Contas.GetListLinhasByReserva(reservation.codigo, reservation.linhareserva);

            // Create Account
            var invoice = new Invoice();

            // Sum total
            decimal valueToPay = 0;
            foreach (Wintouch.Hotel.DataTier.DsContasLinhas.whotcontaslinhasRow item in reservation_rows.whotcontaslinhas.Rows)
            {

                valueToPay += item.valorlinha;

                // Build Rows
                invoice.AddInvoiceRow(item.linha, item.quarto, item.descricao, item.qtdfacturada, item.valorunitario);
            }

            // Build Header
            // account.AddAccountHeaderInfo(reservation_code, valueToPay);


            // Send Account to webServer
            var client = new HttpClient();

            var data = JsonConvert.SerializeObject(invoice);

            var body = new StringContent(data, Encoding.UTF8, "application/json");

            //var response = client.GetAsync(Config.API_URL + "/url").Result;


            Console.WriteLine(body);


        }


        /// <summary>
        /// 
        /// </summary>
        /// <param name="unit">Unidade</param>
        /// <param name="reservation_code"></param>
        /// <param name="reservation_line"></param>
        internal static void GetPending(string unit, string reservation_code, int reservation_line, bool checkOut = false)
        {

            Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(unit);

            //var res = Wintouch.Hotel.Businesstier.Reservas.EfectuaCheckOutAlojamento();
            var reservation = Wintouch.Hotel.Businesstier.Reservas.GetItem(reservation_code, reservation_line);


            Wintouch.Hotel.Businesstier.NightAudit.ProcessaNightAudit(reservation.codigo, reservation.linhareserva, reservation.checkin, reservation.checkout, true, Wintouch.Hotel.Businesstier.ContasLinhas.NightAuditEnum.NightAuditEspecial);
            var reservation_rows = Wintouch.Hotel.Businesstier.Contas.GetListLinhasByReserva(reservation.codigo, reservation.linhareserva);
            //Wintouch.Hotel.Businesstier.NightAudit.ProcessaNightAudit("30640", 1, true, true, ContasLinhas.NightAuditEnum.NightAuditEspecial);

            //Wintouch.Hotel.Businesstier.Contas.TemContasAbertas


            //Wintouch.Hotel.Businesstier.Contas.SaveDocumento();

            decimal valueToPay = 0;

            foreach (Wintouch.Hotel.DataTier.DsContasLinhas.whotcontaslinhasRow item in reservation_rows.whotcontaslinhas.Rows)
            {
                valueToPay += item.valorlinha;
            }

            if (checkOut)
            {
                // Wintouch.Hotel.Businesstier.Reservas.EfectuaCheckOutAlojamento(reservation.codigo, reservation.linhareserva, true, true, false);
            }


            //Wintouch.Hotel.DataTier.DsLiquidacoes liq = Wintouch.Hotel.Businesstier.Liquidacoes.Get


            //Wintouch.Hotel.Businesstier.DocCab.CriaDocFacturacaoArgs args = new Wintouch.Hotel.Businesstier.DocCab.CriaDocFacturacaoArgs
            //{
            //    TipoDocumento = Wintouch.Hotel.Businesstier.DocCab.TipoDocVendaEnum.VendaDinheiro,
            //    dsRegularizacoesRecibosHotelResult = 
            //    dsContasLinhas = reservation_rows
            //};






            //bool created = Wintouch.Hotel.Businesstier.DocCab.CriaDocumentoFacturacao(args);

            //Wintouch.Comercial.BusinessTier.DocumentStandard Document = new Wintouch.Comercial.BusinessTier.DocumentStandard();
            ////.... Header
            //Document.DocumentHeader.TipoDoc =   Wintouch.Hotel.Businesstier.Settings.Current.docvd;

            ////Document.DocumentHeader.Serie = Wintouch.Comercial.BusinessTier.Settings.CurrentPosto.SerieDocVD;
            //Document.DocumentHeader.Serie = 2;
            //Document.DocumentHeader.NumDoc = -1;
            //Document.DocumentHeader.DataDoc = DateTime.Now.Date;
            //Document.DocumentHeader.Moeda = Wintouch.Comercial.BusinessTier.Settings.Current.MoedaBase;
            ////..... Rows
            //Wintouch.Comercial.Datatier.DsDocLinhas.wGCDocLinhasRow Row;
            //Row = Document.AddDocumentDetail("A001", 99, 10m);
            //Row.Linha = 0;
            //Row = Document.AddDocumentDetail("A001", 88, 9m);
            //Row.Linha = 1;
            ////..... Save
            //Document.RecalcTotals();

            ////..... Payments
            //Wintouch.Comercial.Datatier.DsPagamentos.wGCPagamentosRow Payment = Document.DocumentPagamentos.CreateNewRow();
            //Payment.TipoDoc = Document.DocumentHeader.TipoDoc;
            //Payment.Serie = Document.DocumentHeader.Serie;
            //Payment.NumDoc = Document.DocumentHeader.NumDoc;
            //Payment.meiopagamento = "NUM";
            //Payment.Total = Document.TotalAPagar;

            ////..... Add payment row to document
            //Document.DocumentPagamentos.wGCPagamentos.AddwGCPagamentosRow(Payment);

            //Document.Save();




            //Console.WriteLine("Valor a pagar: " + valueToPay.ToString("0.00") + " Eur.");

        }

        internal static async Task<List<Reservation>> GetReservationsNoInvoiceAsync()
        {
            Writer.Write("Start: Get Reservations no invoice");

            try
            {
                var client = new HttpClient();

                var response = client.GetAsync(Config.API_URL + "/checkout/with-no-invoice-list").Result;

                if (response.IsSuccessStatusCode)
                {
                    var responseStr = await response.Content.ReadAsStringAsync();

                    var responseMessage = JsonConvert.DeserializeObject<List<Reservation>>(responseStr);

                    Writer.Write($"Found: {responseMessage.Count} new reservations with no invoice.");

                    return responseMessage;
                }
                else
                {
                    var responseErrorStr = await response.Content.ReadAsStringAsync();
                    var responseErrorModel = new { error = string.Empty };

                    var responseErrorMessage = JsonConvert.DeserializeAnonymousType(responseErrorStr, responseErrorModel);

                    Writer.Write($"Error: getting checkout/with-no-account-list");
                }
            }
            catch (Exception)
            {
                Writer.Write($"Error: getting checkout/with-no-account-list");
            }

            Writer.Write("End: Get Reservations no invoice");

            return new List<Reservation>();
        }

        internal static List<Reservation> NightAudit(List<Reservation> resNoInvoice)
        {
            Console.WriteLine("Start: Night audit");

            // Set up reservations return list
            var retLst = new List<Reservation>();

            foreach (var _reservation in resNoInvoice)
            {

                Console.WriteLine($"Processing reservation {_reservation.Number}|{_reservation.Line} from {_reservation.Unit.Name}.");

                // Change hotel unit
                Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(_reservation.Unit.Code);

                // Check if hotel unit date is updated
                if (DateTime.Now.Day == Wintouch.Hotel.Businesstier.Settings.DataHotel.Day)
                {
                    // Load reservation
                    var reservation = Wintouch.Hotel.Businesstier.Reservas.GetItem(_reservation.Number, _reservation.Line);

                    // Set conditions where reservation will be ignored
                    if (
                        (reservation.codigoagencia != null && reservation.codigoagencia != String.Empty)
                        || (reservation.codigogrupo != null && reservation.codigogrupo != string.Empty)
                        || (reservation.codigooperador != null && reservation.codigooperador != string.Empty)
                        )
                    {
                        Console.WriteLine($"Error: Processing reservation {_reservation.Number}|{_reservation.Line} from {_reservation.Unit.Name} 3rd party found.");
                        continue;
                    }

                    // Run night Audit for reservation
                    Wintouch.Hotel.Businesstier.NightAudit.ProcessaNightAudit(reservation.codigo,
                                reservation.linhareserva,
                                reservation.checkin,
                                reservation.checkout,
                                true,
                                Wintouch.Hotel.Businesstier.ContasLinhas.NightAuditEnum.NightAuditEspecial);

                    // Get reservation account rows
                    var reservation_rows = Wintouch.Hotel.Businesstier.Contas.GetListLinhasByReserva(reservation.codigo, reservation.linhareserva);

                    // Create Acount for reservation
                    _reservation.Invoice = new Invoice();

                    // Init total to pay
                    decimal _valueToPay = 0;

                    // calc value for each row
                    foreach (Wintouch.Hotel.DataTier.DsContasLinhas.whotcontaslinhasRow item in reservation_rows.whotcontaslinhas.Rows)
                    {
                        // sum row value
                        _valueToPay += item.valorlinha - (item.qtdfacturada * item.valorunitario);

                        // Add positive rows to details not deleted
                        if (item.valorunitario > 0 && item.motivoanulacao == String.Empty)
                        {
                            _reservation.Invoice.AddInvoiceRow(item.linha, item.encargo, item.package != ""
                                ? item.quarto + " " + item.data.ToString("yyyy-MM-dd")
                                : item.encargo,
                                item.qtd,
                                item.valorunitario);
                        }
                    }

                    // Add account Header
                    _reservation.Invoice.AddInvoiceHeader(_valueToPay);

                    // Add reservation to return list
                    retLst.Add(_reservation);
                }
                else
                {
                    Console.WriteLine($"Error: Hotel data not updated {Wintouch.Hotel.Businesstier.Settings.DataHotel.ToString("yyyy-MM-dd")}");
                }
            }

            Console.WriteLine("End: Night audit");

            // Return reservations list
            return retLst;
        }

        internal static async Task SendInvoicesAsync(List<Reservation> resWithAccount)
        {
            Console.WriteLine("Start: SendInvoicesAsync");


            foreach (Reservation reservation in resWithAccount)
            {
                // Set request
                var data = JsonConvert.SerializeObject(reservation);
                var body = new StringContent(data, Encoding.UTF8, "application/json");

                try
                {
                    var client = new HttpClient();
                    // POST request and get Response
                    var response = client.PostAsync(Config.API_URL + "/checkout/invoice", body).Result;

                    // Success / fail handler
                    if (response.IsSuccessStatusCode)
                    {
                        var responseStr = await response.Content.ReadAsStringAsync();
                        var responseModel = new { message = string.Empty };

                        var responseMessage = JsonConvert.DeserializeAnonymousType(responseStr, responseModel);

                        Writer.Write($"Success: Reservation invoice updated {reservation.Number} / {reservation.Line}");

                    }
                    else
                    {
                        var responseErrorStr = await response.Content.ReadAsStringAsync();
                        var responseErrorModel = new { error = string.Empty };

                        var responseErrorMessage = JsonConvert.DeserializeAnonymousType(responseErrorStr, responseErrorModel);

                        Writer.Write($"Error: Invalid Reservation invoice data {reservation.Number} / {reservation.Line} {responseErrorMessage.error}");
                    }
                }
                catch (Exception ex)
                {
                    Writer.Write($"Error: Invalid Reservation invoice data {reservation.Number} / {reservation.Line} {ex.Message}");
                }
            }

            Console.WriteLine("End: SendInvoicesAsync");
        }

        internal static async Task<List<Reservation>> GetPayedReservations()
        {
            var client = new HttpClient();

            var response = client.GetAsync(Config.API_URL + "/checkout/payed").Result;

            // Success / fail handler
            if (response.IsSuccessStatusCode)
            {
                var responseStr = await response.Content.ReadAsStringAsync();

                var responseMessage = JsonConvert.DeserializeObject<List<Reservation>>(responseStr);

                //Writer.Write($"Success: List ok");

                return responseMessage;
            }
            else
            {
                var responseErrorStr = await response.Content.ReadAsStringAsync();
                var responseErrorModel = new { error = string.Empty };

                var responseErrorMessage = JsonConvert.DeserializeAnonymousType(responseErrorStr, responseErrorModel);

                //Writer.Write($"Error: getting checkout/payed " + responseErrorMessage.error);

                return new List<Reservation>();
            }
        }


    }
}
