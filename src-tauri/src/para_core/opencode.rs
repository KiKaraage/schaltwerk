use std::path::{Path, PathBuf};
use std::fs;

pub fn find_opencode_session(path: &Path) -> Option<String> {
    // OpenCode uses --continue flag for last session or --session for specific IDs
    // We'll store a session marker in the worktree similar to Cursor
    let session_file = path.join(".opencode-session");
    
    if session_file.exists() {
        fs::read_to_string(&session_file)
            .ok()
            .and_then(|content| {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    Some(trimmed.to_string())
                } else {
                    None
                }
            })
    } else {
        // No stored session, OpenCode will create a new one
        None
    }
}

pub fn build_opencode_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    _skip_permissions: bool,
) -> String {
    let opencode_bin = resolve_opencode_binary();
    let mut cmd = format!("cd {} && {}", worktree_path.display(), opencode_bin);
    
    if let Some(_id) = session_id {
        // For OpenCode, we use --continue to resume the last session
        // since it doesn't support explicit session IDs like Claude
        cmd.push_str(" --continue");
    }
    
    if let Some(prompt) = initial_prompt {
        // Add initial prompt using the --prompt flag for interactive mode
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" --prompt "{escaped}""#));
    }
    
    cmd
}

/// Resolve the OpenCode binary path in a user-agnostic way.
/// Order:
/// 1. Environment variable `OPENCODE_BIN` when set (useful for tests/CI)
/// 2. `~/.opencode/bin/opencode` if it exists
/// 3. Fallback to `opencode` (expecting it on PATH)
pub fn resolve_opencode_binary() -> String {
    if let Ok(from_env) = std::env::var("OPENCODE_BIN") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(home) = dirs::home_dir() {
        let candidate: PathBuf = home.join(".opencode").join("bin").join("opencode");
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    "opencode".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    #[serial_test::serial]
    fn test_new_session_with_prompt() {
        std::env::set_var("OPENCODE_BIN", "/custom/bin/opencode");
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /custom/bin/opencode --prompt "implement feature X""#);
        std::env::remove_var("OPENCODE_BIN");
    }

    #[test]
    #[serial_test::serial]
    fn test_continue_with_session_id() {
        std::env::set_var("OPENCODE_BIN", "/custom/bin/opencode");
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            Some("my-session"),
            None,
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /custom/bin/opencode --continue"#);
        std::env::remove_var("OPENCODE_BIN");
    }

    #[test]
    #[serial_test::serial]
    fn test_new_session_no_prompt() {
        std::env::set_var("OPENCODE_BIN", "/custom/bin/opencode");
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
        );
        assert_eq!(cmd, "cd /path/to/worktree && /custom/bin/opencode");
        std::env::remove_var("OPENCODE_BIN");
    }

    #[test]
    #[serial_test::serial]
    fn test_continue_session_with_new_prompt() {
        std::env::set_var("OPENCODE_BIN", "/custom/bin/opencode");
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("new task"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /custom/bin/opencode --continue --prompt "new task""#);
        std::env::remove_var("OPENCODE_BIN");
    }

    #[test]
    #[serial_test::serial]
    fn test_prompt_with_quotes() {
        std::env::set_var("OPENCODE_BIN", "/custom/bin/opencode");
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /custom/bin/opencode --prompt "implement \"feature\" with quotes""#);
        std::env::remove_var("OPENCODE_BIN");
    }
}