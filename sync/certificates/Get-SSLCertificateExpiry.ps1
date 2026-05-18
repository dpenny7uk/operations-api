<#
.SYNOPSIS
    Scans HTTPS endpoints for SSL/TLS certificates and outputs a CSV report.

.DESCRIPTION
    Performs certificate scanning via direct TLS connection (no WinRM required):

    1. Server scans (from -ServerListPath):
       - Probes specified ports (default 443) via TLS handshake
       - Extracts certificate details from the connection

    2. Endpoint scans (from -EndpointsPath):
       - Direct TLS connection to arbitrary URLs (for load balancers, external
         services, non-IIS apps, etc. that aren't in the server list)

    Outputs a timestamped CSV file compatible with sync_certificates.py.

.PARAMETER ServerListPath
    Path to a text file with one server hostname per line.
    Blank lines and lines starting with # are ignored.

.PARAMETER EndpointsPath
    Optional path to a CSV file with Name and URL columns for HTTPS endpoint checks.
    Use this for external sites, load balancers, and services not in the server list.
    Blank lines and lines starting with # are ignored.

.PARAMETER OutputPath
    Directory where the CSV output file will be written.

.PARAMETER ThresholdDays
    Days until expiry to trigger WARNING status. Default: 30.

.PARAMETER CriticalDays
    Days until expiry to trigger CRITICAL status. Default: 7.

.PARAMETER Ports
    Array of TCP ports to probe for HTTPS certificates on servers. Default: @(443).

.PARAMETER ThrottleLimit
    Maximum number of concurrent scans. Default: 20.

.EXAMPLE
    .\Get-SSLCertificateExpiry.ps1 -ServerListPath servers.txt -OutputPath C:\Output -Ports 443,8443

.EXAMPLE
    .\Get-SSLCertificateExpiry.ps1 -ServerListPath servers.txt -EndpointsPath endpoints.csv -OutputPath C:\Output
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ -PathType Leaf })]
    [string]$ServerListPath,

    [Parameter()]
    [ValidateScript({ Test-Path $_ -PathType Leaf })]
    [string]$EndpointsPath,

    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ -PathType Container })]
    [string]$OutputPath,

    [int]$ThresholdDays = 30,

    [int]$CriticalDays = 7,

    [ValidateRange(1, 65535)]
    [int[]]$Ports = @(443),

    [int]$ThrottleLimit = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($CriticalDays -ge $ThresholdDays) {
    Write-Error "CriticalDays ($CriticalDays) must be less than ThresholdDays ($ThresholdDays)"
    exit 1
}

# Static cert-validation callback. A PowerShell scriptblock callback fails inside the
# RunspacePool when .NET dispatches the TLS validation onto an internal thread pool
# thread that has no runspace bound ("There is no Runspace available to run scripts
# in this thread"). A compiled .NET delegate has no runspace dependency, so the
# callback runs on any thread.
if (-not ([System.Management.Automation.PSTypeName]'OpsCertValidator').Type) {
    Add-Type -TypeDefinition @"
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public static class OpsCertValidator {
    // Exposed as a static readonly delegate (not a method group), so PowerShell can
    // pass it straight to the SslStream constructor - PS 5.1 cannot cast a PSMethod
    // reference to an arbitrary delegate type.
    public static readonly RemoteCertificateValidationCallback AcceptAny = AcceptAnyImpl;
    private static bool AcceptAnyImpl(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors) {
        return true;
    }
}
"@
}

# ── Read server list ─────────────────────────────────────────────────────────

$servers = @(Get-Content -Path $ServerListPath |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' -and $_ -notmatch '^\s*#' })

if ($servers.Count -eq 0) {
    Write-Warning "No servers found in $ServerListPath"
}

# ── Read endpoints list (optional) ───────────────────────────────────────────

$endpoints = @()
if ($EndpointsPath) {
    $endpoints = @(Import-Csv -Path $EndpointsPath |
        Where-Object { $_.Name -and $_.URL -and $_.Name -notmatch '^\s*#' })

    if ($endpoints.Count -eq 0) {
        Write-Warning "No valid endpoints found in $EndpointsPath (expected Name,URL columns)"
    }
}

$totalTargets = $servers.Count + $endpoints.Count
if ($totalTargets -eq 0) {
    Write-Error "No servers or endpoints to scan"
    exit 1
}

Write-Host "Scanning $($servers.Count) servers + $($endpoints.Count) endpoints (ThrottleLimit=$ThrottleLimit, Ports=$($Ports -join ','))"

# ── Shared function definition (injected into runspace scriptblocks) ──────────

$sharedFunctions = @'
function Get-CertStatus {
    param([datetime]$NotAfter, [int]$ThresholdDays, [int]$CriticalDays)
    $daysRemaining = [math]::Floor(($NotAfter - (Get-Date)).TotalDays)
    if ($daysRemaining -lt 0)              { return @{ Status = 'EXPIRED';  DaysRemaining = $daysRemaining } }
    if ($daysRemaining -le $CriticalDays)  { return @{ Status = 'CRITICAL'; DaysRemaining = $daysRemaining } }
    if ($daysRemaining -le $ThresholdDays) { return @{ Status = 'WARNING';  DaysRemaining = $daysRemaining } }
    return @{ Status = 'OK'; DaysRemaining = $daysRemaining }
}
'@

# ── Scriptblock for server scans (cert store + port probing) ─────────────────
#    Must be self-contained — runspaces don't share the parent scope.
#    Get-CertStatus is injected via $sharedFunctions + scriptblock concatenation.

$serverScanBlock = [ScriptBlock]::Create(@'
    param(
        [string]$ServerName,
        [int[]]$Ports,
        [int]$ThresholdDays,
        [int]$CriticalDays
    )

'@ + $sharedFunctions + @'

    function New-ResultRow {
        param(
            [string]$Name, [string]$Status, [string]$Thumbprint,
            [string]$Subject, [string]$Issuer, [string]$NotBefore,
            [string]$NotAfter, $DaysRemaining, [string]$Source,
            [string]$URL, [string]$ErrorMsg
        )
        [PSCustomObject]@{
            Name          = $Name
            Status        = $Status
            Thumbprint    = $Thumbprint
            Subject       = $Subject
            Issuer        = $Issuer
            NotBefore     = $NotBefore
            NotAfter      = $NotAfter
            DaysRemaining = $DaysRemaining
            Source        = $Source
            URL           = $URL
            Error         = $ErrorMsg
        }
    }

    $results = @()
    $lastError = ''  # Captured to distinguish TLS failure (ERROR) from no HTTPS (UNREACHABLE)

    # ── HTTPS Endpoints via TLS connection ───────────────────────────────
    foreach ($port in $Ports) {
        $tcpClient = $null
        $sslStream = $null
        try {
            $tcpClient = New-Object System.Net.Sockets.TcpClient
            $connectTask = $tcpClient.ConnectAsync($ServerName, $port)
            # Task.Wait throws AggregateException on a faulted task (TCP refused/RST/no route).
            # Swallow it so a fast TCP failure stays UNREACHABLE instead of falling through to
            # the outer catch and being mis-classified as ERROR.
            $tcpConnected = $false
            try { $tcpConnected = $connectTask.Wait(2000) } catch { }
            if (-not $tcpConnected -or $connectTask.IsFaulted) {
                $tcpClient.Dispose()
                continue
            }

            # Must accept any cert (incl. expired/self-signed) to scan them.
            # Callback is a static .NET delegate, not a scriptblock - see OpsCertValidator
            # at the top of the file for the reason.
            $sslStream = New-Object System.Net.Security.SslStream(
                $tcpClient.GetStream(), $false,
                [OpsCertValidator]::AcceptAny
            )
            # Bounded TLS handshake: synchronous AuthenticateAsClient has no timeout
            # and will hang the runspace if the server accepts TCP but stalls TLS.
            # Task.Wait throws AggregateException on a faulted task - catch it so we read the
            # real failure reason from $authTask.Exception instead of surfacing a generic
            # "Wait... One or more errors occurred" string.
            $authTask = $sslStream.AuthenticateAsClientAsync($ServerName)
            $tlsCompleted = $false
            try { $tlsCompleted = $authTask.Wait(5000) } catch { }
            if ($authTask.IsFaulted) {
                $ex = if ($authTask.Exception.InnerException) { $authTask.Exception.InnerException } else { $authTask.Exception }
                $lastError = "TLS handshake failed on port ${port}: $($ex.Message)"
                continue
            }
            if (-not $tlsCompleted) {
                $lastError = "TLS handshake timed out after 5s on port $port"
                continue
            }

            $remoteCert = $sslStream.RemoteCertificate
            if ($remoteCert) {
                $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($remoteCert)
                $statusInfo = Get-CertStatus -NotAfter $x509.NotAfter `
                    -ThresholdDays $ThresholdDays -CriticalDays $CriticalDays

                $results += New-ResultRow `
                    -Name $ServerName -Status $statusInfo.Status `
                    -Thumbprint $x509.Thumbprint -Subject $x509.Subject `
                    -Issuer $x509.Issuer `
                    -NotBefore $x509.NotBefore.ToString('o') `
                    -NotAfter $x509.NotAfter.ToString('o') `
                    -DaysRemaining $statusInfo.DaysRemaining `
                    -Source 'HTTPS Endpoint' -URL "${ServerName}:${port}" -ErrorMsg ''
            }
        }
        catch {
            # PowerShell wraps .NET exceptions in MethodInvocationException; the real
            # cause is at InnerException, so prefer that for a useful error string.
            $inner = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
            $lastError = "TLS/connection error on port ${port}: $inner"
        }
        finally {
            if ($sslStream) { $sslStream.Dispose() }
            if ($tcpClient) { $tcpClient.Dispose() }
        }
    }

    # If no certs found on any port: ERROR if TLS was attempted and failed,
    # otherwise UNREACHABLE (the server simply does not expose HTTPS).
    if ($results.Count -eq 0) {
        if ($lastError) {
            $results += New-ResultRow `
                -Name $ServerName -Status 'ERROR' `
                -Thumbprint '' -Subject '' -Issuer '' `
                -NotBefore '' -NotAfter '' -DaysRemaining '' `
                -Source 'HTTPS Endpoint' -URL ($Ports -join ',') `
                -ErrorMsg $lastError
        }
        else {
            $results += New-ResultRow `
                -Name $ServerName -Status 'UNREACHABLE' `
                -Thumbprint '' -Subject '' -Issuer '' `
                -NotBefore '' -NotAfter '' -DaysRemaining '' `
                -Source 'HTTPS Endpoint' -URL ($Ports -join ',') `
                -ErrorMsg "No HTTPS certificate found on port(s): $($Ports -join ', ')"
        }
    }

    return $results
'@)

# ── Scriptblock for standalone endpoint scans (URL-based) ────────────────────

$endpointScanBlock = [ScriptBlock]::Create(@'
    param(
        [string]$EndpointName,
        [string]$EndpointURL,
        [int]$ThresholdDays,
        [int]$CriticalDays
    )

'@ + $sharedFunctions + @'

    $tcpClient = $null
    $sslStream = $null
    try {
        $uri = [System.Uri]$EndpointURL
        $host_ = $uri.Host
        $port = if ($uri.Port -gt 0 -and $uri.Port -ne 443) { $uri.Port } else { 443 }

        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $connectTask = $tcpClient.ConnectAsync($host_, $port)
        # Task.Wait throws AggregateException on a faulted task - swallow so we can
        # inspect $connectTask.Exception below and surface the real socket error.
        $tcpConnected = $false
        try { $tcpConnected = $connectTask.Wait(10000) } catch { }
        if ($connectTask.IsFaulted) {
            $tcpClient.Dispose()
            return [PSCustomObject]@{
                Name = $EndpointName; Status = 'ERROR'; Thumbprint = ''; Subject = ''
                Issuer = ''; NotBefore = ''; NotAfter = ''; DaysRemaining = ''
                Source = 'HTTPS Endpoint'; URL = $EndpointURL
                Error = if ($connectTask.Exception.InnerException) { $connectTask.Exception.InnerException.Message } else { $connectTask.Exception.Message }
            }
        }
        if (-not $tcpConnected) {
            $tcpClient.Dispose()
            return [PSCustomObject]@{
                Name = $EndpointName; Status = 'ERROR'; Thumbprint = ''; Subject = ''
                Issuer = ''; NotBefore = ''; NotAfter = ''; DaysRemaining = ''
                Source = 'HTTPS Endpoint'; URL = $EndpointURL
                Error = "Connection timed out to ${host_}:${port}"
            }
        }

        # Static delegate callback - see OpsCertValidator at the top of the file.
        $sslStream = New-Object System.Net.Security.SslStream(
            $tcpClient.GetStream(), $false,
            [OpsCertValidator]::AcceptAny
        )
        $sslStream.AuthenticateAsClient($host_)

        $remoteCert = $sslStream.RemoteCertificate
        if (-not $remoteCert) {
            return [PSCustomObject]@{
                Name = $EndpointName; Status = 'ERROR'; Thumbprint = ''; Subject = ''
                Issuer = ''; NotBefore = ''; NotAfter = ''; DaysRemaining = ''
                Source = 'HTTPS Endpoint'; URL = $EndpointURL
                Error = 'No certificate returned by server'
            }
        }

        $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($remoteCert)
        $statusInfo = Get-CertStatus -NotAfter $x509.NotAfter `
            -ThresholdDays $ThresholdDays -CriticalDays $CriticalDays

        return [PSCustomObject]@{
            Name          = $EndpointName
            Status        = $statusInfo.Status
            Thumbprint    = $x509.Thumbprint
            Subject       = $x509.Subject
            Issuer        = $x509.Issuer
            NotBefore     = $x509.NotBefore.ToString('o')
            NotAfter      = $x509.NotAfter.ToString('o')
            DaysRemaining = $statusInfo.DaysRemaining
            Source        = 'HTTPS Endpoint'
            URL           = $EndpointURL
            Error         = ''
        }
    }
    catch {
        # Prefer InnerException - the synchronous AuthenticateAsClient call gets wrapped in
        # MethodInvocationException, and the inner message is the real TLS failure reason.
        $msg = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
        return [PSCustomObject]@{
            Name = $EndpointName; Status = 'ERROR'; Thumbprint = ''; Subject = ''
            Issuer = ''; NotBefore = ''; NotAfter = ''; DaysRemaining = ''
            Source = 'HTTPS Endpoint'; URL = $EndpointURL
            Error = $msg
        }
    }
    finally {
        if ($sslStream) { $sslStream.Dispose() }
        if ($tcpClient) { $tcpClient.Dispose() }
    }
'@)

# ── Run all scans in parallel using RunspacePool ─────────────────────────────

$sessionState = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
$runspacePool = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, $ThrottleLimit, $sessionState, $Host)
$runspacePool.Open()

$jobs = @()

# Queue server scans
foreach ($server in $servers) {
    $ps = [PowerShell]::Create()
    $ps.RunspacePool = $runspacePool
    [void]$ps.AddScript($serverScanBlock)
    [void]$ps.AddArgument($server)
    [void]$ps.AddArgument($Ports)
    [void]$ps.AddArgument($ThresholdDays)
    [void]$ps.AddArgument($CriticalDays)

    $handle = $ps.BeginInvoke()
    $jobs += @{ PowerShell = $ps; Handle = $handle; Target = $server }
}

# Queue endpoint scans
foreach ($ep in $endpoints) {
    $ps = [PowerShell]::Create()
    $ps.RunspacePool = $runspacePool
    [void]$ps.AddScript($endpointScanBlock)
    [void]$ps.AddArgument($ep.Name)
    [void]$ps.AddArgument($ep.URL)
    [void]$ps.AddArgument($ThresholdDays)
    [void]$ps.AddArgument($CriticalDays)

    $handle = $ps.BeginInvoke()
    $jobs += @{ PowerShell = $ps; Handle = $handle; Target = $ep.Name }
}

Write-Host "All $($jobs.Count) scan jobs dispatched. Collecting results..."

$allResults = @()
$timeoutMs = 300000  # 5 minute overall timeout per job

try {
    foreach ($job in $jobs) {
        try {
            $completed = $job.Handle.AsyncWaitHandle.WaitOne($timeoutMs)
            if ($completed) {
                $output = $job.PowerShell.EndInvoke($job.Handle)
                if ($output) { $allResults += $output }

                if ($job.PowerShell.Streams.Error.Count -gt 0) {
                    $errMsg = ($job.PowerShell.Streams.Error | Select-Object -First 1).ToString()
                    Write-Warning "Errors scanning $($job.Target): $errMsg"
                }
            }
            else {
                Write-Warning "Scan timed out for $($job.Target)"
                $job.PowerShell.Stop()
                $allResults += [PSCustomObject]@{
                    Name = $job.Target; Status = 'ERROR'; Thumbprint = ''; Subject = ''
                    Issuer = ''; NotBefore = ''; NotAfter = ''; DaysRemaining = ''
                    Source = ''; URL = ''; Error = 'Scan timed out after 5 minutes'
                }
            }
        }
        catch {
            Write-Warning "Failed to collect results for $($job.Target): $($_.Exception.Message)"
            $allResults += [PSCustomObject]@{
                Name = $job.Target; Status = 'ERROR'; Thumbprint = ''; Subject = ''
                Issuer = ''; NotBefore = ''; NotAfter = ''; DaysRemaining = ''
                Source = ''; URL = ''; Error = $_.Exception.Message
            }
        }
        finally {
            $job.PowerShell.Dispose()
        }
    }
}
finally {
    $runspacePool.Close()
    $runspacePool.Dispose()
}

# ── Export CSV ────────────────────────────────────────────────────────────────

$allResults = @($allResults)

if ($allResults.Count -eq 0) {
    Write-Warning "No results collected from any server or endpoint"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$csvFileName = "SSL-CertExpiry-${timestamp}.csv"
$csvPath = Join-Path -Path $OutputPath -ChildPath $csvFileName

$allResults | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8

# ── Summary ───────────────────────────────────────────────────────────────────

$totalCerts   = @($allResults | Where-Object { $_.Status -notin @('UNREACHABLE','ERROR') }).Count
$unreachable  = @($allResults | Where-Object { $_.Status -eq 'UNREACHABLE' } |
                    Select-Object -ExpandProperty Name -Unique).Count
$errors       = @($allResults | Where-Object { $_.Status -eq 'ERROR' } |
                    Select-Object -ExpandProperty Name -Unique).Count
$expired      = @($allResults | Where-Object { $_.Status -eq 'EXPIRED' }).Count
$critical     = @($allResults | Where-Object { $_.Status -eq 'CRITICAL' }).Count
$warning      = @($allResults | Where-Object { $_.Status -eq 'WARNING' }).Count

Write-Host ''
Write-Host '========================================='
Write-Host ' SSL Certificate Scan Summary'
Write-Host '========================================='
Write-Host "  Servers scanned   : $($servers.Count)"
Write-Host "  Endpoints scanned : $($endpoints.Count)"
Write-Host "  Certificates found: $totalCerts"
Write-Host "  Unreachable       : $unreachable"
Write-Host "  Errors            : $errors"
Write-Host "  Expired           : $expired"
Write-Host "  Critical (<=$($CriticalDays)d)  : $critical"
Write-Host "  Warning  (<=$($ThresholdDays)d)  : $warning"
Write-Host "  CSV output        : $csvPath"
Write-Host '========================================='

# Set Azure DevOps pipeline variable so Step 2 can reference the exact path
if ($env:BUILD_BUILDID) {
    Write-Host "##vso[task.setvariable variable=CertCsvPath]$csvPath"
}
