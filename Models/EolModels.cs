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
