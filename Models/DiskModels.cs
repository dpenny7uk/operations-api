namespace OperationsApi.Models;

public class DiskSummary
{
    // Top-level counts respect the optional environment + businessUnit filters
    // on the query string. The breakdown lists below stay unscoped so the
    // dropdown labels always show every option's independent count.
    public int TotalCount { get; set; }
    public int OkCount { get; set; }
    public int WarningCount { get; set; }
    public int CriticalCount { get; set; }

    public List<DiskEnvCount> Environments { get; set; } = new();
    public List<DiskBuCount> BusinessUnits { get; set; } = new();
    public List<DiskAlertStatusCount> AlertStatuses { get; set; } = new();
}

public class DiskEnvCount
{
    public string Environment { get; set; } = "";
    public int TotalCount { get; set; }
    public int OkCount { get; set; }
    public int WarningCount { get; set; }
    public int CriticalCount { get; set; }
}

public class DiskBuCount
{
    public string BusinessUnit { get; set; } = "";
    public int TotalCount { get; set; }
    public int OkCount { get; set; }
    public int WarningCount { get; set; }
    public int CriticalCount { get; set; }
}

public class DiskAlertStatusCount
{
    public short AlertStatus { get; set; } // 1 = OK, 2 = Warning, 3 = Critical
    public int TotalCount { get; set; }
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

    // Linear-regression projection - null when slope <= 0 (disk stable or shrinking).
    public double? DaysUntilCritical { get; set; }
}

public class DiskHistoryPoint
{
    public DateTime CapturedAt { get; set; }
    public decimal UsedGb { get; set; }
    public decimal PercentUsed { get; set; }
}
