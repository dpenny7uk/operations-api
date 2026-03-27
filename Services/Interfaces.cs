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
        string? search,
        int limit,
        int offset);
    
    Task<int> CountServersAsync(
        string? environment,
        string? application,
        string? patchGroup,
        string? search);
    Task<ServerSummary> GetServerSummaryAsync();
    Task<ServerDetail?> GetServerByIdAsync(int id);
    Task<ServerMatch?> ResolveServerNameAsync(string name);
    Task<IEnumerable<UnmatchedServer>> GetUnmatchedServersAsync(string? source, int limit);
    Task<IEnumerable<UnreachableServer>> GetUnreachableServersAsync(int limit);
    Task CreateAliasAsync(string canonical, string alias, string? source, string actingUser);
    Task<int> ResolveUnmatchedServerAsync(string raw, int serverId, string canonicalName, string? sourceSystem = null, string? actingUser = null);
    Task IgnoreUnmatchedServerAsync(string raw, string? sourceSystem = null, string? actingUser = null);
}

public interface IPatchingService
{
    Task<NextPatchingSummary?> GetNextPatchingSummaryAsync();
    Task<IEnumerable<PatchCycle>> ListPatchCyclesAsync(bool upcomingOnly, int limit);
    Task<PagedResult<PatchScheduleItem>> GetCycleServersAsync(int cycleId, string? patchGroup, bool? hasIssues, string? search, int limit = 100, int offset = 0);
    Task<IEnumerable<KnownIssue>> ListKnownIssuesAsync(string? severity, string? app, string? patchType, bool activeOnly);
    Task<IEnumerable<GlobalServerSearchResult>> SearchServersGlobalAsync(string query, int limit);
    Task<KnownIssueDetail?> GetKnownIssueByIdAsync(int id);
    Task<IEnumerable<PatchWindow>> GetPatchWindowsAsync();
    Task<bool> UpdateCycleStatusAsync(int cycleId, string status);
}

public interface ICertificateService
{
    Task<CertificateSummary> GetSummaryAsync();
    Task<IEnumerable<Certificate>> ListCertificatesAsync(string? alertLevel, string? server, int? daysUntil, int limit);
    Task<CertificateDetail?> GetByIdAsync(int id);
    Task<IEnumerable<Certificate>> GetByServerAsync(string server, int limit = 500);
}

public interface IPatchExclusionService
{
    Task<PatchExclusionSummary> GetExclusionSummaryAsync();
    Task<PagedResult<PatchExclusion>> ListExclusionsAsync(string? search, int limit, int offset);
    Task<PagedResult<PatchServerItem>> SearchPatchServersAsync(string? search, int limit, int offset);
    Task<int> ExcludeServersAsync(List<int> serverIds, string reason, DateOnly heldUntil, string excludedBy);
    Task<bool> ExtendExclusionAsync(int exclusionId, DateOnly newHeldUntil, string extendedBy);
    Task<bool> RemoveExclusionAsync(int exclusionId, string removedBy);
}

public interface IEolService
{
    Task<EolSummary> GetSummaryAsync(bool hasServers = false);
    Task<IEnumerable<EolSoftware>> ListEolSoftwareAsync(string? alertLevel, string? product, int limit, bool hasServers = false);
    Task<EolSoftwareDetail?> GetByProductVersionAsync(string product, string version);
    Task<IEnumerable<EolSoftware>> GetByServerAsync(string serverName, int limit = 500);
}
