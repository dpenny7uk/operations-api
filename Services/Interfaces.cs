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
    
    Task<ServerDetail?> GetServerByIdAsync(int id);
    Task<ServerMatch?> ResolveServerNameAsync(string name);
    Task<IEnumerable<UnmatchedServer>> GetUnmatchedServersAsync(string? source, int limit);
    Task CreateAliasAsync(string canonical, string alias, string? source);
    Task ResolveUnmatchedServerAsync(string raw, int serverId);
    Task IgnoreUnmatchedServerAsync(string raw);
}

public interface IPatchingService
{
    Task<NextPatchingSummary?> GetNextPatchingSummaryAsync();
    Task<IEnumerable<PatchCycle>> ListPatchCyclesAsync(bool upcomingOnly, int limit);
    Task<IEnumerable<PatchScheduleItem>> GetCycleServersAsync(int cycleId, string? patchGroup, bool? hasIssues);
    Task<IEnumerable<KnownIssue>> ListKnownIssuesAsync(string? severity, string? app, string? patchType, bool activeOnly);
    Task<KnownIssueDetail?> GetKnownIssueByIdAsync(int id);
    Task<IEnumerable<PatchWindow>> GetPatchWindowsAsync();
}

public interface ICertificateService
{
    Task<CertificateSummary> GetSummaryAsync();
    Task<IEnumerable<Certificate>> ListCertificatesAsync(string? alertLevel, string? server, int? daysUntil, int limit);
    Task<CertificateDetail?> GetByIdAsync(int id);
    Task<IEnumerable<Certificate>> GetByServerAsync(string server);
}

public interface IEolService
{
    Task<EolSummary> GetSummaryAsync();
    Task<IEnumerable<EolSoftware>> ListEolSoftwareAsync(string? alertLevel, string? product, int limit);
    Task<EolSoftwareDetail?> GetByProductVersionAsync(string product, string version);
    Task<IEnumerable<EolSoftware>> GetByServerAsync(string serverName);
}
