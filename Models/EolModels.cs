namespace OperationsApi.Models;

public class EolSummary
{
    public int EolCount { get; set; }
    public int ExtendedCount { get; set; }
    public int ApproachingCount { get; set; }
    public int SupportedCount { get; set; }
    public int UnknownCount { get; set; }
    public int TotalCount { get; set; }
    public int AffectedServers { get; set; }
}

public class EolSoftware
{
    public string Product { get; set; } = "";
    public string Version { get; set; } = "";
    public DateTime? EndOfLife { get; set; }
    public DateTime? EndOfExtendedSupport { get; set; }
    public DateTime? EndOfSupport { get; set; }
    public string AlertLevel { get; set; } = "";
    public int AffectedAssets { get; set; }
}

public class EolSoftwareDetail : EolSoftware
{
    public string? Tag { get; set; }
    public List<string> Assets { get; set; } = new();
}

public class UnmatchedEolSoftware
{
    public int UnmatchedId { get; set; }
    public string RawSoftwareName { get; set; } = "";
    public string? RawSoftwareVersion { get; set; }
    public string SourceSystem { get; set; } = "";
    public string? SampleMachineName { get; set; }
    public string Status { get; set; } = "";
    public DateTime FirstSeenAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public int OccurrenceCount { get; set; }
}
