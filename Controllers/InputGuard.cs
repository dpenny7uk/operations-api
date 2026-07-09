namespace OperationsApi.Controllers;

internal static class InputGuard
{
    // True if the string contains ASCII control characters (tab, newline, CR, DEL).
    public static bool ContainsControlChars(string? s) =>
        s != null && s.Any(c => c < 0x20 || c == 0x7F);

    // Like ContainsControlChars but permits the common whitespace controls
    // (tab, newline, carriage return). For free-text multi-line fields - e.g. a
    // notes textarea - where line breaks are legitimate input.
    public static bool ContainsControlCharsExceptWhitespace(string? s) =>
        s != null && s.Any(c => (c < 0x20 && c is not ('\t' or '\n' or '\r')) || c == 0x7F);

    // Standard bounded-text guard: returns an error message when value is non-null and
    // either exceeds maxLen or contains control characters, else null. Set allowNewlines
    // for multi-line free-text fields (e.g. a notes textarea) where tab/newline/CR are ok.
    public static string? InvalidText(string? value, int maxLen, string field, bool allowNewlines = false)
    {
        if (value == null) return null;
        var hasControl = allowNewlines ? ContainsControlCharsExceptWhitespace(value) : ContainsControlChars(value);
        return value.Length > maxLen || hasControl
            ? $"{field} is invalid (max {maxLen} characters)."
            : null;
    }
}
