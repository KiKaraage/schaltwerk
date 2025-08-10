use std::path::Path;
use std::fs;
use log::debug;

pub fn find_claude_session(path: &Path) -> Option<String> {
    // Resolve to a stable filesystem path to avoid mismatches from symlinks
    // (e.g., /var vs /private/var on macOS) across app restarts.
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

    // Resolve the user's home directory in a cross-platform way
    let home = dirs::home_dir()?;
    let claude_dir = home.join(".claude");
    let projects_dir = claude_dir.join("projects");

    // Use Claude's project mapping: ~/.claude/projects/{sanitized(canonical_path)}
    let sanitized = sanitize_path_for_claude(&canonical);
    let project_dir = projects_dir.join(&sanitized);

    if !project_dir.exists() {
        debug!(
            "Claude project directory not found for path: canonical={} sanitized={} projects_root={}",
            canonical.display(),
            sanitized,
            projects_dir.display()
        );
        return None;
    }

    // Collect candidate log files in project dir and one level below
    fn collect_logs(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut files: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(iter) = fs::read_dir(dir) {
            for entry in iter.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    if let Ok(inner) = fs::read_dir(&p) {
                        for e in inner.flatten() {
                            let ip = e.path();
                            if is_supported_log(&ip) { files.push(ip); }
                        }
                    }
                } else if is_supported_log(&p) {
                    files.push(p);
                }
            }
        }
        files.sort_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok().unwrap_or(std::time::SystemTime::UNIX_EPOCH));
        files
    }

    fn is_supported_log(p: &Path) -> bool {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        name.ends_with(".jsonl") || name.ends_with(".jsonl.gz")
    }

    fn extract_id(p: &Path) -> Option<String> {
        let name = p.file_name()?.to_str()?;
        name
            .strip_suffix(".jsonl.gz")
            .map(|s| s.to_string())
            .or_else(|| name.strip_suffix(".jsonl").map(|s| s.to_string()))
    }

    let logs = collect_logs(&project_dir);
    let latest = logs.last()?;
    debug!("Found Claude sessions for {} -> using {:?}", canonical.display(), latest);
    extract_id(latest)
}

fn sanitize_path_for_claude(path: &Path) -> String {
    path.to_string_lossy()
        .replace(['/', '.', ' '], "-")
}

pub fn has_claude_logs(path: &Path) -> bool {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let home = match dirs::home_dir() { Some(h) => h, None => return false };
    let projects_dir = home.join(".claude").join("projects");
    let project_dir = projects_dir.join(sanitize_path_for_claude(&canonical));
    if !project_dir.exists() { return false; }
    // Reuse the same collection logic as above (shallow + one level)
    fn is_supported_log(p: &Path) -> bool {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        name.ends_with(".jsonl") || name.ends_with(".jsonl.gz")
    }
    let mut any = false;
    if let Ok(iter) = fs::read_dir(&project_dir) {
        for entry in iter.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Ok(inner) = fs::read_dir(&p) {
                    for e in inner.flatten() {
                        if is_supported_log(&e.path()) { any = true; break; }
                    }
                }
            } else if is_supported_log(&p) { any = true; }
            if any { break; }
        }
    }
    any
}

pub fn build_claude_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
) -> String {
    let mut cmd = format!("cd {} && claude", worktree_path.display());
    
    if skip_permissions {
        cmd.push_str(" --dangerously-skip-permissions");
    }
    
    if let Some(id) = session_id {
        cmd.push_str(&format!(r#" -r "{id}""#));
    } else if let Some(prompt) = initial_prompt {
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" "{escaped}""#));
    }
    
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions "implement feature X""#);
    }

    #[test]
    fn test_resume_with_session_id() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude -r "12345678-1234-1234-1234-123456789012""#);
    }

    #[test]
    fn test_sanitize_path_for_claude() {
        let path = Path::new("/Users/john.doe/my-project");
        let sanitized = sanitize_path_for_claude(path);
        assert_eq!(sanitized, "-Users-john-doe-my-project");
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
        );
        assert_eq!(cmd, "cd /path/to/worktree && claude");
    }

    #[test]
    fn test_resume_with_permissions() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("ignored prompt"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions -r "session-123""#);
    }

    #[test]
    fn test_prompt_with_quotes() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude "implement \"feature\" with quotes""#);
    }
}