fn main() {
    // Expose the cargo TARGET triple to the crate so sidecar binary names
    // (ai-conv-backend-<target-triple>) can be resolved exactly the way the
    // Tauri CLI names them.
    println!(
        "cargo:rustc-env=AI_CONV_TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    tauri_build::build()
}
