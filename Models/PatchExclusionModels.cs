namespace OperationsApi.Models;

public class PatchExclusion
{
    public int ExclusionId { get; set; }
    public int ServerId { get; set; }
    public string ServerName { get; set; } = "";
    public string? PatchGroup { get; set; }
    public string? Service { get; set; }
    public string? Application { get; set; }
    public string? Environment { get; set; }
    public string? BusinessUnit { get; set; }
    public string Reason { get; set; } = "";
    public string? ReasonSlug { get; set; }
    public string? Notes { get; set; }
    public string? Ticket { get; set; }
    public DateOnly HeldUntil { get; set; }
    public string ExcludedBy { get; set; } = "";
    public DateTime ExcludedAt { get; set; }
    public bool HoldExpired { get; set; }
    // Derived server-side: 'overdue' | 'expiring' | 'active'.
    public string Status { get; set; } = "active";
}

public class PatchExclusionSummary
{
    // Top-level counts respect the optional state + businessUnit filters on
    // the query string. The breakdown lists below are cross-facet scoped -
    // States[] reflects the active BU (excluding state from its own scope),
    // and BusinessUnits[] reflects the active state (excluding BU).
    public int TotalExcluded { get; set; }
    public int HoldExpiredCount { get; set; }

    public List<ExclusionStateCount> States { get; set; } = new();
    public List<ExclusionBuCount> BusinessUnits { get; set; } = new();
}

public class ExclusionStateCount
{
    // 'overdue' | 'expiring-soon' | 'active' - matches the frontend dropdown vocabulary.
    public string State { get; set; } = "";
    public int TotalCount { get; set; }
}

public class ExclusionBuCount
{
    public string BusinessUnit { get; set; } = "";
    public int TotalCount { get; set; }
}

public class PatchServerItem
{
    public int ServerId { get; set; }
    public string ServerName { get; set; } = "";
    public string? PatchGroup { get; set; }
    public string? Service { get; set; }
    public string? Application { get; set; }
    public string? Environment { get; set; }
    public string? BusinessUnit { get; set; }
}
