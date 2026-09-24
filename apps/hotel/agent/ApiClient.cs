using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace Hotel.Agent
{
    /// <summary>
    /// hotel-core's `/agent` routes (plan.md §627, §639). Plain outbound
    /// HTTPS with a bearer token, not a socket like tally's — this agent's
    /// push model tolerates minutes, so there is nothing a long-lived
    /// connection buys here (§627).
    /// </summary>
    public sealed class ApiClient
    {
        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions(JsonSerializerDefaults.Web);

        private readonly AgentOptions _options;
        private readonly TokenStore _tokens;
        private readonly HttpClient _http;

        public ApiClient(AgentOptions options, TokenStore tokens)
        {
            _options = options;
            _tokens = tokens;
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        }

        /// <summary>
        /// Exchanges a single-use enrolment code for the long-lived token,
        /// once — the server hands it over exactly once and keeps only its
        /// hash, so this is the only chance to store it.
        /// </summary>
        public async Task<bool> EnrolAsync(string code)
        {
            var body = new StringContent(JsonSerializer.Serialize(new { code }, Json), Encoding.UTF8, "application/json");
            HttpResponseMessage response;
            try
            {
                response = await _http.PostAsync(_options.EnrolUri, body).ConfigureAwait(false);
            }
            catch (HttpRequestException ex)
            {
                Writer.Write($"Enrolment failed: {ex.Message}");
                return false;
            }

            var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                // The server deliberately gives one message for every
                // failure, so a wrong code cannot be told from an expired or
                // used one.
                Writer.Write($"Enrolment refused: {(int)response.StatusCode} {text}");
                return false;
            }

            var result = JsonSerializer.Deserialize<EnrolResponse>(text, Json);
            if (string.IsNullOrEmpty(result?.Token))
            {
                Writer.Write("Enrolment returned no token");
                return false;
            }

            _tokens.Write(result!.Token!);
            Writer.Write($"Enrolled; token stored at {_tokens.Path}");
            return true;
        }

        private HttpRequestMessage Request(HttpMethod method, Uri uri)
        {
            var token = _tokens.Read()
                ?? throw new InvalidOperationException("Not enrolled. Run: Hotel.Agent.exe enrol <CODE>");
            var request = new HttpRequestMessage(method, uri);
            request.Headers.Add("Authorization", $"Bearer {token}");
            return request;
        }

        /// <summary>Confirms the token is still good and lists the units hotel-core already knows about, for diagnostics only — the sync itself always re-derives units from Wintouch (HotelSync.cs).</summary>
        public async Task<List<RemoteUnit>> GetUnitsAsync()
        {
            var response = await _http.SendAsync(Request(HttpMethod.Get, _options.UnitsUri)).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            return JsonSerializer.Deserialize<List<RemoteUnit>>(text, Json) ?? new List<RemoteUnit>();
        }

        public Task<PushResult> PushUnitsAsync(List<UnitPayload> units) => PostAsync<PushResult>(_options.PushUnitsUri, units);

        public Task<PushResult> PushGuestsAsync(List<GuestPayload> guests) => PostAsync<PushResult>(_options.PushGuestsUri, guests);

        public Task<PushResult> PushReservationsAsync(List<ReservationPayload> reservations) => PostAsync<PushResult>(_options.PushReservationsUri, reservations);

        public async Task<List<PendingCheckin>> GetPendingCheckinsAsync()
        {
            var response = await _http.SendAsync(Request(HttpMethod.Get, _options.PendingCheckinsUri)).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            return JsonSerializer.Deserialize<List<PendingCheckin>>(text, Json) ?? new List<PendingCheckin>();
        }

        public async Task AckCheckinAsync(string token, bool ok)
        {
            var request = Request(HttpMethod.Post, _options.AckCheckinUri(token));
            request.Content = new StringContent(JsonSerializer.Serialize(new { ok }, Json), Encoding.UTF8, "application/json");
            var response = await _http.SendAsync(request).ConfigureAwait(false);
            // A 404 (already acknowledged, e.g. a retried tick) is fine to
            // ignore; only a real failure should stop the batch.
            if (!response.IsSuccessStatusCode && response.StatusCode != System.Net.HttpStatusCode.NotFound)
            {
                response.EnsureSuccessStatusCode();
            }
        }

        public async Task<List<DueCheckout>> GetDueCheckoutsAsync()
        {
            var response = await _http.SendAsync(Request(HttpMethod.Get, _options.DueCheckoutsUri)).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            return JsonSerializer.Deserialize<List<DueCheckout>>(text, Json) ?? new List<DueCheckout>();
        }

        public Task<PushResult> PushCheckoutBillsAsync(List<CheckoutBill> bills) => PostAsync<PushResult>(_options.CheckoutBillsUri, bills);

        public async Task<List<SettledCheckout>> GetSettledCheckoutsAsync()
        {
            var response = await _http.SendAsync(Request(HttpMethod.Get, _options.SettledCheckoutsUri)).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            return JsonSerializer.Deserialize<List<SettledCheckout>>(text, Json) ?? new List<SettledCheckout>();
        }

        public async Task AckCheckoutAsync(string token, bool ok)
        {
            var request = Request(HttpMethod.Post, _options.AckCheckoutUri(token));
            request.Content = new StringContent(JsonSerializer.Serialize(new { ok }, Json), Encoding.UTF8, "application/json");
            var response = await _http.SendAsync(request).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode && response.StatusCode != System.Net.HttpStatusCode.NotFound)
            {
                response.EnsureSuccessStatusCode();
            }
        }

        private async Task<T> PostAsync<T>(Uri uri, object body)
        {
            var request = Request(HttpMethod.Post, uri);
            request.Content = new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");
            var response = await _http.SendAsync(request).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            return JsonSerializer.Deserialize<T>(text, Json)!;
        }
    }
}
