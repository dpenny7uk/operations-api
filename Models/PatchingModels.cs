namespace OperationsApi.Models;

public class PatchCycle
{
    public int CycleId { get; set; }
    public DateOnly CycleDate { get; set; }
    public int ServerCount { get; set; }
    public string Status { get; set; } = "";
    public string DisplayStatus { get; set; } = "";
}

public class NextPatchingSummary
{
    public PatchCycle Cycle { get; set; } = new();
    public int DaysUntil { get; set; }
    public List<DateOnly> CycleDates { get; set; } = new();
    public List<CycleDetailItem> CycleDetails { get; set; } = new();
    public Dictionary<string, int> ServersByGroup { get; set; } = new();
    public Dictionary<string, int> IssuesBySeverity { get; set; } = new();
    public int TotalIssuesAffectingServers { get; set; }
}

public class CycleDetailItem
{
    public DateOnly CycleDate { get; set; }
    public Dictionary<string, int> ServersByGroup { get; set; } = new();
}

public class PatchScheduleItem
{
    public int ScheduleId { get; set; }
    public string ServerName { get; set; } = "";
    public string? PatchGroup { get; set; }
    public string? ScheduledTime { get; set; }
    public string? Application { get; set; }
    public string? Service { get; set; }
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

public class GlobalServerSearchResult
{
    public int CycleId { get; set; }
    public DateOnly CycleDate { get; set; }
    public string DisplayStatus { get; set; } = "";
    public List<PatchScheduleItem> Servers { get; set; } = new();
    public int TotalCount { get; set; }
}

public class PatchWindow
{
    public string PatchGroup { get; set; } = "";
    public string WindowType { get; set; } = "";
    public string? ScheduledTime { get; set; }
    public int? DurationMinutes { get; set; }
}
