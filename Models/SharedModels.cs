namespace OperationsApi.Models;

public class PagedResult<T>
{
    public IEnumerable<T> Items { get; set; } = [];
    public int TotalCount { get; set; }
    public int Limit { get; set; }
    public int Offset { get; set; }
}
