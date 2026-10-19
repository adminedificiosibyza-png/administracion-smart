param(
    [int]$Port = 8080
)

$base = $PSScriptRoot
if (-not $base) { $base = (Get-Location).Path }
# Se sirve solo la carpeta public (lo único que se publica)
$root = Join-Path $base 'public'
$rootFull = [System.IO.Path]::GetFullPath($root)

$csSource = @"
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;

public class StaticHttpServer {
    private TcpListener listener;
    private string rootDir;
    private bool isRunning;
    private static readonly Dictionary<string, string> mimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" },
        { ".htm", "text/html; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".js", "application/javascript; charset=utf-8" },
        { ".mjs", "application/javascript; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".png", "image/png" },
        { ".jpg", "image/jpeg" },
        { ".jpeg", "image/jpeg" },
        { ".gif", "image/gif" },
        { ".svg", "image/svg+xml" },
        { ".ico", "image/x-icon" },
        { ".woff", "font/woff" },
        { ".woff2", "font/woff2" },
        { ".ttf", "font/ttf" },
        { ".webp", "image/webp" }
    };

    public StaticHttpServer(string path, int port) {
        rootDir = Path.GetFullPath(path);
        listener = new TcpListener(IPAddress.Any, port);
    }

    public void Start() {
        isRunning = true;
        listener.Start();
        while (isRunning) {
            try {
                TcpClient client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(ProcessClient, client);
            } catch {
                break;
            }
        }
    }

    public void Stop() {
        isRunning = false;
        try { listener.Stop(); } catch {}
    }

    private void ProcessClient(object state) {
        TcpClient client = (TcpClient)state;
        try {
            using (client)
            using (NetworkStream stream = client.GetStream()) {
                stream.ReadTimeout = 5000;
                stream.WriteTimeout = 5000;
                StreamReader reader = new StreamReader(stream, Encoding.UTF8);
                string reqLine = reader.ReadLine();
                if (string.IsNullOrWhiteSpace(reqLine)) return;

                string[] tokens = reqLine.Split(' ');
                if (tokens.Length < 2) return;

                string method = tokens[0].ToUpperInvariant();
                string url = tokens[1];
                string pathOnly = url.Split('?')[0].Split('#')[0];
                if (pathOnly == "/" || string.IsNullOrWhiteSpace(pathOnly)) {
                    pathOnly = "/index.html";
                }

                string decoded = Uri.UnescapeDataString(pathOnly.TrimStart('/'));
                string fullPath = Path.GetFullPath(Path.Combine(rootDir, decoded.Replace('/', Path.DirectorySeparatorChar)));

                if (!fullPath.StartsWith(rootDir, StringComparison.OrdinalIgnoreCase)) {
                    byte[] msg = Encoding.UTF8.GetBytes("403 Forbidden");
                    byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: " + msg.Length + "\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n");
                    stream.Write(header, 0, header.Length);
                    stream.Write(msg, 0, msg.Length);
                    return;
                }

                if (File.Exists(fullPath)) {
                    string ext = Path.GetExtension(fullPath);
                    string mime;
                    if (!mimeTypes.TryGetValue(ext, out mime)) {
                        mime = "application/octet-stream";
                    }
                    byte[] bytes = File.ReadAllBytes(fullPath);
                    byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: " + mime + "\r\nContent-Length: " + bytes.Length + "\r\nCache-Control: no-cache, no-store, must-revalidate\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n");
                    stream.Write(header, 0, header.Length);
                    if (method != "HEAD") {
                        stream.Write(bytes, 0, bytes.Length);
                    }
                } else {
                    byte[] msg = Encoding.UTF8.GetBytes("404 Not Found: " + pathOnly);
                    byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + msg.Length + "\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n");
                    stream.Write(header, 0, header.Length);
                    if (method != "HEAD") {
                        stream.Write(msg, 0, msg.Length);
                    }
                }
            }
        } catch {
            // Ignore client disconnects
        }
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'StaticHttpServer').Type) {
    Add-Type -TypeDefinition $csSource
}

# Obtener IPs locales
$ips = @()
try {
    $hostEntry = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName())
    foreach ($addr in $hostEntry.AddressList) {
        if ($addr.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
            $ipStr = $addr.ToString()
            if ($ipStr -notlike "127.*" -and $ipStr -notlike "169.254*") {
                $ips += $ipStr
            }
        }
    }
} catch {}

$server = New-Object StaticHttpServer $rootFull, $Port

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Servidor HTTP Local Activo (Enlace 0.0.0.0:$Port)" -ForegroundColor Green
Write-Host "  Acceso Local PC:   http://localhost:$Port/" -ForegroundColor Yellow
foreach ($ip in $ips) {
    Write-Host "  Acceso Celular:    http://$ip`:$Port/" -ForegroundColor Magenta
}
Write-Host "  Directorio:        $rootFull" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

try {
    $server.Start()
} finally {
    $server.Stop()
}
