// Release builds use the Windows subsystem so no console window opens.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    yobei_client_lib::run()
}
