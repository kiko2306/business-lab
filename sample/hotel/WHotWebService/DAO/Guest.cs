using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using PortoInf.Interop;
using WHotWebService.IO;

namespace WHotWebService.DAO
{
    internal class Guest
    {
        [JsonProperty("code")] public string Code { get; set; }

        [JsonProperty("name")] public string Name { get; set; }

        [JsonProperty("last_name")] public string LastName { get; set; }

        [JsonProperty("address1")] public string Address1 { get; set; }

        [JsonProperty("address2")] public string Address2 { get; set; }

        [JsonProperty("address3")] public string Address3 { get; set; }

        [JsonProperty("zip_code")] public string ZipCode { get; set; }

        [JsonProperty("city")] public string City { get; set; }

        [JsonProperty("country")] public string Country { get; set; }

        [JsonProperty("phone")] public string Phone { get; set; }

        [JsonProperty("email")] public string Email { get; set; }

        [JsonProperty("nif")] public string NIF { get; set; }

        [JsonProperty("gender")] public byte Gender { get; set; }

        [JsonProperty("doc")] public byte Doc { get; set; }

        [JsonProperty("doc_number")] public string DocNumber { get; set; }

        [JsonProperty("doc_number_id_control")] public string DocNumberIdControl { get; set; }

        [JsonProperty("doc_date")] public DateTime DocDate { get; set; }

        [JsonProperty("doc_valid")] public DateTime DocValid { get; set; }

        [JsonProperty("doc_local")] public string DocLocal { get; set; }

        [JsonProperty("doc_country")] public string DocCountry { get; set; }

        [JsonProperty("doc_by")] public string DocBy { get; set; }

        [JsonProperty("birth_local")] public string BirthLocal { get; set; }

        [JsonProperty("birth_date")] public DateTime BirthDate { get; set; }

        [JsonProperty("nationality")] public string Nationality { get; set; }

        [JsonProperty("type")] public int Type { get; set; }


        /// <summary>
        /// Start Guests update process
        /// </summary>
        public static async Task UpdateRemote()
        {
            Writer.Write("Start Guests update process");

            UpdateStatus.Reset();

            List<List<Guest>> lst = GetNewGuestsSplit(Config.FirstConnection);

            foreach (List<Guest> guestsLst in lst)
            {
                await SendNewGuests(guestsLst);
            }

            Writer.Write("End: Guests update process");
        }

        /// <summary>
        /// Get list of new guests split by 1000
        /// </summary>
        /// <param name="all"></param>
        /// <returns></returns>
        private static List<List<Guest>> GetNewGuestsSplit(bool all = false)
        {
            Writer.Write("Loading new gests list");

            int n_guests = 100;

            var list = new List<List<Guest>>();

            // Filter not
            // guests
            if (all)
            {
                Writer.Write("Setup export type: all");
                SetAllGuestsNotExported();
            }
            else
            {
                Writer.Write("Setup export type: only new");
            }

            bool finish = false;

            int newGuestsFound = 0;

            while (!finish)
            {
                //Wintouch.Common.BusinessTier.Terceiros.Filtro.Reset();
                Wintouch.Hotel.Businesstier.Terceiros.Filtro.Reset();
                Wintouch.Hotel.Businesstier.Terceiros.Filtro.TopNRegs = n_guests;

                //Wintouch.Hotel.Businesstier.Terceiros.Filtro.AddFilterRow("exportado", 0);
                //Wintouch.Common.BusinessTier.Terceiros.Filtro.AddFilterRow("hospede", 1);
                Wintouch.Hotel.Businesstier.Terceiros.Filtro.AddFilterRow("(hospede='1' or grupohotel = 'EMP') AND exportado = 0");

                var guests = Wintouch.Hotel.Businesstier.Terceiros.GetList();

                if (guests.wgcterceiros.Rows.Count > 0)
                {
                    newGuestsFound += guests.wgcterceiros.Rows.Count;

                    var gestLst = new List<Guest>();

                    foreach (Wintouch.Hotel.DataTier.DsTerceiros.wgcterceirosRow guest in guests.wgcterceiros.Rows)
                    {

                        Guest newGuest = new Guest()
                        {
                            Code = guest.codigo,
                            Name = guest.nome,
                            Address1 = guest.morada1,
                            Address2 = guest.morada2,
                            Address3 = guest.morada3,
                            ZipCode = guest.codpostal,
                            City = guest.localpostal,
                            Country = guest.pais,
                            NIF = guest.ncontrib.Replace(" ", ""),
                            Phone = guest.telemovel,
                            Email = guest.email,
                            BirthDate = guest.dtnasc,
                            LastName = guest.apelido,
                            BirthLocal = guest.naturalidade,
                            Nationality = guest.nacionalidade,
                            Gender = guest.sexo,
                            Doc = guest.tipodocid,
                            DocNumber = guest.numdocid,
                            DocNumberIdControl = guest.docidcontrol,
                            DocDate = guest.dataemissaodocid,
                            DocValid = guest.datavalidadedocid,
                            DocLocal = guest.localemissaodocid,
                            DocBy = guest.emitidopordocid,
                            DocCountry = guest.paisemissordoc,
                            Type = guest.hospede
                        };

                        gestLst.Add(newGuest);

                        SetGestExported(newGuest);
                    }

                    list.Add(gestLst);

                    Writer.Write($"Adding a package of {gestLst.Count} Guests to export, total {newGuestsFound}");
                }
                else
                {
                    finish = true;
                }
            }

            UpdateStatus.Total = newGuestsFound;
            Writer.Write($"Found {newGuestsFound} new Guests");
            Writer.Write($"Exporting {list.Count} packages");

            // return JsonObj
            return list;
        }

        /// <summary>
        /// Send new guests to web server
        /// </summary>
        /// <param name="guestLst"></param>
        /// <returns></returns>
        private static async Task SendNewGuests(List<Guest> guestLst)
        {
            var client = new HttpClient();

            var data = JsonConvert.SerializeObject(guestLst);
            var body = new StringContent(data, Encoding.UTF8, "application/json");

            // POST request and get Response
            var response = client.PostAsync(Config.API_URL + "/guests", body).Result;

            if (response.IsSuccessStatusCode)
            {
                UpdateStatus.Updated += guestLst.Count;

                Writer.Write($"Success:Updated {UpdateStatus.Updated} | {UpdateStatus.Total} ");
            }
            else
            {
                var responseErrorStr = await response.Content.ReadAsStringAsync();
                var responseErrorModel = new { message = string.Empty };

                var responseErrorMessage = JsonConvert.DeserializeAnonymousType(responseErrorStr, responseErrorModel);

                Writer.Write($"Error: Saving new guest {responseErrorMessage.message}");
            }
        }

        /// <summary>
        /// Set guests export = 1
        /// </summary>
        /// <param name="gest"></param>
        private static void SetGestExported(Guest gest)
        {
            Wintouch.Core.Data.TransactionManager transactionManager = new Wintouch.Core.Data.TransactionManager();

            try
            {
                transactionManager.Begin();
                StringBuilder cmd = new StringBuilder();
                cmd.Append("UPDATE wgcterceiros SET exportado = 1").Append(" ");
                cmd.Append("WHERE codigo='").Append(gest.Code).Append("' ");
                Wintouch.Core.Data.CommandDirectSQL command = new Wintouch.Core.Data.CommandDirectSQL
                {
                    CommandText = cmd.ToString(),
                };
                command.Execute();
                transactionManager.Commit();
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                transactionManager.RollBack();
            }
        }

        /// <summary>
        /// Set all guests export = 0
        /// </summary>
        private static void SetAllGuestsNotExported()
        {
            Writer.Write("Start: Set all guests exportado = 0");

            Wintouch.Core.Data.TransactionManager transactionManager = new Wintouch.Core.Data.TransactionManager();

            try
            {
                transactionManager.Begin();
                StringBuilder cmd = new StringBuilder();
                cmd.Append("UPDATE wgcterceiros SET exportado = 0");
                Wintouch.Core.Data.CommandDirectSQL command = new Wintouch.Core.Data.CommandDirectSQL
                {
                    CommandText = cmd.ToString(),
                };
                command.Execute();
                transactionManager.Commit();

                Writer.Write("End: Set all guests exportado = 0");
            }
            catch (Exception ex)
            {
                Writer.Write($"Error: {ex.Message}");
                transactionManager.RollBack();
            }
        }

        public static Guest LoadGuestByCode(string code, bool isCompany)
        {

            Wintouch.Hotel.Businesstier.Terceiros.Filtro.Reset();

            var type = isCompany ? "EMP" : "DIR";

            var guest = Wintouch.Hotel.Businesstier.Terceiros.GetItem(code, type);

            return new Guest()
            {
                Code = guest.codigo,
                Name = guest.nome,
                Address1 = guest.morada1,
                Address2 = guest.morada2,
                Address3 = guest.morada3,
                ZipCode = guest.codpostal,
                City = guest.localpostal,
                Country = guest.pais,
                NIF = guest.ncontrib.Replace(" ", ""),
                Phone = guest.telemovel,
                Email = guest.email,
                BirthDate = guest.dtnasc,
                LastName = guest.apelido,
                BirthLocal = guest.naturalidade,
                Nationality = guest.nacionalidade,
                Gender = guest.sexo,
                Doc = guest.tipodocid,
                DocNumber = guest.numdocid,
                DocNumberIdControl = guest.docidcontrol,
                DocDate = guest.dataemissaodocid,
                DocValid = guest.datavalidadedocid,
                DocLocal = guest.localemissaodocid,
                DocBy = guest.emitidopordocid,
                DocCountry = guest.paisemissordoc,
                Type = guest.hospede
            };

        }

        /// <summary>
        /// Save new guest | update new guest
        /// </summary>
        public void SaveOrUpdate(bool isCompany = false)
        {
            var terceiro = Wintouch.Hotel.Businesstier.Terceiros.GetItem(this.Code);

            if (terceiro == null)
            {
                using (Wintouch.Hotel.DataTier.DsTerceiros dsTerceiros = new Wintouch.Hotel.DataTier.DsTerceiros())
                {
                    terceiro = dsTerceiros.CreateNewRow();
                    dsTerceiros.wgcterceiros.Rows.Add(terceiro);
                }
            }

            terceiro.codigo = (terceiro != null && !string.IsNullOrEmpty(terceiro.codigo)) ? this.Code : Wintouch.Hotel.Businesstier.Terceiros.GetProximoTerceiro(!isCompany);

            terceiro.nome = this.Name;
            terceiro.apelido = this.LastName;
            terceiro.morada1 = this.Address1;
            terceiro.morada2 = this.Address2;
            terceiro.morada3 = this.Address3;
            terceiro.codpostal = this.ZipCode;
            terceiro.localpostal = this.City;
            terceiro.ncontrib = this.NIF;

            if (!isCompany)
            {
                terceiro.pais = this.Country;
                terceiro.telemovel = this.Phone;
                terceiro.email = this.Email;
                terceiro.sexo = this.Gender;
                terceiro.tipodocid = this.Doc;
                terceiro.numdocid = this.DocNumber;
                terceiro.docidcontrol = this.DocNumberIdControl;
                terceiro.dataemissaodocid = this.DocDate;
                terceiro.datavalidadedocid = this.DocValid;
                terceiro.localemissaodocid = this.DocLocal;
                terceiro.paisemissordoc = this.DocCountry;
                terceiro.emitidopordocid = this.DocBy;
                terceiro.naturalidade = this.BirthLocal;
                terceiro.dtnasc = this.BirthDate;
                terceiro.nacionalidade = this.Nationality;
            }


            if (isCompany)
            {
                terceiro.hospede = 0;
                terceiro.grupohotel = "EMP";
            }
            else
            {
                terceiro.hospede = 1;
                terceiro.grupohotel = "DIR";
            }

            terceiro.Exportado = 0;
            terceiro.cliente = 1;
            this.Code = terceiro.codigo;

            try
            {
                Wintouch.Hotel.Businesstier.Terceiros.Save(ref terceiro);
            }
            catch (Exception ex)
            {
                Writer.Write($"Error saving guest {terceiro.nome} {terceiro.apelido}" + ex.Message.ToString());
            }

        }

    }
}
