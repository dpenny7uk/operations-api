namespace OperationsApi.Models;

// ============================================
// SHARED
// ============================================

public class PagedResult<T>
{
    public IEnumerable<T> Items { get; set; } = [];
    public int TotalCount { get; set; }
    public int Limit { get; set; }
    public int Offset { get; set; }
}

// ============================================
// HEALTH MODELS
// ============================================

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

// ============================================
// SERVER MODELS
// ============================================

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

// ============================================
// PATCHING MODELS
// ============================================

public class PatchCycle
{
    public int CycleId { get; set; }
    public DateTime CycleDate { get; set; }
    public int ServerCount { get; set; }
    public string Status { get; set; } = "";
}

public class NextPatchingSummary
{
    public PatchCycle Cycle { get; set; } = new();
    public int DaysUntil { get; set; }
    public Dictionary<string, int> ServersByGroup { get; set; } = new();
    public Dictionary<string, int> IssuesBySeverity { get; set; } = new();
    public int TotalIssuesAffectingServers { get; set; }
}

public class PatchScheduleItem
{
    public int ScheduleId { get; set; }
    public string ServerName { get; set; } = "";
    public string? PatchGroup { get; set; }
    public string? ScheduledTime { get; set; }
    public string? Application { get; set; }
    public bool HasKnownIssue { get; set; }
    public int IssueCount { get; set; }
}

public class KnownIssue
{
    public int IssueId { get; set; }
    public string Title { get; set; } = "";
    public string Severity { get; set; } = "";
    public string? Application { get; set; }
    public string? Fix { get; set; }
    public bool AppliesToWindows { get; set; }
    public bool AppliesToSql { get; set; }
    public bool AppliesToOther { get; set; }
}

public class KnownIssueDetail : KnownIssue
{
    public string? TriggerDescription { get; set; }
    public string? Signature { get; set; }
    public string? CategoryNotes { get; set; }
    public string? ConfluenceUrl { get; set; }
    public bool IsActive { get; set; }
    public DateTime? LastSyncedAt { get; set; }
}

public class PatchWindow
{
    public string PatchGroup { get; set; } = "";
    public string WindowType { get; set; } = "";
    public string? ScheduledTime { get; set; }
    public int? DurationMinutes { get; set; }
}

// ============================================
// CERTIFICATE MODELS
// ============================================

public class CertificateSummary
{
    public int CriticalCount { get; set; }
    public int WarningCount { get; set; }
    public int OkCount { get; set; }
    public int TotalCount { get; set; }
}

public class Certificate
{
    public int CertId { get; set; }
    public string SubjectCn { get; set; } = "";
    public string ServerName { get; set; } = "";
    public DateTime ValidTo { get; set; }
    public int DaysUntilExpiry { get; set; }
    public string AlertLevel { get; set; } = "";
}

public class CertificateDetail : Certificate
{
    public string? Issuer { get; set; }
    public DateTime? ValidFrom { get; set; }
    public string? Thumbprint { get; set; }
    public int? Port { get; set; }
    public string? ServiceName { get; set; }
    public bool IsActive { get; set; }
    public DateTime? LastScannedAt { get; set; }
}

// ============================================
// END-OF-LIFE MODELS
// ============================================

public class EolSummary
{
    public int EolCount { get; set; }
    public int ApproachingCount { get; set; }
    public int SupportedCount { get; set; }
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
