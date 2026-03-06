namespace OperationsApi.Models;

public class HealthSummary
{
    public string OverallStatus { get; set; } = "";
    public List<SyncStatus> SyncStatuses { get; set; } = new();
    public int UnmatchedServersCount { get; set; }
    public int UnreachableServersCount { get; set; }
    public DateTime LastUpdated { get; set; }
}

public class SyncStatus
{
    public string SyncName { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTime? LastSuccessAt { get; set; }
    public double? HoursSinceSuccess { get; set; }
    public string FreshnessStatus { get; set; } = "";
    public int RecordsProcessed { get; set; }
    public int ConsecutiveFailures { get; set; }
    public string? LastErrorMessage { get; set; }
    public string? ExpectedSchedule { get; set; }
}

public class SyncHistory
{
    public int HistoryId { get; set; }
    public string SyncName { get; set; } = "";
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string Status { get; set; } = "";
    public int RecordsProcessed { get; set; }
    public int RecordsInserted { get; set; }
    public int RecordsUpdated { get; set; }
    public int RecordsFailed { get; set; }
    public string? ErrorMessage { get; set; }
}

public class ValidationRunResult
{
    public string RuleName { get; set; } = "";
    public string Result { get; set; } = "";
    public int ViolationCount { get; set; }
    public int ExecutionTimeMs { get; set; }
}
