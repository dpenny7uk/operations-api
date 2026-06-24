namespace OperationsApi.Infrastructure;

/// <summary>
/// Signals a request that conflicts with current state (maps to HTTP 409).
/// Thrown by services for expected, user-correctable conflicts — e.g. inserting a
/// duplicate active row that a partial unique index forbids. BaseService.RunDbAsync
/// deliberately does NOT error-log these (they're client errors, not faults).
/// </summary>
public class ConflictException : Exception
{
    public ConflictException(string message) : base(message) { }
}
