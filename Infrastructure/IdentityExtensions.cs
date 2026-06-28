using System.Security.Claims;

namespace OperationsApi.Infrastructure;

public static class IdentityExtensions
{
    /// <summary>
    /// The caller's bare sAMAccountName from a Windows Negotiate identity. Strips a
    /// "DOMAIN\" prefix and an "@domain" (UPN) suffix; returns "" when unauthenticated.
    /// Compare case-insensitively (AD sAMAccountName casing is not guaranteed).
    /// </summary>
    public static string CurrentSam(this ClaimsPrincipal? user)
    {
        var raw = user?.Identity?.Name;
        if (string.IsNullOrEmpty(raw)) return "";

        var slash = raw.IndexOf('\\');
        if (slash >= 0) raw = raw[(slash + 1)..];

        var at = raw.IndexOf('@');
        if (at >= 0) raw = raw[..at];

        return raw;
    }
}
