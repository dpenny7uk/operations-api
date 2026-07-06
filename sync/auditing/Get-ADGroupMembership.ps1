#Requires -Version 5.1
#Requires -Modules ActiveDirectory
<#
.SYNOPSIS
    Resolves recursive AD group membership plus each member's manager for the
    access-attestation roster, and writes CSVs for sync_auditing.py.

.DESCRIPTION
    For each group distinguished name (from -GroupListPath):
      1. Recursively expands membership using the LDAP_MATCHING_RULE_IN_CHAIN
         matching rule (1.2.840.113556.1.4.1941) in a single query, reading each
         member's EmailAddress, DisplayName, Enabled and Manager.
      2. Resolves the distinct set of Manager DNs to sam account + email (cached
         so each manager is looked up once).

    Emits two timestamped CSV files to -OutputPath:
      auditing-members-<ts>.csv : group_dn, sam_account
      auditing-users-<ts>.csv   : sam_account, display_name, email, enabled,
                                  manager_sam, manager_dn, manager_email

    ASCII-only (Windows PowerShell 5.1 on the domain agent). No WinRM required -
    runs ActiveDirectory cmdlets directly against a domain controller.

.PARAMETER GroupListPath
    Text file with one group distinguished name per line. Blank lines and lines
    starting with # are ignored. Produced by query_bindings.py.

.PARAMETER OutputPath
    Directory where the CSV files are written.

.EXAMPLE
    .\Get-ADGroupMembership.ps1 -GroupListPath groups.txt -OutputPath C:\Output
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ -PathType Leaf })]
    [string]$GroupListPath,

    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ -PathType Container })]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory -ErrorAction Stop

$timestamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$membersPath = Join-Path $OutputPath ("auditing-members-{0}.csv" -f $timestamp)
$usersPath   = Join-Path $OutputPath ("auditing-users-{0}.csv" -f $timestamp)

# Read group DNs (skip blanks and # comments).
$groupDns = Get-Content -LiteralPath $GroupListPath |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' -and -not $_.StartsWith('#') }

if (-not $groupDns -or @($groupDns).Count -eq 0) {
    Write-Warning "No group DNs to process - writing empty CSVs."
    $groupDns = @()
}

$members      = New-Object System.Collections.Generic.List[object]
$users        = @{}   # sam -> user record (deduped across groups)
$managerCache = @{}   # manager DN -> resolved record (resolve each once)

function Resolve-Manager {
    param([string]$ManagerDn)
    if ([string]::IsNullOrWhiteSpace($ManagerDn)) { return $null }
    if ($managerCache.ContainsKey($ManagerDn)) { return $managerCache[$ManagerDn] }
    $resolved = $null
    try {
        $m = Get-ADUser -Identity $ManagerDn -Properties EmailAddress, DisplayName -ErrorAction Stop
        $resolved = [pscustomobject]@{
            manager_sam   = $m.SamAccountName
            manager_email = $m.EmailAddress
        }
    } catch {
        Write-Warning ("Could not resolve manager DN '{0}': {1}" -f $ManagerDn, $_.Exception.Message)
    }
    $managerCache[$ManagerDn] = $resolved
    return $resolved
}

foreach ($dn in $groupDns) {
    Write-Host ("Expanding group: {0}" -f $dn)
    $groupMembers = @()
    try {
        # LDAP_MATCHING_RULE_IN_CHAIN = recursive (nested) membership in one query.
        $filter = "(memberOf:1.2.840.113556.1.4.1941:={0})" -f $dn
        $groupMembers = Get-ADUser -LDAPFilter $filter -Properties EmailAddress, DisplayName, Enabled, Manager -ErrorAction Stop
    } catch {
        Write-Warning ("Failed to expand group '{0}': {1}" -f $dn, $_.Exception.Message)
        continue
    }

    foreach ($u in $groupMembers) {
        # Guard each member so one bad record cannot abort the whole run.
        # AD properties can surface as ADPropertyValueCollection rather than
        # scalars; coerce explicitly so casts below cannot throw ArgumentException.
        try {
            $sam = [string]$u.SamAccountName
            if ([string]::IsNullOrWhiteSpace($sam)) { continue }

            $members.Add([pscustomobject]@{ group_dn = $dn; sam_account = $sam })

            if (-not $users.ContainsKey($sam)) {
                $managerDn = [string]$u.Manager
                $mgr = Resolve-Manager -ManagerDn $managerDn
                $users[$sam] = [pscustomobject]@{
                    sam_account   = $sam
                    display_name  = [string]$u.DisplayName
                    email         = [string]$u.EmailAddress
                    enabled       = [bool]($u.Enabled -eq $true)
                    manager_sam   = if ($mgr) { $mgr.manager_sam } else { $null }
                    manager_dn    = $managerDn
                    manager_email = if ($mgr) { $mgr.manager_email } else { $null }
                }
            }
        } catch {
            Write-Warning ("Skipping member '{0}' in group '{1}': {2}" -f $u.SamAccountName, $dn, $_.Exception.Message)
            continue
        }
    }
}

# Write CSVs (UTF-8, no type info). Pipe the collections directly - do NOT wrap
# them in @(): in Windows PowerShell 5.1, @() around a List[object] (or a
# hashtable ValueCollection) makes the next pipeline stage throw
# "System.ArgumentException: Argument types do not match". A bare pipe handles the
# empty, single and many cases correctly.
$members | Select-Object group_dn, sam_account |
    Export-Csv -LiteralPath $membersPath -NoTypeInformation -Encoding UTF8

$users.Values | Select-Object sam_account, display_name, email, enabled, manager_sam, manager_dn, manager_email |
    Export-Csv -LiteralPath $usersPath -NoTypeInformation -Encoding UTF8

Write-Host ("Wrote {0} membership row(s) and {1} user(s)." -f $members.Count, $users.Count)
Write-Host ("Members CSV: {0}" -f $membersPath)
Write-Host ("Users CSV:   {0}" -f $usersPath)
