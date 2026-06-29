//! Cross-platform helpers for spawning child processes without flashing consoles.

#[cfg(windows)]
pub(crate) fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = std::process::Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
pub(crate) fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    std::process::Command::new(program)
}
