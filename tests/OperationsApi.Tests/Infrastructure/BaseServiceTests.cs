using System.Data;
using Dapper;
using Microsoft.Extensions.Logging.Abstractions;
using OperationsApi.Infrastructure;
using Xunit;

namespace OperationsApi.Tests.Infrastructure;

/// <summary>
/// Concrete subclass to expose protected static methods for testing.
/// </summary>
public class TestableService : BaseService<TestableService>
{
    public TestableService() : base(
        new Moq.Mock<IDbConnection>().Object,
        NullLogger<TestableService>.Instance) { }

    public static string TestEscapeLike(string value) => EscapeLike(value);

    public static void TestAddILikeFilter(
        ref string sql, DynamicParameters p, string column, string paramName,
        string? value, bool prefix = true, bool suffix = true)
        => AddILikeFilter(ref sql, p, column, paramName, value, prefix, suffix);

    public static void TestAddExactFilter(
        ref string sql, DynamicParameters p, string column, string paramName, string? value)
        => AddExactFilter(ref sql, p, column, paramName, value);

    public static void TestAddPagination(
        ref string sql, DynamicParameters p, int limit, int offset = 0, string orderBy = "")
        => AddPagination(ref sql, p, limit, offset, orderBy);
}

// ── EscapeLike ──────────────────────────────────────────────────────────────

public class EscapeLikeTests
{
    [Fact]
    public void Escapes_percent()
        => Assert.Equal("\\%", TestableService.TestEscapeLike("%"));

    [Fact]
    public void Escapes_underscore()
        => Assert.Equal("\\_", TestableService.TestEscapeLike("_"));

    [Fact]
    public void Escapes_backslash()
        => Assert.Equal("\\\\", TestableService.TestEscapeLike("\\"));

    [Fact]
    public void Escapes_combined()
        => Assert.Equal("a\\%b\\_c\\\\d", TestableService.TestEscapeLike("a%b_c\\d"));

    [Fact]
    public void Empty_string_unchanged()
        => Assert.Equal("", TestableService.TestEscapeLike(""));

    [Fact]
    public void Safe_input_unchanged()
        => Assert.Equal("hello world", TestableService.TestEscapeLike("hello world"));
}

// ── AddILikeFilter ──────────────────────────────────────────────────────────

public class AddILikeFilterTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Null_or_empty_value_skips_filter(string? value)
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddILikeFilter(ref sql, p, "col", "P", value);

        Assert.Equal("SELECT 1", sql);
    }

    [Fact]
    public void Generates_ilike_with_escape_clause()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddILikeFilter(ref sql, p, "s.name", "Name", "test");

        Assert.Contains("ILIKE @Name ESCAPE '\\'", sql);
    }

    [Fact]
    public void Default_adds_both_wildcards()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddILikeFilter(ref sql, p, "col", "P", "test");

        Assert.Equal("%test%", p.Get<string>("P"));
    }

    [Fact]
    public void Prefix_only()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddILikeFilter(ref sql, p, "col", "P", "test", prefix: true, suffix: false);

        Assert.Equal("%test", p.Get<string>("P"));
    }

    [Fact]
    public void Suffix_only()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddILikeFilter(ref sql, p, "col", "P", "test", prefix: false, suffix: true);

        Assert.Equal("test%", p.Get<string>("P"));
    }

    [Fact]
    public void No_wildcards()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddILikeFilter(ref sql, p, "col", "P", "test", prefix: false, suffix: false);

        Assert.Equal("test", p.Get<string>("P"));
    }

    [Fact]
    public void Escapes_metacharacters_in_value()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddILikeFilter(ref sql, p, "col", "P", "100%_done");

        Assert.Equal("%100\\%\\_done%", p.Get<string>("P"));
    }
}

// ── AddExactFilter ──────────────────────────────────────────────────────────

public class AddExactFilterTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Null_or_empty_value_skips_filter(string? value)
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddExactFilter(ref sql, p, "col", "P", value);

        Assert.Equal("SELECT 1", sql);
    }

    [Fact]
    public void Generates_equals_clause()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddExactFilter(ref sql, p, "s.env", "Env", "prod");

        Assert.Contains("AND s.env = @Env", sql);
        Assert.Equal("prod", p.Get<string>("Env"));
    }
}

// ── AddPagination ───────────────────────────────────────────────────────────

public class AddPaginationTests
{
    [Fact]
    public void Adds_limit()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddPagination(ref sql, p, 50);

        Assert.Contains("LIMIT @Limit", sql);
        Assert.Equal(50, p.Get<int>("Limit"));
    }

    [Fact]
    public void Omits_offset_when_zero()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddPagination(ref sql, p, 50, 0);

        Assert.DoesNotContain("OFFSET", sql);
    }

    [Fact]
    public void Adds_offset_when_positive()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddPagination(ref sql, p, 50, 10);

        Assert.Contains("OFFSET @Offset", sql);
        Assert.Equal(10, p.Get<int>("Offset"));
    }

    [Fact]
    public void Valid_order_by_column_added()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddPagination(ref sql, p, 50, 0, "s.server_name");

        Assert.Contains("ORDER BY s.server_name", sql);
    }

    [Fact]
    public void Invalid_order_by_column_throws()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        Assert.Throws<ArgumentException>(() =>
            TestableService.TestAddPagination(ref sql, p, 50, 0, "DROP TABLE users; --"));
    }

    [Fact]
    public void Empty_order_by_skips_clause()
    {
        var sql = "SELECT 1";
        var p = new DynamicParameters();

        TestableService.TestAddPagination(ref sql, p, 50, 0, "");

        Assert.DoesNotContain("ORDER BY", sql);
    }
}
