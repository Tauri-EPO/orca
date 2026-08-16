using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

internal static class OrcaAgentHookLauncher
{
    private const int StandardInputTimeoutMilliseconds = 1000;
    private const int ChildExitTimeoutMilliseconds = 2500;

    private static int Main(string[] args)
    {
        bool emitNeutralJson = args.Length == 2 && args[0] == "--neutral-json";
        string scriptPath = args.Length == (emitNeutralJson ? 2 : 1) ? args[args.Length - 1] : null;
        if (scriptPath == null || !File.Exists(scriptPath))
        {
            DrainStandardInputWithTimeout();
            WriteNeutralJson(emitNeutralJson);
            return 0;
        }

        try
        {
            string systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(systemDirectory, "cmd.exe"),
                Arguments = "/d /s /c \"\"%ORCA_AGENT_HOOK_SCRIPT%\"\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            startInfo.EnvironmentVariables["ORCA_AGENT_HOOK_SCRIPT"] = scriptPath;

            using (Process child = Process.Start(startInfo))
            {
                Task inputTask = CopyStandardInputAsync(child.StandardInput.BaseStream);
                Task<string> outputTask = child.StandardOutput.ReadToEndAsync();
                Task<string> errorTask = child.StandardError.ReadToEndAsync();
                inputTask.Wait(StandardInputTimeoutMilliseconds);
                TryClose(child.StandardInput);

                bool childTimedOut = !child.WaitForExit(ChildExitTimeoutMilliseconds);
                if (childTimedOut)
                {
                    KillProcessTree(child, systemDirectory);
                }
                Task.WaitAll(new Task[] { outputTask, errorTask }, ChildExitTimeoutMilliseconds);
                WriteNeutralJson(emitNeutralJson);
                return childTimedOut ? 0 : child.ExitCode;
            }
        }
        catch
        {
            DrainStandardInputWithTimeout();
            WriteNeutralJson(emitNeutralJson);
            return 0;
        }
    }

    private static void KillProcessTree(Process child, string systemDirectory)
    {
        try
        {
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(systemDirectory, "taskkill.exe"),
                Arguments = "/PID " + child.Id + " /T /F",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (Process treeKiller = Process.Start(startInfo))
            {
                treeKiller.BeginOutputReadLine();
                treeKiller.BeginErrorReadLine();
                if (!treeKiller.WaitForExit(ChildExitTimeoutMilliseconds))
                {
                    treeKiller.Kill();
                }
            }
        }
        catch { }

        if (!child.HasExited)
        {
            try
            {
                child.Kill();
            }
            catch { }
        }
        child.WaitForExit(ChildExitTimeoutMilliseconds);
    }

    private static Task CopyStandardInputAsync(Stream destination)
    {
        return Task.Run(() =>
        {
            try
            {
                Console.OpenStandardInput().CopyTo(destination);
                destination.Flush();
            }
            catch
            {
                // The caller may leave stdin open after the payload is complete.
            }
        });
    }

    private static void DrainStandardInputWithTimeout()
    {
        CopyStandardInputAsync(Stream.Null).Wait(StandardInputTimeoutMilliseconds);
    }

    private static void TryClose(TextWriter writer)
    {
        try
        {
            writer.Close();
        }
        catch { }
    }

    private static void WriteNeutralJson(bool enabled)
    {
        if (!enabled) return;
        try
        {
            byte[] output = Encoding.UTF8.GetBytes("{}\n");
            Stream stdout = Console.OpenStandardOutput();
            stdout.Write(output, 0, output.Length);
            stdout.Flush();
        }
        catch { }
    }
}
