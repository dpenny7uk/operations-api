namespace OperationsApi.Models;

public class Server
{
    public int ServerId { get; set; }
    public string ServerName { get; set; } = "";
    public string? Fqdn { get; set; }
    public string? Environment { get; set; }
    public string? ApplicationName { get; set; }
    public string? PatchGroup { get; set; }
    public bool IsActive { get; set; }
}

public class ServerDetail : Server
{
    public string? OperatingSystem { get; set; }
    public string? IpAddress { get; set; }
    public string? Location { get; set; }
    public string? PrimaryContact { get; set; }
}

public class ServerMatch
{
    public int ServerId { get; set; }
    public string ServerName { get; set; } = "";
    public string MatchType { get; set; } = "";
}

public class ServerSummary
{
    public int TotalCount { get; set; }
    public int ActiveCount { get; set; }
    public Dictionary<string, EnvironmentCount> EnvironmentCounts { get; set; } = new();
}

public class EnvironmentCount
{
    public int Total { get; set; }
    public int Active { get; set; }
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
