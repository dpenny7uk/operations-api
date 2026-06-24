using System.Data;
using Dapper;
using Npgsql;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class LicensingService : BaseService<LicensingService>, ILicensingService
{
    public LicensingService(IDbConnection db, ILogger<LicensingService> logger)
        : base(db, logger) { }

    // Shared SELECT list -> aliases match the model property names so Dapper maps
    // by name. (The snake_case JsonPropertyName attributes are wire-only and do not
    // affect Dapper's column->property binding.)
    private const string DetailColumns = @"
        licence_id AS LicenceId,
        application_id AS ApplicationId,
        application_name AS ApplicationName,
        vendor AS Vendor,
        product AS Product,
        licence_type AS LicenceType,
        quantity_held AS QuantityHeld,
        audit_frequency AS AuditFrequency,
        audit_owner_sam AS AuditOwnerSam,
        expires_at AS ExpiresAt,
        notice_period_days AS NoticePeriodDays,
        status_flag AS StatusFlag,
        notes AS Notes,
        is_active AS IsActive,
        created_at AS CreatedAt,
        updated_at AS UpdatedAt";

    public Task<IEnumerable<LicenceDetail>> ListAsync(string? vendor, string? status, string? search, int limit) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT {DetailColumns}
            FROM {Sql.Tables.Licences}
            WHERE is_active";

        var p = new DynamicParameters();
        AddExactFilter(ref sql, p, "vendor", "Vendor", vendor);
        AddExactFilter(ref sql, p, "status_flag", "Status", status);

        if (!string.IsNullOrEmpty(search))
        {
            sql += @" AND (application_name ILIKE @Search ESCAPE '\'
                       OR vendor ILIKE @Search ESCAPE '\'
                       OR product ILIKE @Search ESCAPE '\')";
            p.Add("Search", $"%{EscapeLike(search)}%");
        }

        sql += " ORDER BY expires_at LIMIT @Limit";
        p.Add("Limit", limit);

        var licences = (await Db.QueryAsync<LicenceDetail>(sql, p)).ToList();
        if (licences.Count == 0) return Enumerable.Empty<LicenceDetail>();

        // One grouped query for all renewals (no N+1), then attach by licence_id.
        var ids = licences.Select(l => l.LicenceId).ToArray();
        var renewals = await Db.QueryAsync<Renewal>($@"
            SELECT
                renewal_id AS RenewalId,
                licence_id AS LicenceId,
                cycle_ended AS CycleEnded,
                renewed_on AS RenewedOn,
                new_expires AS NewExpires,
                renewed_by AS RenewedBy,
                notes AS Notes
            FROM {Sql.Tables.Renewals}
            WHERE licence_id = ANY(@Ids)
            ORDER BY renewed_on DESC, renewal_id DESC",
            new { Ids = ids });

        var byLicence = renewals.GroupBy(r => r.LicenceId).ToDictionary(g => g.Key, g => g.ToList());
        foreach (var l in licences)
            l.Renewals = byLicence.TryGetValue(l.LicenceId, out var rs) ? rs : new List<Renewal>();

        return licences;
    });

    public Task<LicenceDetail?> GetByIdAsync(int id) => RunDbAsync(() => LoadDetailAsync(id));

    public Task<LicenceDetail> CreateAsync(LicenceCreateRequest req, string actor) => RunDbAsync(async () =>
    {
        // application_id is resolved from the (UNIQUE) application_name when it matches
        // an entry in shared.applications; NULL otherwise.
        var id = await TranslateConflict(() => Db.ExecuteScalarAsync<int>($@"
            INSERT INTO {Sql.Tables.Licences}
                (application_id, application_name, vendor, product, licence_type, quantity_held,
                 audit_frequency, audit_owner_sam, expires_at, notice_period_days, status_flag, notes,
                 created_by, updated_by)
            VALUES
                ((SELECT application_id FROM {Sql.Tables.Applications} WHERE application_name = @ApplicationName),
                 @ApplicationName, @Vendor, @Product, @LicenceType, @QuantityHeld,
                 @AuditFrequency, @AuditOwnerSam, @ExpiresAt, @NoticePeriodDays,
                 COALESCE(NULLIF(@StatusFlag, ''), 'tracked'), @Notes,
                 @Actor, @Actor)
            RETURNING licence_id",
            new
            {
                req.ApplicationName, req.Vendor, req.Product, req.LicenceType, req.QuantityHeld,
                req.AuditFrequency, req.AuditOwnerSam, req.ExpiresAt, req.NoticePeriodDays,
                req.StatusFlag, req.Notes, Actor = actor
            }));

        return (await LoadDetailAsync(id))!;
    });

    public Task<LicenceDetail?> PatchAsync(int id, LicencePatchRequest req, string actor) => RunDbAsync(async () =>
    {
        var sets = new List<string>();
        var p = new DynamicParameters();
        p.Add("Id", id);
        p.Add("Actor", actor);

        if (req.ApplicationName != null)
        {
            sets.Add("application_name = @ApplicationName");
            sets.Add($"application_id = (SELECT application_id FROM {Sql.Tables.Applications} WHERE application_name = @ApplicationName)");
            p.Add("ApplicationName", req.ApplicationName);
        }
        if (req.LicenceType != null) { sets.Add("licence_type = @LicenceType"); p.Add("LicenceType", req.LicenceType); }
        if (req.QuantityHeld != null) { sets.Add("quantity_held = @QuantityHeld"); p.Add("QuantityHeld", req.QuantityHeld.Value); }
        if (req.AuditFrequency != null) { sets.Add("audit_frequency = @AuditFrequency"); p.Add("AuditFrequency", req.AuditFrequency); }
        if (req.AuditOwnerSam != null) { sets.Add("audit_owner_sam = @AuditOwnerSam"); p.Add("AuditOwnerSam", req.AuditOwnerSam); }
        if (req.ExpiresAt != null) { sets.Add("expires_at = @ExpiresAt"); p.Add("ExpiresAt", req.ExpiresAt.Value); }
        if (req.NoticePeriodDays != null) { sets.Add("notice_period_days = @NoticePeriodDays"); p.Add("NoticePeriodDays", req.NoticePeriodDays.Value); }
        if (req.StatusFlag != null) { sets.Add("status_flag = @StatusFlag"); p.Add("StatusFlag", req.StatusFlag); }
        if (req.Notes != null) { sets.Add("notes = @Notes"); p.Add("Notes", req.Notes); }

        // Nothing to change -> return the current state (or null if it doesn't exist).
        if (sets.Count == 0) return await LoadDetailAsync(id);

        sets.Add("updated_by = @Actor");
        sets.Add("updated_at = CURRENT_TIMESTAMP");

        var rows = await TranslateConflict(() => Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Licences}
            SET {string.Join(", ", sets)}
            WHERE licence_id = @Id AND is_active", p));

        return rows == 0 ? null : await LoadDetailAsync(id);
    });

    // The partial unique index idx_licence_active_vpa forbids two active licences
    // with the same (vendor, product, application_id). Translate that violation
    // into a domain conflict so the controller returns 409 instead of a 500 - on
    // both INSERT and an application-changing UPDATE.
    private static async Task<T> TranslateConflict<T>(Func<Task<T>> op)
    {
        try
        {
            return await op();
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new ConflictException("A licence for this vendor, product and application already exists.");
        }
    }

    public Task<bool> DeleteAsync(int id, string actor) => RunDbAsync(async () =>
        await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Licences}
            SET is_active = FALSE, updated_by = @Actor, updated_at = CURRENT_TIMESTAMP
            WHERE licence_id = @Id AND is_active",
            new { Id = id, Actor = actor }) > 0);

    public Task<LicenceDetail?> RenewAsync(int id, DateOnly newExpires, string? notes, string actor) => RunDbAsync(async () =>
    {
        if (Db.State != ConnectionState.Open) Db.Open();
        using var tx = Db.BeginTransaction();

        // Read the licence's current expiry (becomes the closing cycle's cycle_ended).
        var before = await LoadDetailAsync(id, tx);
        if (before == null)
        {
            tx.Rollback();
            return null;
        }

        // 1) record the closing cycle
        await Db.ExecuteAsync($@"
            INSERT INTO {Sql.Tables.Renewals}
                (licence_id, cycle_ended, renewed_on, new_expires, renewed_by, notes)
            VALUES (@Id, @CycleEnded, CURRENT_DATE, @NewExpires, @Actor, @Notes)",
            new { Id = id, CycleEnded = before.ExpiresAt, NewExpires = newExpires, Actor = actor, Notes = notes }, tx);

        // 2) advance the licence and reset the renewal status
        await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Licences}
            SET expires_at = @NewExpires,
                status_flag = 'tracked',
                updated_by = @Actor,
                updated_at = CURRENT_TIMESTAMP
            WHERE licence_id = @Id",
            new { Id = id, NewExpires = newExpires, Actor = actor }, tx);

        // 3) clear alert rows so the next cycle's thresholds re-fire cleanly
        await Db.ExecuteAsync($@"
            DELETE FROM {Sql.Tables.LicenceAlerts} WHERE licence_id = @Id",
            new { Id = id }, tx);

        tx.Commit();

        return await LoadDetailAsync(id);
    });

    // Loads a licence + its renewal history. tx is passed while inside RenewAsync's
    // transaction; null otherwise.
    private async Task<LicenceDetail?> LoadDetailAsync(int id, IDbTransaction? tx = null)
    {
        var detail = await Db.QueryFirstOrDefaultAsync<LicenceDetail>($@"
            SELECT {DetailColumns}
            FROM {Sql.Tables.Licences}
            WHERE licence_id = @Id AND is_active",
            new { Id = id }, tx);

        if (detail == null) return null;

        var renewals = await Db.QueryAsync<Renewal>($@"
            SELECT
                renewal_id AS RenewalId,
                licence_id AS LicenceId,
                cycle_ended AS CycleEnded,
                renewed_on AS RenewedOn,
                new_expires AS NewExpires,
                renewed_by AS RenewedBy,
                notes AS Notes
            FROM {Sql.Tables.Renewals}
            WHERE licence_id = @Id
            ORDER BY renewed_on DESC, renewal_id DESC",
            new { Id = id }, tx);

        detail.Renewals = renewals.ToList();
        return detail;
    }
}
