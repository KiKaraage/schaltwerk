use anyhow::{anyhow, Result};
use crate::para_core::Database;
use std::path::Path;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

pub fn truncate_prompt(prompt: &str) -> String {
    let first_lines: String = prompt.lines().take(4).collect::<Vec<_>>().join("\n");
    if first_lines.len() > 400 {
        first_lines.chars().take(400).collect::<String>()
    } else {
        first_lines
    }
}

pub fn sanitize_name(input: &str) -> String {
    let mut s: String = input
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let mut collapsed = String::with_capacity(s.len());
    let mut prev_hyphen = false;
    for ch in s.drain(..) {
        if ch == '-' {
            if !prev_hyphen {
                collapsed.push('-');
            }
            prev_hyphen = true;
        } else {
            collapsed.push(ch);
            prev_hyphen = false;
        }
    }
    let trimmed = collapsed.trim_matches('-').to_string();
    // Limit to 30 characters max (was 50)
    trimmed.chars().take(30).collect()
}

fn ansi_strip(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{001b}' {
            if chars.peek() == Some(&'[') {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() || c == '~' {
                        break;
                    }
                }
            }
            continue;
        } else {
            out.push(ch);
        }
    }
    out
}

pub async fn generate_display_name(
    db: &Database,
    session_id: &str,
    worktree_path: &Path,
    agent_type: &str,
    initial_prompt: Option<&str>,
) -> Result<Option<String>> {
    log::info!("generate_display_name called: session_id={}, agent_type={}, prompt={:?}", 
        session_id, agent_type, initial_prompt.map(|p| &p[..p.len().min(50)]));
    
    let base_prompt = initial_prompt.unwrap_or("Name this coding session succinctly");
    let truncated = truncate_prompt(base_prompt);
    log::debug!("Truncated prompt for name generation: {}", truncated);

    // Prompt for plain text result for JSON wrappers
    // Explicitly tell the AI to not use tools for faster response
    let prompt_plain = format!(
        r#"IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a SHORT kebab-case name for this task.

Rules:
- Maximum 3-4 words
- 20 characters or less preferred
- Use only lowercase letters, numbers, hyphens
- Be concise - capture the essence, not details
- Return ONLY the name, no quotes or explanation
- Do NOT use tools or commands

Examples of good names:
- "auth-system" (not "implement-user-authentication-system")
- "horse-app" (not "lets-talk-about-horses-and-build")
- "fix-login" (not "fix-the-login-button-on-homepage")
- "api-docs" (not "create-api-documentation-for-endpoints")

Task: {truncated}

Respond with just the short kebab-case name:"#
    );
    
    // Set a reasonable timeout for name generation
    let timeout_duration = Duration::from_secs(10);

    // Use the appropriate agent based on user's selection
    if agent_type == "cursor" {
        log::info!("Attempting to generate name with cursor-agent");
        let cursor_future = Command::new("cursor-agent")
            .args(["-p", "--output-format", "json", "-m", "gpt-5", &prompt_plain])
            .current_dir(worktree_path)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .output();
        
        let output = match timeout(timeout_duration, cursor_future).await {
            Ok(Ok(output)) => {
                log::debug!("cursor-agent executed successfully");
                Some(output)
            },
            Ok(Err(e)) => {
                log::warn!("Failed to execute cursor-agent: {e}");
                // User selected cursor but it's not available - don't fall back to claude
                return Err(anyhow!("cursor-agent not available: {e}"));
            },
            Err(_) => {
                log::warn!("Cursor-agent timed out after 10 seconds");
                return Err(anyhow!("cursor-agent timed out"));
            },
        };
        
        if let Some(output) = output {
            if output.status.success() {
                let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
                log::debug!("cursor-agent stdout: {}", stdout);
                
                // Try to parse as JSON
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    // cursor-agent might return the result directly or wrapped
                    let result_str = v.as_str()
                        .or_else(|| v.get("result").and_then(|x| x.as_str()))
                        .or_else(|| v.get("response").and_then(|x| x.as_str()));
                    
                    if let Some(result) = result_str {
                        log::info!("cursor-agent returned name: {}", result);
                        let name = sanitize_name(result);
                        log::info!("Sanitized name: {}", name);
                        
                        if !name.is_empty() {
                            db.update_session_display_name(session_id, &name)?;
                            log::info!("Updated database with display_name '{}' for session_id '{}'", name, session_id);
                            return Ok(Some(name));
                        }
                    } else {
                        log::warn!("cursor-agent JSON response missing result field");
                    }
                } else {
                    log::warn!("Failed to parse cursor-agent response as JSON");
                }
            } else {
                log::warn!("cursor-agent returned non-zero exit status");
            }
        }
        
        // If we get here with cursor, we couldn't generate a name
        log::warn!("cursor-agent could not generate a name for session_id '{}'", session_id);
        return Ok(None);
    }

    // Use Claude only if claude was selected (not as a fallback)
    if agent_type != "claude" {
        log::info!("Agent type is '{}', not generating name with claude", agent_type);
        return Ok(None);
    }
    
    log::info!("Attempting to generate name with claude");
    let claude_future = Command::new("claude")
        .args(["--print", prompt_plain.as_str(), "--output-format", "json", "--model", "sonnet"])
        .current_dir(worktree_path)
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .output();
    
    let output = match timeout(timeout_duration, claude_future).await {
        Ok(Ok(output)) => {
            log::debug!("claude executed successfully");
            output
        },
        Ok(Err(e)) => {
            log::error!("Failed to execute claude: {e}");
            return Err(anyhow!("Failed to execute claude: {e}"))
        },
        Err(_) => {
            log::error!("Claude timed out after 10 seconds");
            return Err(anyhow!("Claude timed out after 10 seconds"))
        },
    };
    
    if output.status.success() {
        let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
        log::debug!("claude stdout: {}", stdout);
        
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&stdout) {
            // Claude might return the result directly or in a "result" field
            let result_str = v.as_str()
                .or_else(|| v.get("result").and_then(|x| x.as_str()));
            
            if let Some(result) = result_str {
                log::info!("claude returned name: {}", result);
                let name = sanitize_name(result);
                log::info!("Sanitized name: {}", name);
                
                if !name.is_empty() {
                    db.update_session_display_name(session_id, &name)?;
                    log::info!("Updated database with display_name '{}' for session_id '{}'", name, session_id);
                    return Ok(Some(name));
                } else {
                    log::warn!("Sanitized name is empty");
                }
            } else {
                log::warn!("claude JSON response missing result field");
            }
        } else {
            log::warn!("Failed to parse claude response as JSON");
        }
    } else {
        log::warn!("claude returned non-zero exit status");
    }

    log::warn!("No name could be generated for session_id '{}'", session_id);
    Ok(None)
}
