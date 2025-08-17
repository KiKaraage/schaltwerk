use std::path::{Path, PathBuf};
use std::process::Command;
use anyhow::{Result, anyhow};
use std::fs;

pub fn discover_repository() -> Result<PathBuf> {
    if let Ok(repo_env) = std::env::var("PARA_REPO_PATH") {
        if !repo_env.trim().is_empty() {
            let output = Command::new("git")
                .args(["-C", &repo_env, "rev-parse", "--show-toplevel"])
                .output()?;
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Ok(PathBuf::from(path));
            }
        }
    }

    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!("Not in a git repository. Please run Para UI from within a git repository."));
    }
    
    let path = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();
    
    Ok(PathBuf::from(path))
}

pub fn get_current_branch(repo_path: &Path) -> Result<String> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-parse", "--abbrev-ref", "HEAD"
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!("Failed to get current branch"));
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn get_default_branch(repo_path: &Path) -> Result<String> {
    log::info!("Getting default branch for repo: {}", repo_path.display());
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "symbolic-ref", "refs/remotes/origin/HEAD"
        ])
        .output();
    
    if let Ok(output) = output {
        if output.status.success() {
            let full_ref = String::from_utf8_lossy(&output.stdout).trim().to_string();
            log::debug!("Found remote origin HEAD: {full_ref}");
            if let Some(branch) = full_ref.strip_prefix("refs/remotes/origin/") {
                log::info!("Using default branch from remote: {branch}");
                return Ok(branch.to_string());
            }
        } else {
            log::debug!("Remote origin HEAD not set, trying to set it up");
            let setup_output = Command::new("git")
                .args([
                    "-C", repo_path.to_str().unwrap(),
                    "remote", "set-head", "origin", "--auto"
                ])
                .output();
            
            if let Ok(setup_output) = setup_output {
                if setup_output.status.success() {
                    log::info!("Successfully set up remote HEAD, retrying");
                    if let Ok(retry_output) = Command::new("git")
                        .args([
                            "-C", repo_path.to_str().unwrap(),
                            "symbolic-ref", "refs/remotes/origin/HEAD"
                        ])
                        .output() 
                    {
                        if retry_output.status.success() {
                            let full_ref = String::from_utf8_lossy(&retry_output.stdout).trim().to_string();
                            if let Some(branch) = full_ref.strip_prefix("refs/remotes/origin/") {
                                log::info!("Using default branch from remote after setup: {branch}");
                                return Ok(branch.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    
    if let Ok(current) = get_current_branch(repo_path) {
        log::info!("Using current branch as default: {current}");
        return Ok(current);
    }
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "--list", "--format=%(refname:short)"
        ])
        .output()?;
    
    if output.status.success() {
        let branches = String::from_utf8_lossy(&output.stdout);
        let branch_names: Vec<&str> = branches.lines().collect();
        log::debug!("Available branches: {branch_names:?}");
        
        for default_name in &["main", "master", "develop", "dev"] {
            if branch_names.contains(default_name) {
                log::info!("Using common default branch: {default_name}");
                return Ok(default_name.to_string());
            }
        }
        
        if let Some(first_branch) = branch_names.first() {
            log::info!("Using first available branch: {first_branch}");
            return Ok(first_branch.to_string());
        }
    }
    
    log::error!("No branches found in repository: {}", repo_path.display());
    Err(anyhow!("No branches found in repository"))
}

pub fn get_commit_hash(repo_path: &Path, branch_or_ref: &str) -> Result<String> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-parse", branch_or_ref
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to get commit hash for '{}': {}", branch_or_ref, stderr));
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn init_repository(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    
    let output = Command::new("git")
        .arg("init")
        .current_dir(path)
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Git init failed: {}", stderr));
    }
    
    Ok(())
}