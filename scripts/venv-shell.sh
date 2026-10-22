#!/usr/bin/env bash
# `make shell`'s implementation: open an interactive copy of the user's own
# $SHELL with the project venv activated AFTER the shell's own startup
# files have run.
#
# Why after, not before (Codex review on PR #49): an earlier version just
# exported VIRTUAL_ENV and put .venv/bin first on PATH, then exec'd $SHELL.
# Any interactive startup file that prepends its own directory -- pyenv's
# `eval "$(pyenv init -)"`, conda's init block, a plain `export
# PATH=~/bin:$PATH` -- then pushed .venv/bin back down, leaving VIRTUAL_ENV
# pointing at the venv while `python3` resolved somewhere else entirely.
# Reproduced for bash, zsh and fish with a startup file prepending a dir
# holding a fake python3. Each shell below instead loads the user's normal
# startup files first, then sources the venv's own activate script last,
# so the venv always wins and the prompt shows `(.venv)` like a manual
# activate does. `deactivate` works as usual; `exit` leaves the subshell.
#
# The per-shell rc shims are generated inside the venv directory itself
# (gitignored, and recreated on every run) rather than anywhere in the repo.
#
# Usage: scripts/venv-shell.sh <venv-dir>
set -euo pipefail

venv_dir="$(cd "$1" && pwd)"
user_shell="${SHELL:-/bin/bash}"
shim_dir="$venv_dir/.make-shell"
mkdir -p "$shim_dir"
activate_q="$(printf '%q' "$venv_dir/bin/activate")"

echo "Subshell with $1 active -- type 'exit' to leave."
case "$(basename "$user_shell")" in
  bash)
    # --rcfile replaces ~/.bashrc for this interactive shell, so load it
    # ourselves first.
    cat > "$shim_dir/bashrc" <<EOF
if [ -f ~/.bashrc ]; then . ~/.bashrc; fi
. $activate_q
EOF
    exec "$user_shell" --rcfile "$shim_dir/bashrc" -i
    ;;
  zsh)
    # zsh has no --rcfile; point ZDOTDIR at the shim dir so zsh reads its
    # .zshenv/.zshrc, each of which sources the user's real one (from
    # their original ZDOTDIR, or $HOME) and then puts ZDOTDIR back.
    user_zdotdir_q="$(printf '%q' "${ZDOTDIR:-$HOME}")"
    cat > "$shim_dir/.zshenv" <<EOF
ZDOTDIR=$user_zdotdir_q
if [ -f "\$ZDOTDIR/.zshenv" ]; then . "\$ZDOTDIR/.zshenv"; fi
_make_shell_user_zdotdir="\$ZDOTDIR"
ZDOTDIR=$(printf '%q' "$shim_dir")
EOF
    cat > "$shim_dir/.zshrc" <<EOF
ZDOTDIR="\$_make_shell_user_zdotdir"
unset _make_shell_user_zdotdir
if [ -f "\$ZDOTDIR/.zshrc" ]; then . "\$ZDOTDIR/.zshrc"; fi
. $activate_q
EOF
    ZDOTDIR="$shim_dir" exec "$user_shell" -i
    ;;
  fish)
    # --init-command runs after fish's own config files.
    exec "$user_shell" -i --init-command "source $(printf '%q' "$venv_dir/bin/activate.fish")"
    ;;
  *)
    # No known way to run something after this shell's startup files, so
    # fall back to setting the environment up front, and say so.
    echo "Note: $(basename "$user_shell") isn't bash/zsh/fish; if its startup files prepend to PATH," >&2
    echo "python3 may not resolve to the venv -- run '. $1/bin/activate' inside it if so." >&2
    VIRTUAL_ENV="$venv_dir" PATH="$venv_dir/bin:$PATH" exec "$user_shell"
    ;;
esac
