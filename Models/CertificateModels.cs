namespace OperationsApi.Models;

public class CertificateSummary
{
    // Top-level counts respect the optional businessUnit + level filters on the
    // query string. The breakdown lists below are cross-facet scoped - Levels
    // counts reflect the active BU filter (excluding level), and BusinessUnits
    // counts reflect the active level filter (excluding BU).
    public int CriticalCount { get; set; }
    public int WarningCount { get; set; }
    public int OkCount { get; set; }
    public int ExpiredCount { get; set; }
    public int TotalCount { get; set; }

    public List<CertificateLevelCount> Levels { get; set; } = new();
    public List<CertificateBuCount> BusinessUnits { get; set; } = new();
}

public class CertificateLevelCount
{
    public string Level { get; set; } = ""; // 'expired' | 'crit' | 'warn' | 'ok'
    public int TotalCount { get; set; }
}

public class CertificateBuCount
{
    public string BusinessUnit { get; set; } = "";
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
    public bool IsExpired { get; set; }
    public string? ServiceName { get; set; }
    public string? BusinessUnit { get; set; }
}

public class CertificateDetail : Certificate
{
    public string? Issuer { get; set; }
    public DateTime? ValidFrom { get; set; }
    public string? Thumbprint { get; set; }
    public int? Port { get; set; }
    public bool IsActive { get; set; }
    public DateTime? LastScannedAt { get; set; }
}
