use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use serde::{Deserialize, Serialize};
use anyhow::Result;
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ProjectHistory {
    projects: HashMap<String, RecentProject>,
}

impl ProjectHistory {
    pub fn load() -> Result<Self> {
        let config_path = Self::config_path()?;
        
        if !config_path.exists() {
            return Ok(Self::default());
        }
        
        let content = fs::read_to_string(&config_path)?;
        let history: ProjectHistory = serde_json::from_str(&content)?;
        Ok(history)
    }
    
    pub fn save(&self) -> Result<()> {
        let config_path = Self::config_path()?;
        
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        let content = serde_json::to_string_pretty(&self)?;
        fs::write(config_path, content)?;
        Ok(())
    }
    
    fn config_path() -> Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("Failed to get config directory"))?;
        
        Ok(config_dir.join("schaltwerk").join("project_history.json"))
    }
    
    pub fn add_project(&mut self, path: &str) -> Result<()> {
        let path_buf = PathBuf::from(path);
        let name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();
        
        let project = RecentProject {
            path: path.to_string(),
            name,
            last_opened: Utc::now().timestamp_millis(),
        };
        
        self.projects.insert(path.to_string(), project);
        self.save()?;
        Ok(())
    }
    
    pub fn update_timestamp(&mut self, path: &str) -> Result<()> {
        if let Some(project) = self.projects.get_mut(path) {
            project.last_opened = Utc::now().timestamp_millis();
            self.save()?;
        }
        Ok(())
    }
    
    pub fn remove_project(&mut self, path: &str) -> Result<()> {
        self.projects.remove(path);
        self.save()?;
        Ok(())
    }
    
    pub fn get_recent_projects(&self) -> Vec<RecentProject> {
        let mut projects: Vec<_> = self.projects.values().cloned().collect();
        projects.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
        projects.truncate(20);
        projects
    }
}

pub fn is_git_repository(path: &Path) -> bool {
    let git_dir = path.join(".git");
    git_dir.exists() && (git_dir.is_dir() || git_dir.is_file())
}

pub fn directory_exists(path: &Path) -> bool {
    path.exists() && path.is_dir()
}