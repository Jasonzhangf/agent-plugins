//! dsh-tui renderer entry point.

mod app;
mod model;
mod protocol;
mod terminal_guard;

use std::env;
use std::fs::File;
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::io::{FromRawFd, RawFd};

use crate::app::App;
use crate::terminal_guard::TerminalGuard;

fn main() -> anyhow::Result<()> {
    let session_id = env::var("DSH_TUI_SESSION_ID").unwrap_or_else(|_| "tui-session".into());
    let mut projection_in = unsafe { File::from_raw_fd(3) };
    let mut action_out = unsafe { File::from_raw_fd(4) };
    let mut host_control_in = unsafe { File::from_raw_fd(5) };
    let mut child_control_out = unsafe { File::from_raw_fd(6) };

    set_nonblocking(projection_in.as_raw_fd())?;
    set_nonblocking(host_control_in.as_raw_fd())?;

    let guard = TerminalGuard::enter()?;
    let mut app = App::new(session_id);
    app.run(
        &mut projection_in,
        &mut action_out,
        &mut host_control_in,
        &mut child_control_out,
        guard,
    )
}

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
