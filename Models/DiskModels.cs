namespace OperationsApi.Models;

public class DiskSummary
{
    public int TotalCount { get; set; }
    public int OkCount { get; set; }
    public int WarningCount { get; set; }
    public int CriticalCount { get; set; }

    // Per-environment breakdown — drives the env filter's "Production (466)"
    // labels and lets the KPI strip reflect the active env without re-fetching.
    public List<DiskEnvCount> Environments { get; set; } = new();
}

public class DiskEnvCount
{
    public string Environment { get; set; } = "";
    public int TotalCount { get; set; }
    public int OkCount { get; set; }
    public int WarningCount { get; set; }
    public int CriticalCount { get; set; }
}

public class Disk
{
    public string ServerName { get; set; } = "";
    public string DiskLabel { get; set; } = "";
    public string? Service { get; set; }
    public string? Environment { get; set; }
    public string? TechnicalOwner { get; set; }
    public string? BusinessOwner { get; set; }
    public string? BusinessUnit { get; set; }
    public string? Tier { get; set; }
    public decimal VolumeSizeGb { get; set; }
    public decimal UsedGb { get; set; }
    public decimal FreeGb { get; set; }
    public decimal PercentUsed { get; set; }
    public short AlertStatus { get; set; }
    public decimal ThresholdWarnPct { get; set; }
    public decimal ThresholdCritPct { get; set; }
    public DateTime CapturedAt { get; set; }

    // Linear-regression projection — null when slope <= 0 (disk stable or shrinking).
    public double? DaysUntilCritical { get; set; }
}

public class DiskHistoryPoint
{
    public DateTime CapturedAt { get; set; }
    public decimal UsedGb { get; set; }
    public decimal PercentUsed { get; set; }
}
