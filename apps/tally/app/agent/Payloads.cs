namespace Tally.Agent;

/// <summary>
/// The shapes the dashboard expects (plan.md §635).
///
/// Every total and count here is computed in SQL on this machine. The legacy
/// agent returned five raw DataTables and let the browser sum them, including
/// the entire sales table with no date filter (§622) — so on a busy shop the
/// whole day's trade crossed the wire on every refresh.
/// </summary>
public sealed record Overview(
    string AsOf,
    Totals Totals,
    TableCounts Tables,
    Clients Clients,
    IReadOnlyList<StaffTotal> Staff,
    IReadOnlyList<PaymentTotal> Payments,
    IReadOnlyList<HourlyTotal> Hourly,
    // The trading day these figures are for (yyyy-MM-dd) — the running day, which
    // is not always the calendar date (§677).
    string BusinessDate);

public sealed record Totals(decimal Invoiced, decimal Open);

public sealed record TableCounts(int Free, int Occupied, int AwaitingPayment);

public sealed record Clients(int Present);

public sealed record StaffTotal(string Code, string Name, decimal Total);

public sealed record PaymentTotal(string Method, decimal Total);

public sealed record HourlyTotal(int Hour, decimal Total);

public sealed record TablesView(
    string AsOf,
    int Free,
    int Occupied,
    int AwaitingPayment,
    IReadOnlyList<ShopTable> Tables);

public sealed record ShopTable(
    int Table,
    string State,
    string Staff,
    int Guests,
    string? OpenedAt,
    decimal Total,
    IReadOnlyList<TableLine> Lines);

public sealed record TableLine(decimal Quantity, string Description, decimal Total);

public sealed record SoldItemsView(
    string AsOf,
    decimal TotalQuantity,
    decimal TotalValue,
    IReadOnlyList<SoldItem> Items,
    string BusinessDate);

public sealed record SoldItem(string Description, decimal Quantity, decimal Total);
