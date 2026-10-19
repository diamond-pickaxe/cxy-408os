using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    internal const string AppId = "yu-daguan-local";
    internal const string AppTitle = "宇的大观本地版";
    internal const int DefaultPort = 4198;
    private static readonly string Version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
    private static OfflineServer server;

    [STAThread]
    private static int Main(string[] args)
    {
        bool selfTest = Array.IndexOf(args, "--self-test") >= 0;
        bool resourceCheck = Array.IndexOf(args, "--resource-check") >= 0;
        try
        {
            byte[] compressed = Resource("OfflineHtmlGzip");
            byte[] html;
            using (var input = new MemoryStream(compressed))
            using (var gzip = new GZipStream(input, CompressionMode.Decompress))
            using (var output = new MemoryStream()) { gzip.CopyTo(output); html = output.ToArray(); }
            string sha;
            using (var hash = SHA256.Create()) { sha = BitConverter.ToString(hash.ComputeHash(html)).Replace("-", "").ToLowerInvariant(); }
            if (resourceCheck)
            {
                Console.WriteLine("HTML_BYTES=" + html.Length);
                Console.WriteLine("HTML_SHA256=" + sha);
                return 0;
            }
            int port = DefaultPort;
            foreach (string arg in args) if (arg.StartsWith("--port=")) port = int.Parse(arg.Substring(7));
            if (port < 0 || port > 65535) throw new ArgumentException("端口不正确。");

            if (!selfTest && ExistingInstance(port)) { OpenStudyWindow(port); return 0; }
            server = new OfflineServer(port, html, compressed, sha, Resource("AppIcon"));
            server.Start();
            if (selfTest)
            {
                Console.WriteLine("PORT=" + server.Port);
                Console.WriteLine("HTML_SHA256=" + sha);
                Console.Out.Flush();
                Console.ReadLine();
                server.Dispose();
                return 0;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var context = new TrayContext(server.Port)) { Application.Run(context); }
            server.Dispose();
            return 0;
        }
        catch (Exception error)
        {
            if (server != null) server.Dispose();
            if (selfTest || resourceCheck) Console.Error.WriteLine(error.Message);
            else MessageBox.Show("无法打开刷题窗口。\n\n" + error.Message + "\n\n如果程序已经运行，请从右下角托盘打开。", AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
    }

    internal static byte[] Resource(string name)
    {
        using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (var output = new MemoryStream())
        {
            if (input == null) throw new InvalidDataException("内置题库资源不完整。");
            input.CopyTo(output);
            return output.ToArray();
        }
    }

    private static bool ExistingInstance(int port)
    {
        if (port == 0) return false;
        try
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/__health");
            request.Timeout = 1200;
            request.Proxy = null;
            using (var response = (HttpWebResponse)request.GetResponse()) return response.Headers["X-App-Id"] == AppId;
        }
        catch { return false; }
    }

    internal static void OpenStudyWindow(int port)
    {
        string url = "http://127.0.0.1:" + port + "/";
        string[] browsers = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe")
        };
        foreach (string browser in browsers)
        {
            if (!File.Exists(browser)) continue;
            Process.Start(new ProcessStartInfo(browser, "--app=" + url) { UseShellExecute = true });
            return;
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly Icon icon;
        internal TrayContext(int port)
        {
            using (var input = new MemoryStream(Resource("AppIcon"))) { icon = new Icon(input); }
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开刷题窗口", null, delegate { OpenStudyWindow(port); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitThread(); });
            tray = new NotifyIcon { Icon = icon, Text = AppTitle, ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += delegate { OpenStudyWindow(port); };
            OpenStudyWindow(port);
        }
        protected override void ExitThreadCore()
        {
            tray.Visible = false;
            tray.Dispose();
            icon.Dispose();
            base.ExitThreadCore();
        }
    }

    private sealed class OfflineServer : IDisposable
    {
        private readonly TcpListener listener;
        private readonly byte[] html, compressed, icon, health;
        private readonly string sha;
        private readonly SemaphoreSlim clients = new SemaphoreSlim(16, 16);
        private volatile bool stopped;
        internal int Port { get { return ((IPEndPoint)listener.LocalEndpoint).Port; } }
        internal OfflineServer(int port, byte[] html, byte[] compressed, string sha, byte[] icon)
        {
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.ExclusiveAddressUse = true;
            this.html = html;
            this.compressed = compressed;
            this.icon = icon;
            this.sha = sha;
            health = Encoding.UTF8.GetBytes("{\"appId\":\"" + AppId + "\",\"version\":\"" + Version + "\",\"htmlSha256\":\"" + sha + "\"}");
        }
        internal void Start()
        {
            try { listener.Start(16); }
            catch (SocketException) { throw new InvalidOperationException("本机端口已被占用，请先退出之前的刷题程序后重试。"); }
            var thread = new Thread(Accept) { IsBackground = true, Name = "Offline question bank" };
            thread.Start();
        }
        private void Accept()
        {
            while (!stopped)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    if (!clients.Wait(0)) { client.Close(); continue; }
                    ThreadPool.QueueUserWorkItem(delegate { try { Handle(client); } finally { clients.Release(); } });
                }
                catch (SocketException) { if (stopped) return; }
                catch (ObjectDisposedException) { return; }
            }
        }
        private void Handle(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 30000;
                    using (NetworkStream stream = client.GetStream())
                    {
                        var buffer = new byte[16384];
                        int length = 0;
                        string request = "";
                        while (length < buffer.Length)
                        {
                            int read = stream.Read(buffer, length, buffer.Length - length);
                            if (read == 0) return;
                            length += read;
                            request = Encoding.ASCII.GetString(buffer, 0, length);
                            if (request.Contains("\r\n\r\n")) break;
                        }
                        if (!request.Contains("\r\n\r\n")) { Respond(stream, 431, "Request Header Fields Too Large", new byte[0], "text/plain", false, false); return; }
                        string[] lines = request.Split(new[] { "\r\n" }, StringSplitOptions.None);
                        string[] first = lines[0].Split(' ');
                        if (first.Length != 3 || !first[1].StartsWith("/")) { Respond(stream, 400, "Bad Request", new byte[0], "text/plain", false, false); return; }
                        string host = "";
                        bool acceptGzip = false;
                        foreach (string line in lines)
                        {
                            if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) host = line.Substring(5).Trim();
                            if (line.StartsWith("Accept-Encoding:", StringComparison.OrdinalIgnoreCase)) acceptGzip = line.ToLowerInvariant().Contains("gzip");
                        }
                        if (host != "127.0.0.1:" + Port && host != "localhost:" + Port) { Respond(stream, 403, "Forbidden", new byte[0], "text/plain", false, false); return; }
                        bool head = first[0] == "HEAD";
                        if (!head && first[0] != "GET") { Respond(stream, 405, "Method Not Allowed", new byte[0], "text/plain", false, false); return; }
                        string route = first[1].Split('?')[0];
                        if (route == "/" || route == "/index.html") Respond(stream, 200, "OK", acceptGzip ? compressed : html, "text/html; charset=utf-8", head, acceptGzip);
                        else if (route == "/__health") Respond(stream, 200, "OK", health, "application/json; charset=utf-8", head, false);
                        else if (route == "/favicon.ico") Respond(stream, 200, "OK", icon, "image/x-icon", head, false);
                        else Respond(stream, 404, "Not Found", new byte[0], "text/plain", head, false);
                    }
                }
                catch (IOException) { }
                catch (SocketException) { }
            }
        }
        private void Respond(NetworkStream stream, int status, string reason, byte[] body, string type, bool head, bool gzip)
        {
            string headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nX-App-Id: " + AppId + "\r\nX-Html-Sha256: " + sha + "\r\n" + (gzip ? "Content-Encoding: gzip\r\nVary: Accept-Encoding\r\n" : "") + "\r\n";
            byte[] bytes = Encoding.ASCII.GetBytes(headers);
            stream.Write(bytes, 0, bytes.Length);
            if (!head) stream.Write(body, 0, body.Length);
        }
        public void Dispose() { stopped = true; listener.Stop(); }
    }
}
