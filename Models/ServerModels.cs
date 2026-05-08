namespace OperationsApi.Models;

public class Server
{
    public int ServerId { get; set; }
    public string ServerName { get; set; } = "";
    public string? Fqdn { get; set; }
    public string? IpAddress { get; set; }
    public string? Environment { get; set; }
    public string? ApplicationName { get; set; }
    public string? Service { get; set; }
    public string? Func { get; set; }
    public string? PatchGroup { get; set; }
    public string? BusinessUnit { get; set; }
    public bool IsActive { get; set; }
    public DateTime? LastSeen { get; set; }
}

public class ServerDetail : Server
{
    public string? OperatingSystem { get; set; }
    public string? Location { get; set; }
    public string? PrimaryContact { get; set; }
}

/// <summary>
/// One row of the server's patch cycle history. Status is computed in the
/// service: 'held' if an active patch_exclusion covers the cycle date,
/// 'patched' if the cycle date is in the past, otherwise 'scheduled'.
/// Optimistic until Ivanti reconciliation populates patch_schedule.patch_status —
/// see CLAUDE.md.
/// </summary>
public class ServerPatchHistoryItem
{
    public int CycleId { get; set; }
    public DateOnly CycleDate { get; set; }
    public string PatchGroup { get; set; } = "";
    public string Status { get; set; } = "";
}

public class ServerMatch
{
    public int ServerId { get; set; }
    public string ServerName { get; set; } = "";
    public string MatchType { get; set; } = "";
}

public class ServerSummary
{
    // Top-level counts respect the optional environment + businessUnit filters
    // on the query string. The breakdown lists are cross-facet scoped — env
    // counts reflect the current BU filter (excluding env from its own scope),
    // and BU counts reflect the current env filter (excluding BU).
    public int TotalCount { get; set; }
    public int ActiveCount { get; set; }
    public Dictionary<string, EnvironmentCount> EnvironmentCounts { get; set; } = new();
    public Dictionary<string, BusinessUnitCount> BusinessUnitCounts { get; set; } = new();
}

public class EnvironmentCount
{
    public int Total { get; set; }
    public int Active { get; set; }
}

public class BusinessUnitCount
{
    public int Total { get; set; }
    public int Active { get; set; }
}

public class UnreachableServer
{
    public string ServerName { get; set; } = "";
    public string? Environment { get; set; }
    public DateTime? LastSeen { get; set; }
    public string? ScanType { get; set; }
    public int FailureCount { get; set; }
}

public class UnmatchedServer
{
    public string ServerNameRaw { get; set; } = "";
    public string? ServerNameNormalized { get; set; }
    public string SourceSystem { get; set; } = "";
    public int OccurrenceCount { get; set; }
    public DateTime FirstSeenAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public string? ClosestMatch { get; set; }
}
