using System.Collections.Generic;

namespace Hotel.Agent
{
    /// <summary>
    /// The shapes hotel-core's `/agent` routes expect and return
    /// (apps/hotel/api/src/routes/ingest.ts, agent.ts). Plain classes, not
    /// records: net48 has no built-in `init` accessor support, and a
    /// polyfill for one buys nothing a settable property doesn't already do
    /// here — these only ever round-trip through JSON.
    /// </summary>
    public sealed class EnrolResponse
    {
        public string? AgentId { get; set; }
        public string? Token { get; set; }
    }

    public sealed class UnitPayload
    {
        public string Code { get; set; } = "";
        public string Name { get; set; } = "";
    }

    public sealed class RemoteUnit
    {
        public string Code { get; set; } = "";
        public string Name { get; set; } = "";
        public bool CheckinActive { get; set; }
        public bool QuizActive { get; set; }
        public bool BirthdayActive { get; set; }
        public bool PromoActive { get; set; }
    }

    public sealed class GuestPayload
    {
        public string Code { get; set; } = "";
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Email { get; set; }
        public string? Phone { get; set; }
        public string? AddressLine1 { get; set; }
        public string? AddressLine2 { get; set; }
        public string? AddressLine3 { get; set; }
        public string? PostalCode { get; set; }
        public string? City { get; set; }
        public string? Country { get; set; }
        public string? Nationality { get; set; }
        public string? TaxNumber { get; set; }
        /// <summary>yyyy-MM-dd, or null — Wintouch's 1900-01-01 "unknown" sentinel is dropped before this is built (HotelSync.cs).</summary>
        public string? BirthDate { get; set; }
    }

    public sealed class ReservationExtraPayload
    {
        public string? Code { get; set; }
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public int AgeGroup { get; set; }
    }

    public sealed class ReservationPayload
    {
        public string UnitCode { get; set; } = "";
        public string Number { get; set; } = "";
        public int Line { get; set; }
        public string? GuestCode { get; set; }
        public string? RoomCode { get; set; }
        public string? RoomName { get; set; }
        public int Adults { get; set; } = 1;
        public int Children { get; set; }
        public int Babies { get; set; }
        public string? Checkin { get; set; }
        public string? Checkout { get; set; }
        public string? Status { get; set; }
        public string? Channel { get; set; }
        public List<ReservationExtraPayload> Extras { get; set; } = new List<ReservationExtraPayload>();
    }

    public sealed class PushResult
    {
        public int Saved { get; set; }
        public int Skipped { get; set; }
        public List<string> UnknownUnits { get; set; } = new List<string>();
    }

    public sealed class PendingCheckin
    {
        public string Token { get; set; } = "";
        public string UnitCode { get; set; } = "";
        public string Number { get; set; } = "";
        public int Line { get; set; }
        public PendingGuest? Guest { get; set; }
        public List<PendingExtra> Extras { get; set; } = new List<PendingExtra>();
    }

    public sealed class PendingGuest
    {
        public string Code { get; set; } = "";
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Email { get; set; }
        public int? DocumentType { get; set; }
        public string? DocumentNumber { get; set; }
        public string? DocumentCountry { get; set; }
        public string? Nationality { get; set; }
        public string? BirthDate { get; set; }
        public string? AddressLine1 { get; set; }
        public string? PostalCode { get; set; }
        public string? City { get; set; }
        public string? Country { get; set; }
    }

    /// <summary>
    /// No `Code` field: an extra has none yet the first time a guest submits
    /// one (they are collected by the check-in form, not synced in from
    /// Wintouch like the primary guest) — HotelSync.cs resolves or creates
    /// one in Wintouch the same way the legacy's `Guest.SaveOrUpdate` does.
    /// </summary>
    public sealed class PendingExtra
    {
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? DocumentNumber { get; set; }
        public int AgeGroup { get; set; }
    }

    public sealed class AckResult
    {
        public bool Acknowledged { get; set; }
    }
}
