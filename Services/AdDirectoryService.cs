using System.DirectoryServices;
using System.Runtime.Versioning;
using OperationsApi.Models;

namespace OperationsApi.Services;

public interface IAdDirectoryService
{
    /// <summary>Search Active Directory for security/distribution groups whose name
    /// matches the fragment. Binds as the host (app-pool) identity. Throws on
    /// directory errors — the caller maps that to 503.</summary>
    List<AdGroupResult> SearchGroups(string query, int limit);
}

/// <summary>
/// Live AD group search for the auditing binding picker, via System.DirectoryServices
/// (ADSI). Binds serverlessly to the current domain as the app-pool identity unless
/// Auditing:Ldap:RootPath overrides (e.g. "LDAP://DC=hiscox,DC=com"). Windows-only.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class AdDirectoryService : IAdDirectoryService
{
    private readonly string _rootPath;

    public AdDirectoryService(IConfiguration config)
        => _rootPath = config["Auditing:Ldap:RootPath"] ?? "";

    public List<AdGroupResult> SearchGroups(string query, int limit)
    {
        limit = Math.Clamp(limit, 1, 50);
        var safe = EscapeLdap(query);

        using var root = string.IsNullOrEmpty(_rootPath)
            ? new DirectoryEntry()
            : new DirectoryEntry(_rootPath);
        using var searcher = new DirectorySearcher(root)
        {
            Filter = $"(&(objectCategory=group)(|(cn=*{safe}*)(sAMAccountName=*{safe}*)))",
            PageSize = 256,
            SizeLimit = limit,
        };
        searcher.PropertiesToLoad.Add("distinguishedName");
        searcher.PropertiesToLoad.Add("sAMAccountName");
        searcher.PropertiesToLoad.Add("groupType");

        var results = new List<AdGroupResult>();
        using var found = searcher.FindAll();
        foreach (SearchResult r in found)
        {
            results.Add(new AdGroupResult
            {
                Dn = Prop(r, "distinguishedName") ?? "",
                Sam = Prop(r, "sAMAccountName"),
                GroupType = ClassifyGroupType(r),
            });
            if (results.Count >= limit) break;
        }
        return results;
    }

    private static string? Prop(SearchResult r, string name)
        => r.Properties.Contains(name) && r.Properties[name].Count > 0
            ? r.Properties[name][0]?.ToString()
            : null;

    // groupType bit 0x80000000 = security-enabled; otherwise a distribution group.
    private static string ClassifyGroupType(SearchResult r)
    {
        if (r.Properties.Contains("groupType") && r.Properties["groupType"].Count > 0
            && int.TryParse(r.Properties["groupType"][0]?.ToString(), out var gt))
            return (gt & unchecked((int)0x80000000)) != 0 ? "Security" : "Distribution";
        return "Security";
    }

    // Escape LDAP filter metacharacters in user input (RFC 4515) to block injection.
    private static string EscapeLdap(string s)
        => s.Replace("\\", "\\5c").Replace("*", "\\2a").Replace("(", "\\28")
            .Replace(")", "\\29").Replace("\0", "\\00").Replace("/", "\\2f");
}
