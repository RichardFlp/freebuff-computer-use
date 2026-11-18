// Freebuff Computer Use - native helper.
// Long-lived process: one JSON request per stdin line, one JSON response per stdout line.
// All coordinates are PHYSICAL virtual-desktop pixels (process is per-monitor DPI aware v2).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

static class Native
{
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    public delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr data);
    [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
    [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hMon, int type, out uint dx, out uint dy);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int idx);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT r, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int v, int size);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int idx);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX
    {
        public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion u; }
}

// "Freebuff is using this monitor" pill: light green, top-centre of each monitor the agent touches.
// Click-through, never takes focus, and excluded from screen capture so the agent never sees it.
class BadgeForm : Form
{
    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
    public string Text2 = "Freebuff is using this monitor";
    public DateTime HideAt;
    public BadgeForm()
    {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
        StartPosition = FormStartPosition.Manual; BackColor = Color.FromArgb(198, 246, 213);
        AutoScaleMode = AutoScaleMode.None; DoubleBuffered = true; Opacity = 0.95;
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams
    {
        // TOPMOST | TOOLWINDOW | LAYERED | TRANSPARENT (click-through) | NOACTIVATE
        get { var cp = base.CreateParams; cp.ExStyle |= 0x8 | 0x80 | 0x80000 | 0x20 | 0x08000000; return cp; }
    }
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (Environment.GetEnvironmentVariable("FBCU_BADGE_VISIBLE_IN_CAPTURE") == "1") return; // debug only
        try { SetWindowDisplayAffinity(Handle, 0x11); } catch { } // WDA_EXCLUDEFROMCAPTURE (Win10 2004+)
    }
    public void Place(Monitor m)
    {
        float s = (float)Math.Max(1.0, m.scale);
        if (Font == null || Math.Abs(Font.Size - 13f * s) > 0.01f) Font = new Font("Segoe UI Semibold", 13f * s, GraphicsUnit.Pixel);
        var size = TextRenderer.MeasureText(Text2, Font);
        int h = (int)(34 * s), w = size.Width + (int)(46 * s);
        Bounds = new Rectangle(m.x + (m.width - w) / 2, m.y + (int)(10 * s), w, h);
        using (var p = new GraphicsPath())
        {
            int r = h;
            p.AddArc(0, 0, r, r, 90, 180); p.AddArc(w - r, 0, r, r, 270, 180); p.CloseFigure();
            Region = new Region(p);
        }
        Invalidate();
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        int h = Height; float d = h * 0.32f;
        using (var b = new SolidBrush(Color.FromArgb(22, 163, 74))) g.FillEllipse(b, h * 0.42f, (h - d) / 2, d, d);
        TextRenderer.DrawText(g, Text2, Font, new Rectangle((int)(h * 0.42f + d + h * 0.25f), 0, Width, h), Color.FromArgb(20, 83, 45),
            TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPadding);
    }
}

static class Badges
{
    static Form host;
    static readonly Dictionary<int, BadgeForm> forms = new Dictionary<int, BadgeForm>();
    static readonly ManualResetEvent ready = new ManualResetEvent(false);

    static void EnsureThread()
    {
        if (host != null) return;
        var t = new Thread(() =>
        {
            host = new Form { ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None, Opacity = 0, Size = new Size(1, 1) };
            var h = host.Handle; // create handle so BeginInvoke works without showing it
            var timer = new System.Windows.Forms.Timer { Interval = 250 };
            timer.Tick += (s, e) => { foreach (var f in forms.Values) if (f.Visible && DateTime.Now >= f.HideAt) f.Hide(); };
            timer.Start();
            ready.Set();
            Application.Run();
        });
        t.IsBackground = true; t.SetApartmentState(ApartmentState.STA); t.Start();
        ready.WaitOne(5000);
    }

    // args: displays: [index...] (or "hide"), seconds (default 6)
    public static object Show(Dictionary<string, object> a)
    {
        EnsureThread();
        object v; a.TryGetValue("displays", out v);
        var idx = new List<int>();
        bool hideAll = v is string && (string)v == "hide";
        if (v is System.Collections.IEnumerable && !(v is string)) foreach (var o in (System.Collections.IEnumerable)v) idx.Add(Convert.ToInt32(o));
        double secs = a.ContainsKey("seconds") && a["seconds"] != null ? Convert.ToDouble(a["seconds"]) : 6;
        var mons = Program.MonitorList();
        host.BeginInvoke(new Action(() =>
        {
            if (hideAll) { foreach (var f in forms.Values) f.Hide(); return; }
            foreach (var i in idx)
            {
                var m = mons.FirstOrDefault(x => x.index == i); if (m == null) continue;
                BadgeForm f;
                if (!forms.TryGetValue(i, out f) || f.IsDisposed) { f = new BadgeForm(); forms[i] = f; }
                f.HideAt = DateTime.Now.AddSeconds(secs);
                f.Place(m);
                if (!f.Visible) f.Show();
                Native.SetWindowPos(f.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x1 | 0x2 | 0x10); // stay above, no move/size/activate
            }
        }));
        return new { shown = idx };
    }
}

class Monitor
{
    public int index; public string device; public bool primary;
    public int x, y, width, height; public int workX, workY, workWidth, workHeight;
    public uint dpi; public double scale;
}

static class Program
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };
    static readonly Dictionary<string, int[]> Elements = new Dictionary<string, int[]>(); // snapshot element id -> center point
    static bool FailSafe = true;

    [STAThread]
    static void Main()
    {
        try { if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware(); } catch { try { Native.SetProcessDPIAware(); } catch { } }
        Console.InputEncoding = new UTF8Encoding(false);
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            object id = null; object result; bool ok = true; string error = null;
            try
            {
                var req = Json.Deserialize<Dictionary<string, object>>(line);
                req.TryGetValue("id", out id);
                result = Dispatch(Str(req, "cmd", ""), req);
            }
            catch (Exception e) { ok = false; result = null; error = e.Message; }
            var resp = new Dictionary<string, object> { { "id", id }, { "ok", ok } };
            if (ok) resp["result"] = result; else resp["error"] = error;
            stdout.WriteLine(Json.Serialize(resp));
        }
    }

    // ---------- arg helpers ----------
    static string Str(Dictionary<string, object> d, string k, string def) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : def; }
    static int Int(Dictionary<string, object> d, string k, int def) { object v; return d.TryGetValue(k, out v) && v != null ? (int)Math.Round(Convert.ToDouble(v)) : def; }
    static double Dbl(Dictionary<string, object> d, string k, double def) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToDouble(v) : def; }
    static bool Bool(Dictionary<string, object> d, string k, bool def) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToBoolean(v) : def; }
    static bool Has(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null; }

    static object Dispatch(string cmd, Dictionary<string, object> a)
    {
        if (Has(a, "failSafe")) FailSafe = Bool(a, "failSafe", true);
        switch (cmd)
        {
            case "ping": return "pong";
            case "displays": return Monitors();
            case "screenshot": return Screenshot(a);
            case "cursor": { Native.POINT p; Native.GetCursorPos(out p); return new { x = p.X, y = p.Y }; }
            case "move": Guard(); MoveTo(Int(a, "x", 0), Int(a, "y", 0)); return Done();
            case "click": Guard(); return Click(a);
            case "mouse": Guard(); return MouseButton(a);
            case "drag": Guard(); return Drag(a);
            case "scroll": Guard(); return Scroll(a);
            case "type": Guard(); TypeText(Str(a, "text", ""), Int(a, "delayMs", 0)); return Done();
            case "key": Guard(); return Keys(a);
            case "windows": return Windows(Bool(a, "all", false));
            case "window": Guard(); return WindowAction(a);
            case "snapshot": return Snapshot(a);
            case "element": return ElementPoint(Str(a, "elementId", ""));
            case "clipboard_get": return Clipboard.ContainsText() ? Clipboard.GetText() : "";
            case "clipboard_set": Clipboard.SetText(Str(a, "text", "") == "" ? " " : Str(a, "text", "")); return Done();
            case "badge": return Badges.Show(a);
            default: throw new Exception("unknown command: " + cmd);
        }
    }
    static object Done() { Native.POINT p; Native.GetCursorPos(out p); return new { done = true, cursor = new { x = p.X, y = p.Y } }; }

    // ---------- monitors ----------
    public static List<Monitor> MonitorList() { return Monitors(); }
    static List<Monitor> Monitors()
    {
        var list = new List<Monitor>();
        Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr hdc, ref Native.RECT r, IntPtr d) =>
        {
            var mi = new Native.MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFOEX));
            Native.GetMonitorInfo(h, ref mi);
            uint dx = 96, dy = 96; try { Native.GetDpiForMonitor(h, 0, out dx, out dy); } catch { }
            list.Add(new Monitor
            {
                device = mi.szDevice, primary = (mi.dwFlags & 1) != 0,
                x = mi.rcMonitor.Left, y = mi.rcMonitor.Top, width = mi.rcMonitor.Right - mi.rcMonitor.Left, height = mi.rcMonitor.Bottom - mi.rcMonitor.Top,
                workX = mi.rcWork.Left, workY = mi.rcWork.Top, workWidth = mi.rcWork.Right - mi.rcWork.Left, workHeight = mi.rcWork.Bottom - mi.rcWork.Top,
                dpi = dx, scale = Math.Round(dx / 96.0, 2)
            });
            return true;
        }, IntPtr.Zero);
        // Stable order: primary first, then left-to-right, top-to-bottom.
        list = list.OrderByDescending(m => m.primary).ThenBy(m => m.x).ThenBy(m => m.y).ToList();
        for (int i = 0; i < list.Count; i++) list[i].index = i;
        return list;
    }

    // Fail-safe: the user slams the mouse into the top-left corner of any monitor to stop the agent.
    static void Guard()
    {
        if (!FailSafe) return;
        Native.POINT p; Native.GetCursorPos(out p);
        foreach (var m in Monitors())
            if (p.X >= m.x && p.X <= m.x + 2 && p.Y >= m.y && p.Y <= m.y + 2)
                throw new Exception("FAIL-SAFE: the mouse is in the top-left corner of display " + m.index + ". The user has asked to stop computer actions. Do not retry; tell the user.");
    }

    // ---------- screenshot ----------
    static object Screenshot(Dictionary<string, object> a)
    {
        int x = Int(a, "x", 0), y = Int(a, "y", 0), w = Int(a, "width", 0), h = Int(a, "height", 0);
        if (w <= 0 || h <= 0) throw new Exception("screenshot needs a positive width and height");
        int maxW = Int(a, "maxWidth", 1366), maxH = Int(a, "maxHeight", 1366);
        string format = Str(a, "format", "jpeg").ToLowerInvariant();
        long quality = Int(a, "quality", 75);
        bool cursor = Bool(a, "drawCursor", true);

        double scale = Math.Min(1.0, Math.Min((double)maxW / w, (double)maxH / h));
        int ow = Math.Max(1, (int)Math.Round(w * scale)), oh = Math.Max(1, (int)Math.Round(h * scale));
        using (var full = new Bitmap(w, h, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(full))
            {
                g.Clear(Color.Black);
                // Copy per monitor so gaps between monitors (non-rectangular layouts) stay black instead of failing.
                foreach (var m in Monitors())
                {
                    var r = Rectangle.Intersect(new Rectangle(x, y, w, h), new Rectangle(m.x, m.y, m.width, m.height));
                    if (r.Width > 0 && r.Height > 0) g.CopyFromScreen(r.X, r.Y, r.X - x, r.Y - y, r.Size, CopyPixelOperation.SourceCopy);
                }
                if (cursor)
                {
                    Native.POINT p; Native.GetCursorPos(out p);
                    int cx = p.X - x, cy = p.Y - y;
                    if (cx >= 0 && cy >= 0 && cx < w && cy < h)
                    {
                        float s = (float)Math.Max(1.0, 1.0 / scale);
                        var pts = new[] { new PointF(cx, cy), new PointF(cx, cy + 17 * s), new PointF(cx + 4.5f * s, cy + 13 * s), new PointF(cx + 12 * s, cy + 12.5f * s) };
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.FillPolygon(Brushes.White, pts);
                        using (var pen = new Pen(Color.Black, 1.2f * s)) g.DrawPolygon(pen, pts);
                    }
                }
            }
            Bitmap output = full;
            try
            {
                if (ow != w || oh != h)
                {
                    output = new Bitmap(ow, oh, PixelFormat.Format24bppRgb);
                    using (var g2 = Graphics.FromImage(output))
                    {
                        g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g2.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g2.DrawImage(full, 0, 0, ow, oh);
                    }
                }
                using (var ms = new MemoryStream())
                {
                    if (format == "png") output.Save(ms, ImageFormat.Png);
                    else
                    {
                        var enc = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                        var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, Math.Max(10L, Math.Min(100L, quality)));
                        output.Save(ms, enc, ps);
                    }
                    return new Dictionary<string, object> {
                        { "base64", Convert.ToBase64String(ms.ToArray()) }, { "mediaType", format == "png" ? "image/png" : "image/jpeg" },
                        { "x", x }, { "y", y }, { "width", w }, { "height", h }, { "imageWidth", ow }, { "imageHeight", oh }, { "scale", (double)w / ow }
                    };
                }
            }
            finally { if (!ReferenceEquals(output, full)) output.Dispose(); }
        }
    }

    // ---------- mouse ----------
    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint LDOWN = 0x2, LUP = 0x4, RDOWN = 0x8, RUP = 0x10, MDOWN = 0x20, MUP = 0x40, WHEEL = 0x800, HWHEEL = 0x1000, XDOWN = 0x80, XUP = 0x100;

    static void SendMouse(uint flags, uint data = 0)
    {
        var i = new Native.INPUT { type = INPUT_MOUSE }; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data;
        Native.SendInput(1, new[] { i }, Marshal.SizeOf(typeof(Native.INPUT)));
    }
    static void MoveTo(int x, int y)
    {
        // SetCursorPos twice: the first move can land at the wrong place when crossing monitors with different DPI.
        Native.SetCursorPos(x, y); Thread.Sleep(10); Native.SetCursorPos(x, y);
        SendMouse(0x0001); // a zero-length relative move so apps get WM_MOUSEMOVE / hover
    }
    static void SmoothMove(int x, int y, int ms)
    {
        Native.POINT p; Native.GetCursorPos(out p);
        int steps = Math.Max(1, ms / 10);
        for (int s = 1; s <= steps; s++)
        {
            double t = (double)s / steps; t = t * t * (3 - 2 * t);
            Native.SetCursorPos((int)Math.Round(p.X + (x - p.X) * t), (int)Math.Round(p.Y + (y - p.Y) * t));
            SendMouse(0x0001);
            Thread.Sleep(10);
        }
        MoveTo(x, y);
    }
    static uint[] ButtonFlags(string b)
    {
        switch (b) { case "right": return new[] { RDOWN, RUP, 0u }; case "middle": return new[] { MDOWN, MUP, 0u }; case "back": return new[] { XDOWN, XUP, 1u }; case "forward": return new[] { XDOWN, XUP, 2u }; default: return new[] { LDOWN, LUP, 0u }; }
    }
    static object Click(Dictionary<string, object> a)
    {
        if (Has(a, "x") && Has(a, "y")) MoveTo(Int(a, "x", 0), Int(a, "y", 0));
        var mods = ParseModifiers(Str(a, "modifiers", ""));
        var f = ButtonFlags(Str(a, "button", "left"));
        int clicks = Math.Max(1, Math.Min(3, Int(a, "clicks", 1)));
        Thread.Sleep(30);
        KeyDownUp(mods, true);
        try
        {
            for (int c = 0; c < clicks; c++) { SendMouse(f[0], f[2]); Thread.Sleep(15); SendMouse(f[1], f[2]); Thread.Sleep(45); }
        }
        finally { KeyDownUp(mods, false); }
        return Done();
    }
    static object MouseButton(Dictionary<string, object> a)
    {
        var f = ButtonFlags(Str(a, "button", "left"));
        if (Has(a, "x") && Has(a, "y")) MoveTo(Int(a, "x", 0), Int(a, "y", 0));
        SendMouse(Str(a, "action", "down") == "up" ? f[1] : f[0], f[2]);
        return Done();
    }
    static object Drag(Dictionary<string, object> a)
    {
        var f = ButtonFlags(Str(a, "button", "left"));
        var mods = ParseModifiers(Str(a, "modifiers", ""));
        MoveTo(Int(a, "fromX", 0), Int(a, "fromY", 0));
        Thread.Sleep(50);
        KeyDownUp(mods, true);
        try
        {
            SendMouse(f[0], f[2]); Thread.Sleep(80);
            SmoothMove(Int(a, "toX", 0), Int(a, "toY", 0), Math.Max(100, Int(a, "durationMs", 400)));
            Thread.Sleep(80); SendMouse(f[1], f[2]);
        }
        finally { KeyDownUp(mods, false); }
        return Done();
    }
    static object Scroll(Dictionary<string, object> a)
    {
        if (Has(a, "x") && Has(a, "y")) MoveTo(Int(a, "x", 0), Int(a, "y", 0));
        string dir = Str(a, "direction", "down");
        int amount = Math.Max(1, Math.Min(50, Int(a, "amount", 3)));
        var mods = ParseModifiers(Str(a, "modifiers", ""));
        KeyDownUp(mods, true);
        try
        {
            for (int i = 0; i < amount; i++)
            {
                if (dir == "up") SendMouse(WHEEL, 120); else if (dir == "down") SendMouse(WHEEL, unchecked((uint)-120));
                else if (dir == "right") SendMouse(HWHEEL, 120); else SendMouse(HWHEEL, unchecked((uint)-120));
                Thread.Sleep(20);
            }
        }
        finally { KeyDownUp(mods, false); }
        return Done();
    }

    // ---------- keyboard ----------
    static readonly Dictionary<string, ushort> VK = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase) {
        {"ctrl",0x11},{"control",0x11},{"shift",0x10},{"alt",0x12},{"menu",0x12},{"win",0x5B},{"windows",0x5B},{"meta",0x5B},{"cmd",0x5B},{"super",0x5B},
        {"enter",0x0D},{"return",0x0D},{"tab",0x09},{"esc",0x1B},{"escape",0x1B},{"space",0x20},{"backspace",0x08},{"delete",0x2E},{"del",0x2E},{"insert",0x2D},{"ins",0x2D},
        {"home",0x24},{"end",0x23},{"pageup",0x21},{"pgup",0x21},{"pagedown",0x22},{"pgdn",0x22},{"up",0x26},{"down",0x28},{"left",0x25},{"right",0x27},
        {"arrowup",0x26},{"arrowdown",0x28},{"arrowleft",0x25},{"arrowright",0x27},{"capslock",0x14},{"numlock",0x90},{"scrolllock",0x91},{"printscreen",0x2C},{"prtsc",0x2C},{"pause",0x13},
        {"apps",0x5D},{"contextmenu",0x5D},{"volumeup",0xAF},{"volumedown",0xAE},{"volumemute",0xAD},{"mediaplaypause",0xB3},{"medianext",0xB0},{"mediaprev",0xB1},
        {"plus",0xBB},{"minus",0xBD},{"comma",0xBC},{"period",0xBE},
    };
    static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0x5D, 0x90, 0x2C, 0x6F };

    static ushort ResolveKey(string k)
    {
        ushort v;
        if (VK.TryGetValue(k, out v)) return v;
        if (k.Length >= 2 && (k[0] == 'f' || k[0] == 'F')) { int n; if (int.TryParse(k.Substring(1), out n) && n >= 1 && n <= 24) return (ushort)(0x70 + n - 1); }
        if (k.Length == 1)
        {
            char c = k[0];
            if (char.IsLetterOrDigit(c) && c < 128) return (ushort)char.ToUpperInvariant(c);
            short s = Native.VkKeyScan(c); if (s != -1) return (ushort)(s & 0xFF);
        }
        throw new Exception("unknown key: '" + k + "'");
    }
    static List<ushort> ParseModifiers(string s)
    {
        var l = new List<ushort>();
        foreach (var part in s.Split(new[] { '+', ',', ' ' }, StringSplitOptions.RemoveEmptyEntries)) l.Add(ResolveKey(part.Trim()));
        return l;
    }
    static Native.INPUT KeyInput(ushort vk, bool up)
    {
        var i = new Native.INPUT { type = INPUT_KEYBOARD };
        i.u.ki.wVk = vk; i.u.ki.wScan = (ushort)Native.MapVirtualKey(vk, 0);
        i.u.ki.dwFlags = (up ? 2u : 0u) | (Extended.Contains(vk) ? 1u : 0u);
        return i;
    }
    static void KeyDownUp(List<ushort> keys, bool down)
    {
        if (keys.Count == 0) return;
        var seq = down ? keys : Enumerable.Reverse(keys).ToList();
        Native.SendInput((uint)seq.Count, seq.Select(k => KeyInput(k, !down)).ToArray(), Marshal.SizeOf(typeof(Native.INPUT)));
        Thread.Sleep(20);
    }
    static object Keys(Dictionary<string, object> a)
    {
        // "ctrl+shift+s", or a space-separated sequence: "ctrl+a backspace"
        int repeat = Math.Max(1, Math.Min(100, Int(a, "repeat", 1)));
        string combo = Str(a, "keys", "").Trim();
        if (combo == "") throw new Exception("keys is empty");
        var chords = combo == "+" ? new[] { "+" } : combo.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        for (int r = 0; r < repeat; r++)
            foreach (var chord in chords)
            {
                var parts = chord.EndsWith("++") ? chord.Substring(0, chord.Length - 2).Split('+').Concat(new[] { "plus" }).Where(p => p != "").ToList() : chord.Split('+').Where(p => p != "").ToList();
                var keys = parts.Select(ResolveKey).ToList();
                KeyDownUp(keys, true); Thread.Sleep(30); KeyDownUp(keys, false); Thread.Sleep(30);
            }
        return Done();
    }
    static void TypeText(string text, int delayMs)
    {
        text = text.Replace("\r\n", "\n");
        foreach (char c in text)
        {
            Native.INPUT[] seq;
            if (c == '\n') seq = new[] { KeyInput(0x0D, false), KeyInput(0x0D, true) };
            else if (c == '\t') seq = new[] { KeyInput(0x09, false), KeyInput(0x09, true) };
            else
            {
                var d = new Native.INPUT { type = INPUT_KEYBOARD }; d.u.ki.wScan = c; d.u.ki.dwFlags = 4; // KEYEVENTF_UNICODE
                var u = d; u.u.ki.dwFlags = 4 | 2;
                seq = new[] { d, u };
            }
            Native.SendInput((uint)seq.Length, seq, Marshal.SizeOf(typeof(Native.INPUT)));
            Thread.Sleep(Math.Max(2, delayMs));
        }
    }

    // ---------- windows ----------
    static Native.RECT Bounds(IntPtr h)
    {
        Native.RECT r;
        if (Native.DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(Native.RECT))) != 0) Native.GetWindowRect(h, out r); // DWMWA_EXTENDED_FRAME_BOUNDS
        return r;
    }
    static int MonitorIndexFor(Native.RECT r, List<Monitor> mons)
    {
        int best = -1; long bestArea = 0;
        foreach (var m in mons)
        {
            long ix = Math.Max(0, Math.Min(r.Right, m.x + m.width) - Math.Max(r.Left, m.x)), iy = Math.Max(0, Math.Min(r.Bottom, m.y + m.height) - Math.Max(r.Top, m.y));
            if (ix * iy > bestArea) { bestArea = ix * iy; best = m.index; }
        }
        return best;
    }
    static List<Dictionary<string, object>> Windows(bool all)
    {
        var mons = Monitors();
        var fg = Native.GetForegroundWindow();
        var list = new List<Dictionary<string, object>>();
        var procNames = new Dictionary<uint, string>();
        int z = 0;
        Native.EnumWindows((h, l) =>
        {
            z++;
            if (!Native.IsWindowVisible(h)) return true;
            int len = Native.GetWindowTextLength(h); if (len == 0) return true;
            int cloaked; if (Native.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // hidden UWP / other virtual desktop
            int exStyle = Native.GetWindowLong(h, -20);
            if (!all && (exStyle & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
            if (!all && Native.GetWindow(h, 4) != IntPtr.Zero && (exStyle & 0x40000) == 0) return true; // owned popups unless WS_EX_APPWINDOW
            var sb = new StringBuilder(len + 1); Native.GetWindowText(h, sb, sb.Capacity);
            uint pid; Native.GetWindowThreadProcessId(h, out pid);
            string pn;
            if (!procNames.TryGetValue(pid, out pn)) { try { pn = Process.GetProcessById((int)pid).ProcessName; } catch { pn = "?"; } procNames[pid] = pn; }
            var r = Bounds(h);
            string title = sb.ToString();
            if (!all && (title == "Program Manager" || (pn == "TextInputHost"))) return true;
            list.Add(new Dictionary<string, object> {
                { "handle", h.ToInt64() }, { "title", title }, { "process", pn }, { "pid", pid },
                { "x", r.Left }, { "y", r.Top }, { "width", r.Right - r.Left }, { "height", r.Bottom - r.Top },
                { "display", MonitorIndexFor(r, mons) }, { "minimized", Native.IsIconic(h) }, { "maximized", Native.IsZoomed(h) },
                { "focused", h == fg }, { "zOrder", z }
            });
            return true;
        }, IntPtr.Zero);
        return list;
    }
    static void ForceForeground(IntPtr h)
    {
        if (Native.IsIconic(h)) Native.ShowWindow(h, 9);
        var fg = Native.GetForegroundWindow();
        uint pid;
        uint fgThread = Native.GetWindowThreadProcessId(fg, out pid), me = Native.GetCurrentThreadId();
        // Tap ALT so Windows allows the foreground change, then attach input queues as a fallback.
        KeyDownUp(new List<ushort> { 0x12 }, true); KeyDownUp(new List<ushort> { 0x12 }, false);
        bool attached = fgThread != me && Native.AttachThreadInput(me, fgThread, true);
        try { Native.BringWindowToTop(h); Native.SetForegroundWindow(h); }
        finally { if (attached) Native.AttachThreadInput(me, fgThread, false); }
    }
    static object WindowAction(Dictionary<string, object> a)
    {
        var h = new IntPtr(Convert.ToInt64(a["handle"]));
        string action = Str(a, "action", "focus");
        switch (action)
        {
            case "focus": ForceForeground(h); break;
            case "minimize": Native.ShowWindow(h, 6); break;
            case "maximize": Native.ShowWindow(h, 3); break;
            case "restore": Native.ShowWindow(h, 9); break;
            case "close": Native.PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); break;
            case "move":
                if (Native.IsZoomed(h) || Native.IsIconic(h)) Native.ShowWindow(h, 9);
                Native.SetWindowPos(h, IntPtr.Zero, Int(a, "x", 0), Int(a, "y", 0), Int(a, "width", 0), Int(a, "height", 0),
                    0x0004 | 0x0010 | (Has(a, "width") && Has(a, "height") ? 0u : 0x0001u)); // NOZORDER|NOACTIVATE[|NOSIZE]
                break;
            default: throw new Exception("unknown window action: " + action);
        }
        Thread.Sleep(150);
        var r = Bounds(h);
        return new { done = true, x = r.Left, y = r.Top, width = r.Right - r.Left, height = r.Bottom - r.Top, focused = Native.GetForegroundWindow() == h };
    }

    // ---------- UI Automation snapshot ----------
    static readonly HashSet<ControlType> Interactive = new HashSet<ControlType> {
        ControlType.Button, ControlType.CheckBox, ControlType.ComboBox, ControlType.Edit, ControlType.Hyperlink, ControlType.ListItem,
        ControlType.MenuItem, ControlType.RadioButton, ControlType.Slider, ControlType.Spinner, ControlType.SplitButton, ControlType.Tab,
        ControlType.TabItem, ControlType.TreeItem, ControlType.Document, ControlType.DataItem, ControlType.Menu, ControlType.ScrollBar, ControlType.HeaderItem
    };
    static object Snapshot(Dictionary<string, object> a)
    {
        IntPtr h = Has(a, "handle") ? new IntPtr(Convert.ToInt64(a["handle"])) : Native.GetForegroundWindow();
        int maxDepth = Math.Max(1, Math.Min(40, Int(a, "maxDepth", 25)));
        int maxNodes = Math.Max(10, Math.Min(2000, Int(a, "maxElements", 400)));
        bool interactiveOnly = Bool(a, "interactiveOnly", true);
        Elements.Clear();
        var root = AutomationElement.FromHandle(h);
        var sb = new StringBuilder();
        var title = root.Current.Name;
        var rb = Bounds(h);
        sb.AppendLine("Window \"" + title + "\" handle=" + h.ToInt64() + " bounds=" + rb.Left + "," + rb.Top + " " + (rb.Right - rb.Left) + "x" + (rb.Bottom - rb.Top));
        int count = 0; bool truncated = false;
        var walker = TreeWalker.ControlViewWalker;
        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(2, Math.Min(30, Int(a, "timeoutSec", 8))));
        Action<AutomationElement, int> walk = null;
        walk = (el, depth) =>
        {
            if (depth > maxDepth || count >= maxNodes || DateTime.UtcNow > deadline) { truncated = true; return; }
            AutomationElement child;
            try { child = walker.GetFirstChild(el); } catch { return; }
            while (child != null)
            {
                if (count >= maxNodes || DateTime.UtcNow > deadline) { truncated = true; return; }
                try
                {
                    var c = child.Current;
                    if (!c.IsOffscreen || !interactiveOnly)
                    {
                        var r = c.BoundingRectangle;
                        bool show = !interactiveOnly || Interactive.Contains(c.ControlType) || (!string.IsNullOrEmpty(c.Name) && c.ControlType == ControlType.Text);
                        if (show && !r.IsEmpty && r.Width > 0 && r.Height > 0)
                        {
                            count++;
                            string id = "e" + count;
                            Elements[id] = new[] { (int)(r.Left + r.Width / 2), (int)(r.Top + r.Height / 2) };
                            string type = c.ControlType.ProgrammaticName.Replace("ControlType.", "");
                            string name = c.Name ?? ""; if (name.Length > 80) name = name.Substring(0, 77) + "...";
                            string val = "";
                            try { object vp; if (child.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) { val = ((ValuePattern)vp).Current.Value ?? ""; if (val.Length > 60) val = val.Substring(0, 57) + "..."; } } catch { }
                            string state = "";
                            try { object tp; if (child.TryGetCurrentPattern(TogglePattern.Pattern, out tp)) state = " " + ((TogglePattern)tp).Current.ToggleState.ToString().ToLowerInvariant(); } catch { }
                            if (!c.IsEnabled) state += " disabled";
                            if (c.HasKeyboardFocus) state += " focused";
                            sb.Append(' ', Math.Min(depth, 12) * 2).Append('[').Append(id).Append("] ").Append(type);
                            if (name != "") sb.Append(" \"").Append(name.Replace("\n", " ")).Append('"');
                            if (val != "") sb.Append(" value=\"").Append(val.Replace("\n", " ")).Append('"');
                            sb.Append(state).Append(" @").Append((int)r.Left).Append(',').Append((int)r.Top).Append(' ').Append((int)r.Width).Append('x').Append((int)r.Height).AppendLine();
                        }
                    }
                    walk(child, depth + 1);
                }
                catch { }
                try { child = walker.GetNextSibling(child); } catch { child = null; }
            }
        };
        walk(root, 1);
        if (truncated) sb.AppendLine("(truncated: raise maxElements/maxDepth or snapshot a smaller window)");
        return new Dictionary<string, object> { { "text", sb.ToString() }, { "count", count }, { "handle", h.ToInt64() }, { "title", title } };
    }
    static object ElementPoint(string id)
    {
        int[] p;
        if (!Elements.TryGetValue(id, out p)) throw new Exception("unknown elementId '" + id + "' - take a new computer_snapshot first");
        return new { x = p[0], y = p[1] };
    }
}
