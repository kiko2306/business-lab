using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Tally.Agent;

/// <summary>
/// Enrolment and the outbound connection (plan.md §627, §634).
///
/// The agent dials out and holds the socket; nothing at the shop listens, and
/// no router change is needed. The legacy did the reverse — an unauthenticated
/// HTTP listener on the shop's public IP, whose address it re-published every
/// thirty seconds (§622).
/// </summary>
public sealed class AgentClient(
    AgentOptions options,
    TokenStore tokens,
    ShopReader reader,
    ILogger<AgentClient> logger)
{
    /// <summary>Stamped at build time as "1.0.0-&lt;source hash&gt;" (see the Dockerfile).</summary>
    private static readonly string AgentVersion =
        typeof(AgentClient).Assembly
            .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .Cast<System.Reflection.AssemblyInformationalVersionAttribute>()
            .FirstOrDefault()?.InformationalVersion ?? "unknown";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Exchanges a single-use enrolment code for the long-lived token, once.
    /// The server hands the token over exactly once and keeps only its hash, so
    /// this is the only chance to store it.
    /// </summary>
    public async Task<bool> EnrolAsync(string code, CancellationToken ct)
    {
        using var http = new HttpClient();
        var body = new StringContent(
            JsonSerializer.Serialize(new { code }, Json), Encoding.UTF8, "application/json");

        var response = await http.PostAsync(options.EnrolUri, body, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            // The server deliberately gives one message for every failure, so
            // that a wrong code cannot be told from an expired or used one.
            logger.LogError("Enrolment refused: {Status} {Body}", (int)response.StatusCode, text);
            return false;
        }

        var result = JsonSerializer.Deserialize<EnrolResponse>(text, Json);
        if (result?.Token is null)
        {
            logger.LogError("Enrolment returned no token");
            return false;
        }

        tokens.Write(result.Token);
        logger.LogInformation("Enrolled as {Shop}; token stored at {Path}", result.Store?.Name, tokens.Path);
        return true;
    }

    /// <summary>
    /// Connects and serves requests until cancelled, reconnecting on its own.
    ///
    /// Backoff is capped: a shop whose network is out for an hour should not
    /// end up retrying once a day, and a server restart should be picked up in
    /// seconds rather than left waiting.
    /// </summary>
    public async Task RunAsync(CancellationToken ct)
    {
        var delay = TimeSpan.FromSeconds(2);
        var maxDelay = TimeSpan.FromSeconds(60);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Read inside the try: a DPAPI or file error must be retried
                // like any other failure, not escape and end the service.
                var token = tokens.Read();
                if (token is null)
                {
                    // Keep the service alive and retry rather than returning:
                    // a process that has quietly stopped working looks
                    // "Running" to the service manager and is never restarted.
                    logger.LogError("Not enrolled. Run: Wintouch.Tally.Agent enrol <CODE>");
                    delay = maxDelay;
                }
                else
                {
                    // The backoff restarts from the shortest wait once a connection is
                    // actually up: it exists to slow a run of *failed* attempts, and a
                    // link that held for hours and then dropped (a Tally rebuild, a
                    // tunnel restart) should be back in seconds, not left at whatever
                    // the last outage's delay had grown to.
                    await ServeAsync(token, () => delay = TimeSpan.FromSeconds(2), ct);
                    // A clean close is the server going away, not a failure: retry
                    // promptly rather than treating it as an outage.
                    delay = TimeSpan.FromSeconds(2);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (TokenRefusedException ex)
            {
                // A 401 on the handshake: a revoked or unknown token (§634).
                // Retrying faster will not fix it, and it needs a human, so say
                // exactly that.
                logger.LogError(ex, "Connection refused (401). The token may have been revoked; re-enrol with a new code");
                delay = maxDelay;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Connection lost; retrying in {Delay}", delay);
            }

            try
            {
                await Task.Delay(delay, ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, maxDelay.TotalSeconds));
        }
    }

    private async Task ServeAsync(string token, Action onConnected, CancellationToken ct)
    {
        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Authorization", $"Bearer {token}");
        // Without this, HttpStatusCode stays empty after a refused handshake and a
        // 401 cannot be told from a 503 (found by running it against a fake server).
        socket.Options.CollectHttpResponseDetails = true;
        // So the Tally page can show what is installed at each shop (plan.md §672).
        socket.Options.SetRequestHeader("X-Agent-Version", AgentVersion);
        // The server pings every 30s to prove liveness through tunnels and NAT
        // (§634); answering is automatic, but this keeps the other direction
        // alive through a proxy that only watches one way.
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

        try
        {
            await socket.ConnectAsync(options.SocketUri, ct);
        }
        catch (WebSocketException) when (socket.HttpStatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            throw new TokenRefusedException();
        }
        // Any other refusal — a 502/503/504 from the proxy while Tally is being
        // rebuilt, most often — is the server being unavailable, not the token
        // being wrong, and falls through to the ordinary backoff. It used to be
        // reported as a revoked token and pinned to the longest wait, so every
        // dashboard update read as "re-enrol" and cost a minute (§679).
        onConnected();
        logger.LogInformation("Connected to {Uri} (agent {Version})", options.SocketUri, AgentVersion);

        var buffer = new byte[64 * 1024];
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    logger.LogInformation("Server closed the connection");
                    return;
                }
                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            // Deliberately not awaited: a slow query must not stall the socket,
            // or one report would delay every other request on it. Replies
            // carry the request id, so they can return in any order (§634).
            _ = HandleAsync(socket, Encoding.UTF8.GetString(message.ToArray()), ct);
        }
    }

    private async Task HandleAsync(WebSocket socket, string raw, CancellationToken ct)
    {
        string? id = null;
        try
        {
            var request = JsonSerializer.Deserialize<AgentRequest>(raw, Json);
            id = request?.Id;
            if (id is null) return;

            object data = request!.Method switch
            {
                "overview" => await reader.ReadOverviewAsync(RequestedDate(request.Params), ct),
                "tables" => await reader.ReadTablesAsync(ct),
                "sold_items" => await reader.ReadSoldItemsAsync(RequestedDate(request.Params), ct),
                _ => throw new InvalidOperationException($"unknown method \"{request.Method}\""),
            };

            await SendAsync(socket, new { id, ok = true, data }, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Request {Id} failed", id);
            if (id is null) return;
            // Reported back rather than dropped, so the dashboard can say the
            // shop errored instead of silently timing out (§634 turns this into
            // a 502).
            try
            {
                await SendAsync(socket, new { id, ok = false, error = ex.Message }, ct);
            }
            catch (Exception sendEx)
            {
                // The socket went away mid-reply. This runs unawaited, so
                // letting it throw would only become an unobserved task fault.
                logger.LogWarning(sendEx, "Could not report request {Id} failure", id);
            }
        }
    }

    private static readonly SemaphoreSlim SendLock = new(1, 1);

    private static async Task SendAsync(WebSocket socket, object frame, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(frame, Json);
        // One writer at a time: concurrent handlers share the socket, and
        // interleaved frames would corrupt the stream.
        await SendLock.WaitAsync(ct);
        try
        {
            if (socket.State != WebSocketState.Open) return;
            await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, ct);
        }
        finally
        {
            SendLock.Release();
        }
    }

    private sealed class TokenRefusedException() : Exception("the server refused the token (401)");

    private sealed record AgentRequest(string? Id, string Method, JsonElement? Params = null);

    /// <summary>
    /// The trading day a request asks for (`{"date":"yyyy-MM-dd"}`), or null for
    /// the running day. An unreadable date is an error, not a silent fallback to
    /// today — showing the wrong day's figures as the requested one is worse than
    /// saying so.
    /// </summary>
    private static DateTime? RequestedDate(JsonElement? parameters)
    {
        if (parameters is not { ValueKind: JsonValueKind.Object } p || !p.TryGetProperty("date", out var value)
            || value.ValueKind == JsonValueKind.Null)
            return null;
        if (value.ValueKind == JsonValueKind.String
            && DateTime.TryParseExact(value.GetString(), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var date))
            return date;
        throw new InvalidOperationException("date must be yyyy-MM-dd");
    }

    private sealed record EnrolResponse(string? AgentId, string? Token, EnrolStore? Store);

    private sealed record EnrolStore(string? Id, string? Name);
}
