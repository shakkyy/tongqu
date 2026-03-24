import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(ROOT, "_git_push_log.txt")


def run(cmd: list[str]) -> int:
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    lines = [
        "CMD: " + " ".join(cmd),
        "rc=" + str(p.returncode),
        "stdout:\n" + (p.stdout or ""),
        "stderr:\n" + (p.stderr or ""),
        "",
    ]
    with open(LOG, "a", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return p.returncode


def main() -> None:
    if os.path.exists(LOG):
        os.remove(LOG)
    if not os.path.isdir(os.path.join(ROOT, ".git")):
        run(["git", "init"])
    run(["git", "branch", "-M", "main"])
    p = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if p.returncode == 0:
        run(["git", "remote", "set-url", "origin", "https://github.com/shakkyy/tongqu.git"])
    else:
        run(["git", "remote", "add", "origin", "https://github.com/shakkyy/tongqu.git"])
    run(["git", "add", "-A"])
    run(["git", "status"])
    p = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True)
    if (p.stdout or "").strip():
        run(
            [
                "git",
                "commit",
                "-m",
                "chore: initial import — 童趣绘梦 (frontend + agent backend)",
            ]
        )
    else:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write("(nothing to commit)\n")
    run(["git", "push", "-u", "origin", "main"])


if __name__ == "__main__":
    main()
