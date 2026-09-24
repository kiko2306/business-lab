using System.Data;
using Microsoft.Data.SqlClient;

namespace Tally.Agent;

/// <summary>
/// Reads the shop's Wintouch database and returns the aggregated payloads the
/// dashboard expects (plan.md §635).
///
/// Read-only throughout. Every total is computed here in SQL rather than sent
/// as rows and summed in the browser, which is what the legacy did (§622).
///
/// Schema notes, confirmed against a real Wintouch `vallado` database rather
/// than assumed:
///  - `wsir_vnd_vendas` holds invoiced sale lines and carries `EntryDate`.
///  - `wsir_vnd_pedidos` holds *open* orders — the running tabs — and so is
///    current by definition, with no date filter.
///  - `wsir_mst_mesas.estado` is 0 free, 1 awaiting payment, 2 occupied. The
///    legacy Angular read 1 as occupied and 2 as awaiting payment, which is the
///    other way round from the labels on its own SQL files; the labels and the
///    live data agree, so they win.
///  - `wgctiposdocumentos.tipo = 'F'` is an invoice (factura).
/// </summary>
public sealed class ShopReader(string connectionString)
{
    /// <summary>
    /// Pins the trading day, for checking the queries against a known date.
    /// Normally left null, and the day is whatever the day tables hold.
    /// </summary>
    public DateTime? BusinessDate { get; init; }

    /// <summary>
    /// The running trading day: the date of the newest line in the day table.
    ///
    /// Not `DateTime.Today`. Wintouch keeps the *open* business day in
    /// `wsir_vnd_vendas` and rolls it into the archive at day close (§622), so
    /// that table is by definition the running day — which is not the calendar
    /// date after midnight in a bar that trades late, nor on a shop whose day
    /// has not been closed yet. Pinning to today made every "today" figure
    /// empty whenever the two disagreed (§677). Still an explicit date filter
    /// rather than none, so a table that was not rolled reports its latest day
    /// and not all time (the §622 worry). Falls back to today for an empty
    /// table, where there is nothing to disagree with.
    /// </summary>
    private async Task<DateTime> ResolveDayAsync(SqlConnection connection, CancellationToken ct)
    {
        if (BusinessDate is { } pinned) return pinned.Date;
        await using var command = new SqlCommand("SELECT MAX(CAST(EntryDate AS date)) FROM wsir_vnd_vendas", connection);
        return await command.ExecuteScalarAsync(ct) is DateTime latest ? latest : DateTime.Today;
    }

    public async Task<Overview> ReadOverviewAsync(CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        var day = await ResolveDayAsync(connection, ct);

        var invoiced = await ScalarAsync(connection, day, """
            SELECT ISNULL(SUM(CAST(v.total AS DECIMAL(18,2))), 0)
              FROM wsir_vnd_vendas v
              JOIN wgctiposdocumentos d ON v.documento = d.codigo
             WHERE d.tipo = 'F' AND v.Anulado = 0
               AND CAST(v.EntryDate AS date) = @businessDate
            """, ct);

        // Open tabs are current by definition — there is no closed-day concept
        // for an order that has not been paid for yet.
        var open = await ScalarAsync(connection, day, """
            SELECT ISNULL(SUM(CAST(total AS DECIMAL(18,2))), 0) FROM wsir_vnd_pedidos
            """, ct);

        var counts = await QueryAsync(connection, day, """
            SELECT estado, COUNT(*) AS n FROM wsir_mst_mesas GROUP BY estado
            """, r => (Estado: Convert.ToInt32(r["estado"]), N: Convert.ToInt32(r["n"])), ct);

        var present = await ScalarAsync(connection, day, """
            SELECT ISNULL(SUM(CAST(numclientes AS int)), 0) FROM wsir_mst_mesas WHERE estado <> 0
            """, ct);

        var staff = await QueryAsync(connection, day, """
            SELECT v.funcionario AS code,
                   ISNULL(e.nome, v.funcionario) AS name,
                   SUM(CAST(v.total AS DECIMAL(18,2))) AS total
              FROM wsir_vnd_vendas v
              LEFT JOIN wgcvendedores e ON e.codigo = v.funcionario
              JOIN wgctiposdocumentos d ON v.documento = d.codigo
             WHERE d.tipo = 'F' AND v.Anulado = 0
               AND CAST(v.EntryDate AS date) = @businessDate
             GROUP BY v.funcionario, e.nome
             HAVING SUM(CAST(v.total AS DECIMAL(18,2))) <> 0
             ORDER BY total DESC
            """, r => new StaffTotal((string)r["code"], (string)r["name"], (decimal)r["total"]), ct);

        // Payments carry no date of their own, so they are dated by the sale
        // they settle — which is also what stops a payment being counted
        // against a document that was voided.
        var payments = await QueryAsync(connection, day, """
            SELECT ISNULL(m.descricao, p.meiospagamento) AS method,
                   SUM(CAST(p.total AS DECIMAL(18,2))) AS total
              FROM wsir_vnd_meiospagamento p
              LEFT JOIN wgcmeiospagamento m ON m.codigo = p.meiospagamento
             WHERE EXISTS (
                     SELECT 1 FROM wsir_vnd_vendas v
                      WHERE v.documento = p.documento AND v.numdoc = p.numdoc
                        AND v.Anulado = 0
                        AND CAST(v.EntryDate AS date) = @businessDate)
             GROUP BY m.descricao, p.meiospagamento
             HAVING SUM(CAST(p.total AS DECIMAL(18,2))) <> 0
             ORDER BY total DESC
            """, r => new PaymentTotal((string)r["method"], (decimal)r["total"]), ct);

        var hourlyRows = await QueryAsync(connection, day, """
            SELECT DATEPART(hour, v.EntryDate) AS hour,
                   SUM(CAST(v.total AS DECIMAL(18,2))) AS total
              FROM wsir_vnd_vendas v
              JOIN wgctiposdocumentos d ON v.documento = d.codigo
             WHERE d.tipo = 'F' AND v.Anulado = 0
               AND CAST(v.EntryDate AS date) = @businessDate
             GROUP BY DATEPART(hour, v.EntryDate)
            """, r => new HourlyTotal(Convert.ToInt32(r["hour"]), (decimal)r["total"]), ct);

        return new Overview(
            Now(),
            new Totals(invoiced, open),
            new TableCounts(
                Free: counts.FirstOrDefault(c => c.Estado == 0).N,
                AwaitingPayment: counts.FirstOrDefault(c => c.Estado == 1).N,
                Occupied: counts.FirstOrDefault(c => c.Estado == 2).N),
            new Clients((int)present),
            staff,
            payments,
            FillHours(hourlyRows),
            day.ToString("yyyy-MM-dd"));
    }

    public async Task<TablesView> ReadTablesAsync(CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        // Tables and open orders are live state; none of these queries has a date.
        var day = DateTime.Today;

        var counts = await QueryAsync(connection, day, """
            SELECT estado, COUNT(*) AS n FROM wsir_mst_mesas GROUP BY estado
            """, r => (Estado: Convert.ToInt32(r["estado"]), N: Convert.ToInt32(r["n"])), ct);

        var open = await QueryAsync(connection, day, """
            SELECT m.mesa AS tableNumber,
                   m.estado AS estado,
                   ISNULL(e.nome, '') AS staff,
                   CAST(m.numclientes AS int) AS guests,
                   m.horainicial AS openedAt,
                   ISNULL((SELECT SUM(CAST(p.total AS DECIMAL(18,2)))
                             FROM wsir_vnd_pedidos p WHERE p.mesa = m.mesa), 0) AS total
              FROM wsir_mst_mesas m
              LEFT JOIN wgcvendedores e ON e.codigo = m.funcionario
             WHERE m.estado <> 0
             ORDER BY m.mesa
            """, r => (
                Table: Convert.ToInt32(r["tableNumber"]),
                Estado: Convert.ToInt32(r["estado"]),
                Staff: (string)r["staff"],
                Guests: (int)r["guests"],
                OpenedAt: r["openedAt"] as DateTime?,
                Total: (decimal)r["total"]), ct);

        // One query for every open table's lines, then grouped in memory: a
        // per-table round trip would be one query per occupied table on every
        // refresh, and a busy shop has dozens.
        var lines = await QueryAsync(connection, day, """
            SELECT CAST(mesa AS int) AS tableNumber,
                   SUM(CAST(quantidade AS DECIMAL(18,2))) AS quantity,
                   descricao AS description,
                   SUM(CAST(total AS DECIMAL(18,2))) AS total
              FROM wsir_vnd_pedidos
             GROUP BY mesa, descricao
             ORDER BY mesa, descricao
            """, r => (
                Table: (int)r["tableNumber"],
                Line: new TableLine((decimal)r["quantity"], (string)r["description"], (decimal)r["total"])), ct);

        var byTable = lines.GroupBy(l => l.Table)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<TableLine>)g.Select(l => l.Line).ToList());

        var tables = open.Select(t => new ShopTable(
            t.Table,
            t.Estado == 1 ? "awaiting-payment" : "occupied",
            t.Staff,
            t.Guests,
            t.OpenedAt?.ToString("o"),
            t.Total,
            byTable.TryGetValue(t.Table, out var l) ? l : Array.Empty<TableLine>())).ToList();

        return new TablesView(
            Now(),
            Free: counts.FirstOrDefault(c => c.Estado == 0).N,
            Occupied: counts.FirstOrDefault(c => c.Estado == 2).N,
            AwaitingPayment: counts.FirstOrDefault(c => c.Estado == 1).N,
            Tables: tables);
    }

    public async Task<SoldItemsView> ReadSoldItemsAsync(CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        var day = await ResolveDayAsync(connection, ct);

        // tipolinha 'P' is a product line — the rest are discounts, notes and
        // totals, which would double-count if summed as items.
        //
        // `codpedido` is the article code (odd name; it matches wgcartigos.codigo
        // on every product line of the running day, checked against the real
        // database — §678), so items are joined on it and named from the article
        // master. Sale lines otherwise carry only `descricao`, cut to 30
        // characters and editable per sale, which split one article across names
        // and cannot be matched back reliably. An article missing from the master
        // falls back to the line's own text.
        //
        // Comment articles (family COMENTARIOS — "--- Pode Sair Mesa", a kitchen
        // instruction rung at 0.00) are also 'P' lines but are not things sold;
        // unfiltered, one of them was a day's busiest "item".
        var items = await QueryAsync(connection, day, """
            SELECT v.codpedido AS code,
                   ISNULL(a.nome, LTRIM(RTRIM(v.descricao))) AS description,
                   ISNULL(a.familia, '') AS family,
                   SUM(CAST(v.quantidade AS DECIMAL(18,2))) AS quantity,
                   SUM(CAST(v.total AS DECIMAL(18,2))) AS total
              FROM wsir_vnd_vendas v
              LEFT JOIN wgcartigos a ON a.codigo = v.codpedido
             WHERE v.tipolinha = 'P' AND v.Anulado = 0
               AND CAST(v.EntryDate AS date) = @businessDate
               AND ISNULL(a.familia, '') <> 'COMENTARIOS'
             GROUP BY v.codpedido, ISNULL(a.nome, LTRIM(RTRIM(v.descricao))), ISNULL(a.familia, '')
             ORDER BY quantity DESC
            """, r => new SoldItem(
                (string)r["code"], (string)r["description"], (string)r["family"],
                (decimal)r["quantity"], (decimal)r["total"]), ct);

        return new SoldItemsView(Now(), items.Sum(i => i.Quantity), items.Sum(i => i.Total), items, day.ToString("yyyy-MM-dd"));
    }

    /// <summary>
    /// Every hour between the first and last with trade, gaps included. A quiet
    /// hour has to appear as a gap, or the spacing implies trade that did not
    /// happen (§635).
    /// </summary>
    private static IReadOnlyList<HourlyTotal> FillHours(IReadOnlyList<HourlyTotal> rows)
    {
        if (rows.Count == 0) return Array.Empty<HourlyTotal>();
        var byHour = rows.ToDictionary(r => r.Hour, r => r.Total);
        var first = byHour.Keys.Min();
        var last = byHour.Keys.Max();
        return Enumerable.Range(first, last - first + 1)
            .Select(h => new HourlyTotal(h, byHour.TryGetValue(h, out var t) ? t : 0m))
            .ToList();
    }

    private static string Now() => DateTime.UtcNow.ToString("o");

    private async Task<decimal> ScalarAsync(SqlConnection connection, DateTime day, string sql, CancellationToken ct)
    {
        await using var command = Command(connection, day, sql);
        var value = await command.ExecuteScalarAsync(ct);
        return value is null or DBNull ? 0m : Convert.ToDecimal(value);
    }

    private async Task<List<T>> QueryAsync<T>(
        SqlConnection connection, DateTime day, string sql, Func<IDataRecord, T> map, CancellationToken ct)
    {
        await using var command = Command(connection, day, sql);
        await using var reader = await command.ExecuteReaderAsync(ct);
        var results = new List<T>();
        while (await reader.ReadAsync(ct)) results.Add(map(reader));
        return results;
    }

    private static SqlCommand Command(SqlConnection connection, DateTime day, string sql)
    {
        var command = new SqlCommand(sql, connection);
        // Added unconditionally: an unused parameter is harmless, and this way
        // no query can forget the date filter by forgetting the parameter.
        command.Parameters.Add("@businessDate", SqlDbType.Date).Value = day;
        return command;
    }
}
