namespace OperationsApi.Models;

public class CertificateSummary
{
    public int CriticalCount { get; set; }
    public int WarningCount { get; set; }
    public int OkCount { get; set; }
    public int ExpiredCount { get; set; }
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
