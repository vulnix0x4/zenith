mod sessions;
mod ssh;

use sessions::commands::*;
use ssh::commands::*;
use ssh::manager::SshManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SshManager::new())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            get_sessions,
            save_session,
            delete_session,
            save_folder,
            delete_folder,
            move_session_to_folder,
            export_sessions_file,
            import_sessions_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
