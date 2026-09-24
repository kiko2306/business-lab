using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace Hotel.Agent
{
    /// <summary>
    /// The four sync jobs (plan.md §620, §627, §639), ported from the
    /// legacy's Unit/Guest/Reservation DAOs (sample/hotel/WHotWebService/DAO)
    /// onto hotel-core's API instead of the legacy's own. Units, guests and
    /// reservations flow *out* of Wintouch; completed check-ins are the only
    /// thing that flows back — same direction, same order, as the legacy's
    /// own tick (ServiceManager.ExecuteEvent).
    ///
    /// Every call here goes through Wintouch's own business-tier API
    /// (Wintouch.Hotel.Businesstier.*), the same as the legacy — not a SQL
    /// connection string the way tally's ShopReader reads its restaurant
    /// tables. That is a deliberate departure from plan.md §629's original
    /// "reads via SQL" sketch: confirmed by reading the legacy source, its
    /// reads go through the same in-process API its writes do (including the
    /// guest `exportado` watermark, via Wintouch's own CommandDirectSQL
    /// rather than a plain SqlConnection), and this agent has no way to
    /// verify a fresh raw-SQL schema against the real database independently
    /// (that would be a live read against production hotel data, which this
    /// environment's own safety rails correctly refuse). Porting calls
    /// already proven in production is the lower-risk path.
    /// </summary>
    public sealed class HotelSync
    {
        private const int BatchSize = 100;

        private readonly ApiClient _api;
        private readonly string _firstRunMarkerPath;

        public HotelSync(ApiClient api, string stateDir)
        {
            _api = api;
            _firstRunMarkerPath = Path.Combine(stateDir, "guests-first-sync-done");
        }

        /// <summary>The units known to Wintouch right now — used by both the units and reservations jobs.</summary>
        private static List<string> LoadUnitCodes() => Wintouch.Hotel.Businesstier.Unidades.Unidades;

        public async Task SyncUnitsAsync()
        {
            var codes = LoadUnitCodes();
            var payload = codes.Select(code => new UnitPayload
            {
                Code = code,
                Name = Wintouch.Hotel.Businesstier.Unidades.GetItem(code).descricao,
            }).ToList();
            if (payload.Count == 0) return;

            var result = await _api.PushUnitsAsync(payload).ConfigureAwait(false);
            Writer.Write($"Units: {result.Saved} saved");
        }

        /// <summary>
        /// Guests due for export (`exportado = 0`), a page of `BatchSize` at
        /// a time. On the very first run ever, every guest is reset to
        /// `exportado = 0` first — hotel-core starts with none, so this is
        /// the only way it learns about anyone who stayed before the agent
        /// was enrolled (mirrors the legacy's `firstConnection` flag, but
        /// tracked locally rather than server-side, since §627 moved the
        /// agent to being told nothing it does not need to be).
        ///
        /// Unlike the legacy, a guest is only marked exported *after* a
        /// successful push, not before — every other sync job in this
        /// rebuild is safe to retry (plan.md §639), and marking first would
        /// silently drop a guest whose push failed on a network blip.
        /// </summary>
        public async Task SyncGuestsAsync()
        {
            if (!File.Exists(_firstRunMarkerPath))
            {
                ResetAllGuestsForExport();
                Directory.CreateDirectory(Path.GetDirectoryName(_firstRunMarkerPath)!);
                File.WriteAllText(_firstRunMarkerPath, DateTime.UtcNow.ToString("o"));
                Writer.Write("First run: every guest reset for a full export");
            }

            int totalSaved = 0;
            while (true)
            {
                Wintouch.Hotel.Businesstier.Terceiros.Filtro.Reset();
                Wintouch.Hotel.Businesstier.Terceiros.Filtro.TopNRegs = BatchSize;
                Wintouch.Hotel.Businesstier.Terceiros.Filtro.AddFilterRow("(hospede='1' or grupohotel = 'EMP') AND exportado = 0");
                var page = Wintouch.Hotel.Businesstier.Terceiros.GetList();
                if (page.wgcterceiros.Rows.Count == 0) break;

                var codes = new List<string>();
                var payload = new List<GuestPayload>();
                foreach (Wintouch.Hotel.DataTier.DsTerceiros.wgcterceirosRow g in page.wgcterceiros.Rows)
                {
                    codes.Add(g.codigo);
                    payload.Add(new GuestPayload
                    {
                        Code = g.codigo,
                        FirstName = g.nome,
                        LastName = g.apelido,
                        Email = g.email,
                        Phone = g.telemovel,
                        AddressLine1 = g.morada1,
                        AddressLine2 = g.morada2,
                        AddressLine3 = g.morada3,
                        PostalCode = g.codpostal,
                        City = g.localpostal,
                        Country = g.pais,
                        Nationality = g.nacionalidade,
                        TaxNumber = g.ncontrib?.Replace(" ", ""),
                        BirthDate = FormatDate(g.dtnasc),
                    });
                }

                var result = await _api.PushGuestsAsync(payload).ConfigureAwait(false);
                totalSaved += result.Saved;
                MarkGuestsExported(codes);
            }
            Writer.Write($"Guests: {totalSaved} saved");
        }

        private static void ResetAllGuestsForExport() => ExecuteDirectSql("UPDATE wgcterceiros SET exportado = 0");

        private static void MarkGuestsExported(List<string> codes)
        {
            // One statement for the whole page rather than one per guest —
            // the legacy issued a separate CommandDirectSQL per guest
            // (Guest.cs's SetGestExported), which is BatchSize round trips
            // this avoids.
            var quoted = string.Join(",", codes.Select(c => "'" + c.Replace("'", "''") + "'"));
            ExecuteDirectSql($"UPDATE wgcterceiros SET exportado = 1 WHERE codigo IN ({quoted})");
        }

        private static void ExecuteDirectSql(string sql)
        {
            var tx = new Wintouch.Core.Data.TransactionManager();
            try
            {
                tx.Begin();
                var command = new Wintouch.Core.Data.CommandDirectSQL { CommandText = sql };
                command.Execute();
                tx.Commit();
            }
            catch
            {
                tx.RollBack();
                throw;
            }
        }

        /// <summary>
        /// Two windows per unit — check-ins today..+7, check-outs -7..+1 —
        /// deduped on (unit, number, line), same as the legacy's
        /// Reservation.GetList(). hotel-core's own upsert (ingest.ts) is what
        /// actually protects `checkin_sent`/`checkin_success`/etc from being
        /// reset every tick; nothing here needs to know about them.
        /// </summary>
        public async Task SyncReservationsAsync()
        {
            var units = LoadUnitCodes();
            var seen = new HashSet<(string Unit, string Number, int Line)>();
            var batch = new List<ReservationPayload>();
            int totalSaved = 0;

            async Task FlushAsync()
            {
                if (batch.Count == 0) return;
                var result = await _api.PushReservationsAsync(batch).ConfigureAwait(false);
                totalSaved += result.Saved;
                if (result.UnknownUnits.Count > 0)
                {
                    Writer.Write($"Reservations: unknown units {string.Join(", ", result.UnknownUnits)} (will arrive once units sync catches up)");
                }
                batch = new List<ReservationPayload>();
            }

            async Task CollectAsync(DateTime from, DateTime to, string field)
            {
                foreach (var unit in units)
                {
                    Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(unit);
                    Wintouch.Hotel.Businesstier.Reservas.Filtro.Reset();
                    Wintouch.Hotel.Businesstier.Reservas.Filtro.AddFilterRow(field, from, Wintouch.Core.Data.enumfilteropers.GreaterOrEqual);
                    Wintouch.Hotel.Businesstier.Reservas.Filtro.AddFilterRow(field, to, Wintouch.Core.Data.enumfilteropers.LessOrEqual);
                    var res = Wintouch.Hotel.Businesstier.Reservas.GetList();

                    foreach (Wintouch.Hotel.DataTier.DsReservas.whotreservasRow r in res.whotreservas.Rows)
                    {
                        var key = (r.unidade, r.codigo, r.linhareserva);
                        if (!seen.Add(key)) continue;

                        batch.Add(new ReservationPayload
                        {
                            UnitCode = r.unidade,
                            Number = r.codigo,
                            Line = r.linhareserva,
                            GuestCode = string.IsNullOrEmpty(r.codigohospede) ? null : r.codigohospede,
                            RoomCode = r.quarto,
                            RoomName = Wintouch.Hotel.Businesstier.Alojamento.GetAlojamentoInfo(r.quarto)?.descricao,
                            Adults = r.nradultos,
                            Children = r.nrcriancas,
                            Babies = r.nrbercos,
                            Checkin = FormatDate(r.checkin),
                            Checkout = FormatDate(r.checkout),
                            Status = r.tiporeserva,
                            Channel = r.canaldistrib,
                            Extras = LoadExtraCodes(r.unidade, r.codigo, r.linhareserva),
                        });
                        if (batch.Count >= BatchSize) await FlushAsync().ConfigureAwait(false);
                    }
                }
            }

            var today = DateTime.Today;
            await CollectAsync(today, today.AddDays(7), "checkin").ConfigureAwait(false);
            await CollectAsync(today.AddDays(-7), today.AddDays(1), "checkout").ConfigureAwait(false);
            await FlushAsync().ConfigureAwait(false);
            Writer.Write($"Reservations: {totalSaved} saved");
        }

        /// <summary>
        /// Secondary occupants already known to Wintouch at booking time —
        /// code only, same as the legacy's Reservation.GetExtras(). A guest
        /// who has not checked in yet has no name on file here; that arrives
        /// through the check-in form instead.
        /// </summary>
        private static List<ReservationExtraPayload> LoadExtraCodes(string unit, string number, int line)
        {
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.Reset();
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("unidade", unit);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("codigoreserva", number);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("linhareserva", line);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("tipo", 0);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("ishospedeprincipal", 0);
            var extras = Wintouch.Hotel.Businesstier.ReservasEntidades.GetList();

            var list = new List<ReservationExtraPayload>();
            foreach (Wintouch.Hotel.DataTier.DsReservasEntidades.whotreservasentidadesRow row in extras.whotreservasentidades.Rows)
            {
                list.Add(new ReservationExtraPayload { Code = row.codigo });
            }
            return list;
        }

        /// <summary>
        /// Check-ins guests have completed online, written back into
        /// Wintouch — the only path back in (plan.md §620). Ported from the
        /// legacy's Reservation.AddOrUpdateNewCheckInsAsync, which this
        /// mirrors closely: save each occupant as a Wintouch Terceiro, upsert
        /// their `ReservasEntidades` line, then stamp the reservation's
        /// `observacoes`. On any failure for one reservation, nothing is
        /// marked and the ack is `ok: false` — the same "self-heals on the
        /// next tick" behaviour ingest.ts's ack route already assumes.
        /// </summary>
        public async Task ProcessPendingCheckinsAsync()
        {
            var pending = await _api.GetPendingCheckinsAsync().ConfigureAwait(false);
            int done = 0;
            foreach (var checkin in pending)
            {
                try
                {
                    WriteCheckinToWintouch(checkin);
                    await _api.AckCheckinAsync(checkin.Token, ok: true).ConfigureAwait(false);
                    done++;
                }
                catch (Exception ex)
                {
                    Writer.Write($"Check-in write-back failed for {checkin.UnitCode}/{checkin.Number}/{checkin.Line}: {ex.Message}");
                    await _api.AckCheckinAsync(checkin.Token, ok: false).ConfigureAwait(false);
                }
            }
            if (pending.Count > 0) Writer.Write($"Check-ins: {done}/{pending.Count} written back");
        }

        private static void WriteCheckinToWintouch(PendingCheckin checkin)
        {
            Wintouch.Hotel.Businesstier.Settings.ChangeUnidade(checkin.UnitCode);

            // The primary guest is always an adult — hotel-core's `guests`
            // table has no age-group column at all (only `guest_extras`
            // does; the primary always fills one adult slot, per
            // checkin.ts's own comment on occupant counts).
            const int primaryGroup = 0;
            if (checkin.Guest != null)
            {
                var code = SaveGuestAsTerceiro(checkin.Guest.Code, checkin.Guest);
                UpsertReservaEntidade(checkin.UnitCode, checkin.Number, checkin.Line, code, primaryGroup);
            }

            foreach (var extra in checkin.Extras)
            {
                var code = SaveExtraAsTerceiro(extra);
                UpsertReservaEntidade(checkin.UnitCode, checkin.Number, checkin.Line, code, extra.AgeGroup);
            }

            StampObservacoes(checkin.UnitCode, checkin.Number, checkin.Line, 1 + checkin.Extras.Count);
        }

        /// <summary>Updates the fields the check-in form actually collects (checkin.ts) — everything else in the Terceiro is left as Wintouch already has it.</summary>
        private static string SaveGuestAsTerceiro(string code, PendingGuest guest)
        {
            var terceiro = Wintouch.Hotel.Businesstier.Terceiros.GetItem(code);
            if (terceiro == null) throw new InvalidOperationException($"guest {code} is not a known Wintouch terceiro");

            terceiro.nome = guest.FirstName ?? terceiro.nome;
            terceiro.apelido = guest.LastName ?? terceiro.apelido;
            terceiro.email = guest.Email ?? terceiro.email;
            terceiro.morada1 = guest.AddressLine1 ?? terceiro.morada1;
            terceiro.codpostal = guest.PostalCode ?? terceiro.codpostal;
            terceiro.localpostal = guest.City ?? terceiro.localpostal;
            terceiro.pais = guest.Country ?? terceiro.pais;
            terceiro.nacionalidade = guest.Nationality ?? terceiro.nacionalidade;
            if (guest.DocumentType.HasValue) terceiro.tipodocid = (byte)guest.DocumentType.Value;
            terceiro.numdocid = guest.DocumentNumber ?? terceiro.numdocid;
            terceiro.paisemissordoc = guest.DocumentCountry ?? terceiro.paisemissordoc;
            if (ParseDate(guest.BirthDate) is DateTime birthDate) terceiro.dtnasc = birthDate;

            Wintouch.Hotel.Businesstier.Terceiros.Save(ref terceiro);
            return terceiro.codigo;
        }

        /// <summary>
        /// An extra has no Wintouch code yet — the check-in form collects
        /// them fresh (checkin.ts). A new Terceiro is created the same way
        /// the legacy's `Guest.SaveOrUpdate` does for one with a blank code:
        /// `GetProximoTerceiro(true)` (true = guest numbering, not company).
        /// </summary>
        private static string SaveExtraAsTerceiro(PendingExtra extra)
        {
            using var ds = new Wintouch.Hotel.DataTier.DsTerceiros();
            var terceiro = ds.CreateNewRow();
            ds.wgcterceiros.Rows.Add(terceiro);
            terceiro.codigo = Wintouch.Hotel.Businesstier.Terceiros.GetProximoTerceiro(true);
            terceiro.nome = extra.FirstName ?? "";
            terceiro.apelido = extra.LastName ?? "";
            terceiro.numdocid = extra.DocumentNumber ?? "";
            terceiro.hospede = 1;
            terceiro.grupohotel = "DIR";
            terceiro.Exportado = 0;
            terceiro.cliente = 1;

            Wintouch.Hotel.Businesstier.Terceiros.Save(ref terceiro);
            return terceiro.codigo;
        }

        private static void UpsertReservaEntidade(string unit, string number, int line, string guestCode, int ageGroup)
        {
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.Reset();
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("unidade", unit);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("codigoreserva", number);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("linhareserva", line);
            Wintouch.Hotel.Businesstier.ReservasEntidades.Filtro.AddFilterRow("tipo", 0);
            var existing = Wintouch.Hotel.Businesstier.ReservasEntidades.GetList();

            Wintouch.Hotel.DataTier.DsReservasEntidades.whotreservasentidadesRow? line_ = null;
            foreach (Wintouch.Hotel.DataTier.DsReservasEntidades.whotreservasentidadesRow row in existing.whotreservasentidades.Rows)
            {
                if (row.codigo == guestCode) line_ = row;
            }

            if (line_ == null)
            {
                using var ds = new Wintouch.Hotel.DataTier.DsReservasEntidades();
                line_ = ds.CreateNewRow();
                ds.whotreservasentidades.Rows.Add(line_);
                line_.unidade = unit;
                line_.codigoreserva = number;
                line_.linhareserva = line;
                line_.codigo = guestCode;
            }
            line_.GrupoEtario = (byte)ageGroup;

            Wintouch.Hotel.Businesstier.ReservasEntidades.Save(ref line_);
        }

        private static void StampObservacoes(string unit, string number, int line, int guestCount)
        {
            var reservation = Wintouch.Hotel.Businesstier.Reservas.GetItem(number, line, unit);
            var previous = reservation.observacoes;
            reservation.observacoes = "***** Checkin Online efectuado *****"
                + Environment.NewLine + "Numero de Hospedes: " + guestCount
                + Environment.NewLine + Environment.NewLine + previous;
            reservation.AvisarObservacoes = 1;
            Wintouch.Hotel.Businesstier.Reservas.Save(ref reservation);
        }

        /// <summary>
        /// Always formats, never filters: Wintouch's own "unknown date"
        /// sentinel is 1900-01-01 (plan.md §639), not .NET's `default`, and
        /// hotel-core's own `date()` util already strips that sentinel on
        /// arrival (apps/hotel/api/src/util.ts) — duplicating the check here
        /// would just be two places that have to agree on one magic date.
        /// </summary>
        private static string FormatDate(DateTime value) => value.ToString("yyyy-MM-dd");

        private static DateTime? ParseDate(string? value) =>
            DateTime.TryParse(value, out var d) ? d : (DateTime?)null;
    }
}
