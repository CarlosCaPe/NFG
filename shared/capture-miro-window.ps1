Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    public const uint MOUSEEVENTF_LEFTUP = 0x04;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    
    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(200);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        System.Threading.Thread.Sleep(80);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
}
"@

$outDir = Join-Path $PSScriptRoot "..\clients\oncohealth\output"

function Capture-Screen($filename) {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $g.Dispose()
    $path = Join-Path $outDir $filename
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  Saved: $filename ($((Get-Item $path).Length) bytes)"
}

# Activate and maximize Miro
$miroProc = Get-Process -Name Miro | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$hwnd = $miroProc.MainWindowHandle
[Win32]::ShowWindow($hwnd, 3) | Out-Null
Start-Sleep -Seconds 1
[Win32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Seconds 2

# Close any open dialogs/menus first
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Seconds 1

$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$winW = $rect.Right - $rect.Left
$winH = $rect.Bottom - $rect.Top
Write-Host "Window: Left=$($rect.Left) Top=$($rect.Top) W=$winW H=$winH"

# Step 0: Take a baseline screenshot to see current state
Capture-Screen "miro-step0-baseline.png"

# Step 1: Click the ⋮ using scatter approach (worked before)
Write-Host "Step 1: Scatter-clicking around the three-dots..."
foreach ($pos in @(@(260,139), @(262,141), @(264,141), @(260,143), @(262,137))) {
    [Win32]::Click($pos[0], $pos[1])
    Start-Sleep -Milliseconds 600
}
Start-Sleep -Seconds 2
Capture-Screen "miro-export-step1-menu.png"

# Step 2: Now click "Board" - first item in the dropdown at approx y=208
Write-Host "Step 2: Clicking 'Board' submenu..."
[Win32]::Click(315, 208)
Start-Sleep -Seconds 2
Capture-Screen "miro-export-step2-board.png"

Write-Host "Done! Check screenshots."
