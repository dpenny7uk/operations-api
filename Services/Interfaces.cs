using OperationsApi.Models;

namespace OperationsApi.Services;

public interface IHealthService
{
    Task<HealthSummary> GetHealthSummaryAsync();
    Task<IEnumerable<SyncStatus>> GetSyncStatusesAsync();
    Task<IEnumerable<SyncHistory>> GetSyncHistoryAsync(string syncName, int limit);
    Task<IEnumerable<ValidationRunResult>> RunValidationAsync(string? ruleName);
}

public interface IServerService
{
    Task<IEnumerable<Server>> ListServersAsync(
        string? environment,
        string? application,
        string? patchGroup,
        string? businessUnit,
        string? search,
        int limit,
        int offset);

    Task<int> CountServersAsync(
        string? environment,
        string? application,
        string? patchGroup,
        string? businessUnit,
        string? search);
    Task<ServerSummary> GetServerSummaryAsync(string? environment = null, string? businessUnit = null);
    Task<ServerDetail?> GetServerByIdAsync(int id);
    Task<IEnumerable<ServerPatchHistoryItem>> GetPatchHistoryAsync(int serverId, int limit = 50);
    Task<ServerMatch?> ResolveServerNameAsync(string name);
    Task<IEnumerable<UnmatchedServer>> GetUnmatchedServersAsync(string? source, int limit, string? businessUnit = null);
    Task<IEnumerable<UnreachableServer>> GetUnreachableServersAsync(int limit, string? businessUnit = null);
    Task CreateAliasAsync(string canonical, string alias, string? source, string actingUser);
    Task<int> ResolveUnmatchedServerAsync(string raw, int serverId, string canonicalName, string? sourceSystem = null, string? actingUser = null);
    Task IgnoreUnmatchedServerAsync(string raw, string? sourceSystem = null, string? actingUser = null);
}

public interface IPatchingService
{
    Task<NextPatchingSummary?> GetNextPatchingSummaryAsync(string? businessUnit = null);
    Task<IEnumerable<PatchCycle>> ListPatchCyclesAsync(bool upcomingOnly, int limit, string? businessUnit = null);
    Task<PagedResult<PatchScheduleItem>> GetCycleServersAsync(int cycleId, string? patchGroup, bool? hasIssues, string? search, int limit = 100, int offset = 0);
    Task<IEnumerable<KnownIssue>> ListKnownIssuesAsync(string? severity, string? app, string? patchType, bool activeOnly);
    Task<IEnumerable<GlobalServerSearchResult>> SearchServersGlobalAsync(string query, int limit);
    Task<KnownIssueDetail?> GetKnownIssueByIdAsync(int id);
    Task<IEnumerable<PatchWindow>> GetPatchWindowsAsync();
    Task<bool> UpdateCycleStatusAsync(int cycleId, string status);
}

public interface ICertificateService
{
    Task<CertificateSummary> GetSummaryAsync(string? businessUnit = null, string? level = null);
    Task<IEnumerable<Certificate>> ListCertificatesAsync(string? alertLevel, string? server, int? daysUntil, int limit, string? businessUnit = null);
    Task<CertificateDetail?> GetByIdAsync(int id);
    Task<IEnumerable<Certificate>> GetByServerAsync(string server, int limit = 500);
}

public interface IPatchExclusionService
{
    Task<PatchExclusionSummary> GetExclusionSummaryAsync(string? businessUnit = null, string? state = null);
    Task<PagedResult<PatchExclusion>> ListExclusionsAsync(string? search, int limit, int offset, string? businessUnit = null, string? state = null);
    Task<PagedResult<PatchServerItem>> SearchPatchServersAsync(string? search, int limit, int offset);
    Task<int> ExcludeServersAsync(List<int> serverIds, string reason, DateOnly heldUntil, string excludedBy,
        string? ticket = null, string? reasonSlug = null, string? notes = null);
    Task<int> BulkExcludeAsync(string kind, string target, string reason, DateOnly heldUntil, string excludedBy,
        string? ticket = null, string? reasonSlug = null, string? notes = null);
    Task<bool> ExtendExclusionAsync(int exclusionId, DateOnly newHeldUntil, string extendedBy);
    Task<bool> UpdateExclusionAsync(int exclusionId, DateOnly? newHeldUntil, string? notes, string actingUser);
    Task<bool> RemoveExclusionAsync(int exclusionId, string removedBy);
}

public interface IAlertsService
{
    Task<IEnumerable<RecentAlert>> GetRecentAlertsAsync(int limit);
}

public interface IEolService
{
    Task<EolSummary> GetSummaryAsync(bool hasServers = false, string? businessUnit = null);
    Task<IEnumerable<EolSoftware>> ListEolSoftwareAsync(string? alertLevel, string? product, int limit, bool hasServers = false, string? businessUnit = null);
    Task<EolSoftwareDetail?> GetByProductVersionAsync(string product, string version, string? businessUnit = null);
    Task<IEnumerable<EolSoftware>> GetByServerAsync(string serverName, int limit = 500);
    Task<IEnumerable<UnmatchedEolSoftware>> GetUnmatchedSoftwareAsync(int limit);
}

public interface IDiskMonitoringService
{
    Task<DiskSummary> GetSummaryAsync(string? environment = null, string? businessUnit = null, int? alertStatus = null);
    Task<PagedResult<Disk>> ListDisksAsync(int limit, int offset, string? environment = null, string? businessUnit = null, int? alertStatus = null, string? serverName = null);
    Task<IEnumerable<DiskHistoryPoint>> GetHistoryAsync(string serverName, string diskLabel, int days);
}
